import os from "os";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Message, MessageMedia } from "whatsapp-web.js";
import { chatgpt, getAssistantId, openai } from "../providers/openai";
import * as cli from "../cli/ui";
import config from "../config";

import { ChatMessage } from "chatgpt";

// TTS
import { ttsRequest as speechTTSRequest } from "../providers/speech";
import { ttsRequest as awsTTSRequest } from "../providers/aws";
import { TTSMode } from "../types/tts-mode";

// Moderation
import { moderateIncomingPrompt } from "./moderation";
import { aiConfig, getConfig } from "./ai-config";
import { loadPrePrompt, loadThreads, saveThreads, sleep } from "../utils";
import { Run } from "openai/resources/beta/threads/runs/runs";
import { client } from "..";
import { procedure } from "../extra/procedure";
import { googleCalendar } from "../extra/google-calendar";

// Mapping from number to last conversation id
const conversations = {};
const runningMessage = [];
const threads = loadThreads();

const retrieveRun = async (threadId: string, run: Run) => {
	let keepRetrievingRun;
	while (run.status !== "completed") {
		keepRetrievingRun = await openai.beta.threads.runs.retrieve(threadId, run.id);
		//console.log(keepRetrievingRun.status);
		if (keepRetrievingRun.status == "completed") {
			break;
		} else if (keepRetrievingRun.status == "failed") {
			throw new Error('Erro na comunicação externa');
		}
	}
};

const waitForAssistantMessage = async (userId: string, run: Run) => {
	await retrieveRun(threads[userId], run);
	const allMessages = await openai.beta.threads.messages.list(threads[userId]);
	return allMessages.data[0].content[0].text.value;
};

const handleMessageGPT = async (message: Message, prompt: string) => {
	try {
		// Get last conversation
		const lastConversationId = conversations[message.from];

		cli.print(`[GPT] Received prompt from ${message.from}: ${prompt}`);

		// Prompt Moderation
		if (config.promptModerationEnabled) {
			try {
				await moderateIncomingPrompt(prompt);
			} catch (error: any) {
				message.reply(error.message);
				return;
			}
		}

		while (runningMessage[message.from]) {
			await sleep(1000);
			//console.log(runningMessage[message.from]);
		}
		runningMessage[message.from] = true;

		let contact = await message.getContact();
		let contactName = String(contact.name || contact.pushname).split(' ')[0].trim();

		config.prePrompt = loadPrePrompt();
		const start = Date.now();

		if (!threads[message.from]) {
			threads[message.from] = (await openai.beta.threads.create()).id;
			await saveThreads(threads);
			cli.print(`[GPT] New conversation for ${message.from} (ID: ${threads[message.from]})`);
		}
		if (config.prePrompt) {
			let prePrompt = config.prePrompt;
			config.prePrompt = 'Você deverá seguir rigorosamente as seguintes instruções:\n\n';
			config.prePrompt += 'No início de uma conversa, se apresente para a pessoa.\n\n';
			if (contactName) {
				config.prePrompt += `Você estará conversando com ${contactName}. Utilize essa informação como saudação, sempre que você entender que foi iniciada uma conversa.`;
			} else {
				config.prePrompt += 'Pergunte o nome da pessoa e armazene essa informação.\n\n';
			}
			config.prePrompt += 'Utilize o nome da pessoa durante a conversa, quando julgar necessário.\n\n';
			config.prePrompt += prePrompt;
		}
		let assistant_id = await getAssistantId('Assistant', config.prePrompt);
		let msg = '';

		msg += `Fale somente sobre os assuntos que você recebeu nas instruções. `;
		msg += `Se não tiver certeza sobre alguma resposta, não invente uma resposta e diga que você não tem essa informação. `
		msg += `Responda à seguinte mensagem: ${prompt}\n\n`;
		msg += `Se a mensagem não estiver diretamente relacionada às instruções que você recebeu, rejeite-a educadamente.`;
		const threadMessage = await openai.beta.threads.messages.create(threads[message.from], { role: "user", content: msg });
		const run = await openai.beta.threads.runs.create(threads[message.from], { assistant_id, instructions: config.prePrompt });
		retrieveRun(threads[message.from], run);
		let response = { text: '' };
		try {
			response.text = await waitForAssistantMessage(message.from, run);
		} catch (error) {
			response.text = error.message;
		}

		const end = Date.now() - start;

		/*let promptBuilder = "";
		// Pre prompt
		if (config.prePrompt != null && config.prePrompt.trim() != "") {
			if (lastConversationId) {
				promptBuilder += "Com base nas seguintes instruções: ";
			}
			promptBuilder += config.prePrompt + "\n\n";
			if (lastConversationId) {
				promptBuilder += "Responda a seguinte mensagem: ";
			}
		}
		promptBuilder += prompt;

		// Check if we have a conversation with the user
		let response: ChatMessage;
		if (lastConversationId) {
			// Handle message with previous conversation
			response = await chatgpt.sendMessage(promptBuilder, {
				parentMessageId: lastConversationId
			});
		} else {
			// Handle message with new conversation
			response = await chatgpt.sendMessage(promptBuilder);
			cli.print(`[GPT] New conversation for ${message.from} (ID: ${response.id})`);
		}

		// Set conversation id
		conversations[message.from] = response.id;*/

		let tmpFilePath = '';
		let media;
		try {
			let text = response.text;

			let isCheckSlotsMessage = googleCalendar.isCheckSlotsMessage(response.text);
			let isCheckScheduleMessage = googleCalendar.isCheckScheduleMessage(response.text);
			let isScheduleMessage = googleCalendar.isScheduleMessage(response.text);
			let isDeleteScheduleMessage = googleCalendar.isDeleteScheduleMessage(response.text);
			if (isCheckSlotsMessage || isScheduleMessage || isCheckScheduleMessage || isDeleteScheduleMessage) {
				console.log(response.text);

				if (isCheckScheduleMessage) {
					const { events, file } = await googleCalendar.getSchedules(message.from);
					response.text = googleCalendar.getCalendarNoScheduledMessage();
					if (events) {
						response.text = googleCalendar.getDisplayCalendarScheduledMessage() + '\n\n' + events;
						media = MessageMedia.fromFilePath(file);
					}
				} else if (isDeleteScheduleMessage) {
					response.text = await googleCalendar.deleteEventByMessage(text, message.from);
				} else if (isScheduleMessage) {
					try {
						response.text = await googleCalendar.addEventByMessage(text, message.from);
					} catch (error) {
						response.text = error.message;
						isCheckSlotsMessage = true;
					}
				}
				if (isCheckSlotsMessage) {
					tmpFilePath = await googleCalendar.getProcedureCalendarByMessage(text);
					response.text = (isScheduleMessage ? response.text + ' ' : '') + googleCalendar.getDisplayCalendarMessage();
					media = MessageMedia.fromFilePath(tmpFilePath);
				}
			}
		} catch (error) {
			response.text = error.message;
		}

		cli.print(`[GPT] Answer to ${message.from}: ${response.text}  | OpenAI request took ${end}ms)`);

		delete runningMessage[message.from];

		// TTS reply (Default: disabled)
		if (getConfig("tts", "enabled")) {
			sendVoiceMessageReply(message, response.text);
			message.reply(response.text);
			return;
		}

		// Default: Text reply
		message.reply(response.text, '', { media });
		if (tmpFilePath) {
			fs.unlinkSync(tmpFilePath);
		}
	} catch (error: any) {
		console.error("An error occured", error);
		message.reply("An error occured, please contact the administrator. (" + error.message + ")");
	}
};

