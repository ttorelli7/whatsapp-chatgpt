
/*console.log('begin');
await saveEnv('TESTE', '888');
throw new Error('ok');*/

/*let slots = await googleCalendar.listSlots(1, '2024-02-14', 1);
console.log(slots);
throw new Error('ok');
try {
	let x = await googleCalendar.getProcedureCalendarByMessage('Solicitação de consulta de horários para o procedimento "Limpeza de pele" - 20/02 recebida.', 5);
	console.log(x);
} catch (err) {
	console.log(err);
}*/
//throw new Error('ok');

/*let slots = await googleCalendar.listSlotsByProcedure('Limpeza de pele', '14/02/2024', 3);
console.log(slots);
throw new Error('ok');*/

/*let x = await googleCalendar.listEventsByClient('5519995568725@c.us');
console.log(x);*/

import qrcode from "qrcode";
import { Client, Message, Events, LocalAuth } from "whatsapp-web.js";

// Constants
import constants from "./constants";

// CLI
import * as cli from "./cli/ui";
import { handleIncomingMessage } from "./handlers/message";

// Config
import { initAiConfig } from "./handlers/ai-config";
import { initOpenAI } from "./providers/openai";
import { googleCalendar } from "./extra/google-calendar";
import { updateQrCodePage, initRoutes, serverUrl } from "./routes/routes";
import { dateFormatter } from "./util/dateFormatter";

initRoutes();

// Ready timestamp of the bot
let botReadyTimestamp: Date | null = null;

// WhatsApp Client
export const client = new Client({
	puppeteer: {
		args: ["--no-sandbox"],
		//headless: false,
	},
	authStrategy: new LocalAuth({
		dataPath: constants.sessionPath
	})
});

// Entrypoint
const start = async () => {
	//cli.printIntro();

	// WhatsApp auth
	client.on(Events.QR_RECEIVED, (qr: string) => {
		console.log("");
		qrcode.toString(
			qr,
			{
				type: "svg",
				//small: true,
				margin: 2,
				scale: 1
			},
			(err, url) => {
				if (err) throw err;
				updateQrCodePage('', url);
				//cli.printQRCode(url);
				//console.log("Scan the loaded QR code to login to Whatsapp Web... " + serverUrl);
			}
		);
		qrcode.toString(
			qr,
			{
				type: "terminal",
				small: true,
				margin: 2,
				scale: 1
			},
			(err, url) => {
				if (err) throw err;
				cli.printQRCode(url);
			}
		);
	});

	// WhatsApp loading
	client.on(Events.LOADING_SCREEN, (percent) => {
		if (percent == "0") {
			updateQrCodePage('Autenticando...');
			cli.printLoading();
		}
	});

	// WhatsApp authenticated
	client.on(Events.AUTHENTICATED, () => {
		cli.printAuthenticated();
		updateQrCodePage('Autenticado! Carregando mensagens...');
	});

	// WhatsApp authentication failure
	client.on(Events.AUTHENTICATION_FAILURE, () => {
		cli.printAuthenticationFailure();
	});

	// WhatsApp ready
	client.on(Events.READY, () => {
		// Print outro
		cli.printOutro();

		// Set bot ready timestamp
		botReadyTimestamp = new Date();

		initAiConfig();
		initOpenAI();

		updateQrCodePage('Disponível para uso!');
	});

	// WhatsApp message
	client.on(Events.MESSAGE_RECEIVED, async (message: any) => {
		// Ignore if message is from status broadcast
		if (message.from == constants.statusBroadcast) return;

		// Ignore if it's a quoted message, (e.g. Bot reply)
		if (message.hasQuotedMsg) return;

		await handleIncomingMessage(message);
	});

	// Reply to own message
	client.on(Events.MESSAGE_CREATE, async (message: Message) => {
		// Ignore if message is from status broadcast
		if (message.from == constants.statusBroadcast) return;

		// Ignore if it's a quoted message, (e.g. Bot reply)
		if (message.hasQuotedMsg) return;

		// Ignore if it's not from me
		if (!message.fromMe) return;

		await handleIncomingMessage(message);
	});

	// WhatsApp initialization
	client.initialize();
};

start();

export { botReadyTimestamp };
