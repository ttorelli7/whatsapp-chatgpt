import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { ChatGPTAPI } from "chatgpt";
import OpenAI from "openai";

import ffmpeg from "fluent-ffmpeg";
import { blobFromSync, File } from "fetch-blob/from.js";
import config from "../config";
import { getConfig } from "../handlers/ai-config";
import { reloadEnv, saveEnv } from "../utils";

export let chatgpt: ChatGPTAPI;

// OpenAI Client (DALL-E)
export let openai: OpenAI;

export let assistantId: string;

export function initOpenAI() {
	chatgpt = new ChatGPTAPI({
		apiKey: getConfig("gpt", "apiKey"),
		completionParams: {
			model: config.openAIModel,
			temperature: 0.5,
			top_p: 0.9,
			max_tokens: getConfig("gpt", "maxModelTokens")
		}
	});

	openai = new OpenAI(
		{
			apiKey: getConfig("gpt", "apiKey")
		}
	);
}

export async function getAssistantId(name: string, instructions: string): Promise<string> {
	if (!assistantId) {
		assistantId = reloadEnv('ASSISTANT_ID') || "";
	}
	if (!assistantId) {
		let assistant = await openai.beta.assistants.create({
			name,
			instructions,
			model: config.openAIModel,
		});
		assistantId = assistant.id;
		saveEnv('ASSISTANT_ID', assistantId);
	}
	return assistantId;
}

export async function transcribeOpenAI(audioBuffer: Buffer): Promise<{ text: string; language: string }> {

	const url = config.openAIServerUrl;
	let language = config.transcriptionLanguage;

	const tempdir = os.tmpdir();
	const oggPath = path.join(tempdir, randomUUID() + ".ogg");
	const wavFilename = randomUUID() + ".wav";
	const wavPath = path.join(tempdir, wavFilename);
	fs.writeFileSync(oggPath, audioBuffer);
	try {
		await convertOggToWav(oggPath, wavPath);
	} catch (e) {
		fs.unlinkSync(oggPath);
		// error logging
		console.error(`Could not convert to wav. ${e}`);
		return {
			text: "",
			language
		};
	}

	const OpenAI = require("openai");
	const open_ai = new OpenAI({
		apiKey: getConfig("gpt", "apiKey"),
	});

	let response;
	try {
		console.log(wavPath);
		response = await open_ai.audio.transcriptions.create(
			{ model: "whisper-1", file: fs.createReadStream(wavPath) }
		);
	} catch (e) {
		console.error(e);
	} finally {
		fs.unlinkSync(oggPath);
		fs.unlinkSync(wavPath);
	}

	if (!response || response.status != 200) {
		console.error(response);
		return {
			text: "",
			language: language
		};
	}
	console.log(response.data.text);
	// const transcription = await response.json();
	return {
		text: response.data.text,
		language
	};
}

async function convertOggToWav(oggPath: string, wavPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		ffmpeg(oggPath)
			.toFormat("wav")
			.outputOptions("-acodec pcm_s16le")
			.output(wavPath)
			.on("end", () => resolve())
			.on("error", (err) => reject(err))
			.run();
	});
}