const handleDeleteConversation = async (message: Message) => {
	// Delete conversation
	delete conversations[message.from];

	// Reply
	message.reply("Conversation context was resetted!");
};

async function sendVoiceMessageReply(message: Message, gptTextResponse: string) {
	var logTAG = "[TTS]";
	var ttsRequest = async function (): Promise<Buffer | null> {
		return await speechTTSRequest(gptTextResponse);
	};

	switch (config.ttsMode) {
		case TTSMode.SpeechAPI:
			logTAG = "[SpeechAPI]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await speechTTSRequest(gptTextResponse);
			};
			break;

		case TTSMode.AWSPolly:
			logTAG = "[AWSPolly]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await awsTTSRequest(gptTextResponse);
			};
			break;

		default:
			logTAG = "[SpeechAPI]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await speechTTSRequest(gptTextResponse);
			};
			break;
	}

	// Get audio buffer
	cli.print(`${logTAG} Generating audio from GPT response "${gptTextResponse}"...`);
	const audioBuffer = await ttsRequest();

	// Check if audio buffer is valid
	if (audioBuffer == null || audioBuffer.length == 0) {
		message.reply(`${logTAG} couldn't generate audio, please contact the administrator.`);
		return;
	}

	cli.print(`${logTAG} Audio generated!`);

	// Get temp folder and file path
	const tempFolder = os.tmpdir();
	const tempFilePath = path.join(tempFolder, randomUUID() + ".opus");

	// Save buffer to temp file
	fs.writeFileSync(tempFilePath, audioBuffer);

	// Send audio
	const messageMedia = new MessageMedia("audio/ogg; codecs=opus", audioBuffer.toString("base64"));
	message.reply(messageMedia);

	// Delete temp file
	fs.unlinkSync(tempFilePath);
}

export { handleMessageGPT, handleDeleteConversation };
