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

// Ready timestamp of the bot
let botReadyTimestamp: Date | null = null;

const express = require('express');
const app = express();
const http = require('http');
const socketIo = require('socket.io');

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// Configuração do Socket.io
const server = http.createServer(app);
const io = socketIo(server);

let message = 'Carregando, aguarde...';
let qrCode = '';

let port = 3001;
//port = 80;
/*app.listen(port, () => {
	console.log(`App listening on port ${port}`)
});*/
server.listen(port, () => {
	io.emit('reloadPage');
	console.log(`App listening on port ${port}`)
});

app.get('/', (req, res) => {
	res.render('index', { message, qrCode });
});

function updatePage(newMessage, newQrCode = '') {
	message = newMessage;
	qrCode = newQrCode;
	io.emit('reloadPage', { message, qrCode });
}

/*app.get('/', (req, res) => {
	if (!qrCode) {
		res.header("refresh", "5");
		return res.send('Carregando QR Code, aguarde alguns segundos...');
	}
	res.header("refresh", "20");
	res.send(qrCode);
});*/

// Entrypoint
const start = async () => {
	//cli.printIntro();

	// WhatsApp Client
	const client = new Client({
		puppeteer: {
			args: ["--no-sandbox"]
		},
		authStrategy: new LocalAuth({
			dataPath: constants.sessionPath
		})
	});

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
				updatePage('', url);
				//cli.printQRCode(url);
				console.log("Scan the loaded QR code to login to Whatsapp Web...");
			}
		);
	});

	// WhatsApp loading
	client.on(Events.LOADING_SCREEN, (percent) => {
		if (percent == "0") {
			updatePage('Autenticando...');
			cli.printLoading();
		}
	});

	// WhatsApp authenticated
	client.on(Events.AUTHENTICATED, () => {
		cli.printAuthenticated();
		updatePage('Autenticado! Carregando mensagens...');
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

		updatePage('Disponível para uso!');
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
