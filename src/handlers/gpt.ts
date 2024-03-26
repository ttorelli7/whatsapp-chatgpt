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
import { getNowDateTime } from "../util/dateFormatter";
import capitalizeFirstLetter from "../util/capitalizeFirstLetter";

// Mapping from number to last conversation id
const conversations = {};
const runningMessage = {};
const currentAction = {};
const stopped = {};
const threads = loadThreads();

const ACTIONS = {
	FIND: 0,
	ADD: 1,
	DELETE: 2,
	READ: 3
};

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

const runActions = async (message, response, prompt, contactName) => {
	let action = currentAction[message.from];
	if (!action) {
		return false;
	}
	response.text = '';
	while (true) {
		let fields = [];
		if ([ACTIONS.FIND, ACTIONS.ADD].indexOf(action.id) != -1) {
			fields.push({ name: 'name', label: 'Informe o nome do procedimento. Exemplo: Limpeza de pele' });
		}
		if ([ACTIONS.FIND, ACTIONS.ADD, ACTIONS.DELETE].indexOf(action.id) != -1) {
			fields.push({ name: 'date', 'label': 'Informe a data do procedimento. Exemplo: 25/12' });
		}
		if ([ACTIONS.ADD].indexOf(action.id) != -1) {
			fields.push({ name: 'time', 'label': 'Informe a hora do procedimento. Exemplo: 16:30' });
		}
		for (let i = 0; i < fields.length; i++) {
			let field = fields[i];
			if (action.data[field.name]) {
				continue;
			}
			let newPrompt = String(prompt).trim();
			if (newPrompt) {
				try {
					switch (field.name) {
						case 'name':
							procedure.getProcedure(newPrompt);
							break;
						case 'date':
							googleCalendar.parseDateTime(newPrompt);
							break;
						case 'time':
							googleCalendar.parseDateTime(action.data['date'], newPrompt);
							break;
					}
				} catch (error) {
					response.text = error.message;
					break;
				}
			}
			if (!action.data[field.name] && !newPrompt) {
				response.text += field.label;
				break;
			}
			action.data[field.name] = newPrompt;
			prompt = '';
		};

		if (response.text) {
			response.text += '\nPara voltar à conversa digite SAIR';
			break;
		}
		let lastActionId = ([ACTIONS.ADD, ACTIONS.DELETE].indexOf(action.id) !== -1 ? action.id : null);
		try {
			if (action.id == ACTIONS.ADD) {
				response.text = await googleCalendar.addEventByMessage(action.data, message.from, contactName);
			} else if (action.id == ACTIONS.DELETE) {
				response.text = await googleCalendar.deleteEventByMessage(action.data, message.from);
			}
			if (response.text) {
				delete currentAction[message.from];
				break;
			}
		} catch (error) {
			response.text = error.message + '\n\n';
			action.id = (action.id == ACTIONS.ADD ? ACTIONS.FIND : ACTIONS.READ);
		}

		if (action.id == ACTIONS.FIND) {
			let file = await googleCalendar.getProcedureCalendarByMessage(action.data);
			response.text += googleCalendar.getDisplayCalendarMessage();
			response.media = MessageMedia.fromFilePath(file);
		} else if (action.id == ACTIONS.READ) {
			const { events, file, label } = await googleCalendar.getSchedules(message.from);
			response.text += label;
			response.media = (events.length ? MessageMedia.fromFilePath(file) : null);
		}
		if (lastActionId) {
			response.text += '\n\n';
			let name = action.data['name'];
			currentAction[message.from] = newAction(lastActionId);
			action = currentAction[message.from];
			if (name) {
				action.data['name'] = name;
			}
			continue;
		}
		delete currentAction[message.from];
		break;
	}
}

const newAction = function (id) {
	return { id, start: getNowDateTime(), data: {} };
}

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
		}
		runningMessage[message.from] = true;

		let helloPrompt = 'Olá';
		let number = message.fromMe ? message.to : message.from;
		let newPrompt = String(prompt).toLowerCase().trim();
		if (newPrompt == 'iniciar') {
			delete stopped[number];
			prompt = helloPrompt;
		}
		if (stopped[number]) {
			return;
		}
		if (message.fromMe || newPrompt == 'parar') {
			stopped[number] = true;
			return;
		}
		console.log(currentAction[number] + ' e ' + newPrompt);
		if (currentAction[number] && (newPrompt == 'sair' || currentAction[number].start <= getNowDateTime().minus({ minutes: 30 }))) {
			console.log('delete');
			delete currentAction[number];
			prompt = helloPrompt;
		}

		let response = { text: '', media: undefined };
		let tmpFilePath = '';
		let end = 0;
		let contact = await message.getContact();
		let contactName = capitalizeFirstLetter(String(contact.name || contact.pushname).split(' ')[0].trim().toLowerCase());

		if (!currentAction[message.from]) {

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
			try {
				response.text = await waitForAssistantMessage(message.from, run);
			} catch (error) {
				response.text = error.message;
			}

			end = Date.now() - start;
			try {
				let text = response.text;

				let isCheckSlotsMessage = googleCalendar.isCheckSlotsMessage(response.text);
				let isCheckScheduleMessage = googleCalendar.isCheckScheduleMessage(response.text);
				let isScheduleMessage = googleCalendar.isScheduleMessage(response.text);
				let isDeleteScheduleMessage = googleCalendar.isDeleteScheduleMessage(response.text);
				if (isCheckSlotsMessage || isScheduleMessage || isCheckScheduleMessage || isDeleteScheduleMessage) {
					console.log(response.text);
					let start = getNowDateTime();
					if (isCheckScheduleMessage) {
						currentAction[message.from] = newAction(ACTIONS.READ);
					} else if (isDeleteScheduleMessage) {
						currentAction[message.from] = newAction(ACTIONS.DELETE);
					} else if (isScheduleMessage) {
						currentAction[message.from] = newAction(ACTIONS.ADD);
					} else if (isCheckSlotsMessage) {
						currentAction[message.from] = newAction(ACTIONS.FIND);
					}
					prompt = '';
				}
			} catch (error) {
				response.text = error.message;
			}
		}

		await runActions(message, response, prompt, contactName);

		delete runningMessage[message.from];

		cli.print(`[GPT] Answer to ${message.from}: ${response.text}  | OpenAI request took ${end}ms)`);

		// TTS reply (Default: disabled)
		if (getConfig("tts", "enabled")) {
			sendVoiceMessageReply(message, response.text);
			message.reply(response.text);
			return;
		}

		// Default: Text reply
		message.reply(response.text, '', { media: response.media });
		if (tmpFilePath) {
			fs.unlinkSync(tmpFilePath);
		}
	} catch (error: any) {
		console.error("An error occured", error);
		message.reply("Erro inesperado, por favor contate o suporte (" + error.message + ")");
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
