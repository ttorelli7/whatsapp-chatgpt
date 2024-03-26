
const express = require('express');
const app = express();
const http = require('http');
const socketIo = require('socket.io');

// Configuração do Socket.io
const server = http.createServer(app);
const io = socketIo(server);

let port = 3001;
//port = 80;
export const serverUrl = `http://localhost:${port}`;
let message = 'Carregando, aguarde...';
let qrCode = '';

export function initRoutes() {
    app.set('view engine', 'ejs');
    app.set('views', __dirname + '/views');

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

    app.get('/calendar', (req, res) => {
        res.render('calendar');
    });
}

export function updateQrCodePage(newMessage, newQrCode = '') {
    message = newMessage;
    qrCode = newQrCode;
    io.emit('reloadPage', { message, qrCode });
}