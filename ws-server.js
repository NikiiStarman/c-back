const WebSocket = require('ws');
const isValidUTF8 = require('utf-8-validate');

const wsPort = process.env.WSS_PORT || 1337;
const timeoutLength = process.env.TIMEOUT_LENGTH_MS || 10000;
const maxMessageLength = process.env.MAX_MESSAGE_LENGTH || 280;

const bunyan = require('bunyan');
const log = bunyan.createLogger({name: 'chat-server'});

const wss = new WebSocket.Server({ port: wsPort });

log.warn({
    type: 'server-up',
});

const nicknameRegex = /^[a-z0-9]{2,10}$/i;

// SIGINT for Windows
if (process.platform === "win32") {
    const rl = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on("SIGINT", () => {
        process.emit("SIGINT");
    });
}

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validateNickname(data) {
    if (!isValidUTF8(Buffer.from(data))) {
        return false;
    }
    let nickname = htmlEntities(data);
    if (nickname.match(nicknameRegex) === null) {
        return false;
    }
    return nickname;
}

function nicknameTaken(nickname) {
    let result = false;
    wss.clients.forEach((client) => {
        if (client.nickname === nickname) {
            result = true;
        }
    });
    return result;
}

function validateMessage(data) {
    if (data.length > maxMessageLength || !isValidUTF8(Buffer.from(data))) {
        return false;
    }
    return htmlEntities(data);
}

function serverMessage(text) {
    return JSON.stringify({
        type:   'info',
        data:   {
            time: (new Date()).getTime(),
            text: text
        }
    });
}

wss.broadcast = (data) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.nickname) {
            client.send(data);
        }
    });
};

wss.on('connection', (ws, req) => {
    const ip = req.connection.remoteAddress;

    log.info({
        type: 'new-connection',
        ip: ip,
    });

    let nickname = false;
    let terminated = false;

    ws.timeout = setTimeout(() => onTimeout(), timeoutLength);

    function onTimeout() {
        terminated = true;
        ws.terminate('onTimeout ws.terminate');
        log.info({
            type: 'disconnect',
            reason: 'timeout',
            user: {
                ip: ip,
                nickname: ws.nickname
            }
        });
        wss.broadcast(serverMessage(nickname + ' was disconnected due to inactivity'));
    }

    ws.on('message', (data) => {
        clearTimeout(ws.timeout);
        log.info({
            type: 'message',
            data: data,
            user: {
                ip: ip,
                nickname: ws.nickname
            }
        });

        if (isNewUser()) {
            let validNickname = checkProvidedNickname();
            if (validNickname) {
                registerUser();
            }
        } else {
            let message = parseMessage();
            if (message) {
                wss.broadcast(message);
            }
        }

        function isNewUser() {
            return ws.nickname == null
        }

        function checkProvidedNickname() {
            nickname = validateNickname(data);
            if (nickname === false) {
                ws.send(JSON.stringify({
                    type: 'error',
                    text: 'Invalid nickname. Min 2, max 10, latin characters or numbers.'
                }));
                return false;
            }
            if (nicknameTaken(nickname)) {
                ws.send(JSON.stringify({
                    type: 'error',
                    text: 'Failed to connect. Nickname already taken.'
                }));
                return false;
            }
            return true;
        }

        function registerUser() {
            ws.nickname = nickname;
            ws.send(JSON.stringify({
                type:'user',
                data: {
                    name: nickname
                }
            }));

            let newUserMessage = serverMessage(nickname + ' has joined');
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN && client.nickname) {
                    client.send(newUserMessage);
                }
            });

            log.info({
                type: 'new-user',
                user: {
                    ip: ip,
                    nickname: ws.nickname
                }
            });
        }

        function parseMessage() {
            let messageText = validateMessage(data);
            if (messageText === false) {
                ws.send(JSON.stringify({
                    type: 'error',
                    text: 'Invalid message. Max ' + maxMessageLength + ' characters.'
                }));
                return false;
            }
            let obj = {
                time: (new Date()).getTime(),
                text: htmlEntities(data),
                author: ws.nickname
            };
            return JSON.stringify({ type:'message', data: obj });
        }

        ws.timeout = setTimeout(() => onTimeout(), timeoutLength);
    });

    ws.on('close', () => {
        clearTimeout(ws.timeout);
        log.info({
            type: 'disconnect',
            reason: 'unknown',
            user: {
                ip: ip,
                nickname: ws.nickname
            }
        });
        if (nickname !== false && terminated !== true) {
            wss.broadcast(serverMessage(nickname + ' left the chat, connection lost'));
        }
    });

    ws.on("error", (err) => {
        clearTimeout(ws.timeout);
        log.error({
            type: 'error',
            error: err
        });

    });
});

process.on('SIGTERM',   () => shutdown('SIGTERM'));
process.on('SIGINT',    () => shutdown('SIGINT'));

function shutdown(signal) {
    log.warn({
        type: 'shutdown',
        signal: signal,
        status: 'start'
    });

    wss.close((err) => {

        if (err) {
            log.error({
                type: 'error',
                error: err
            });
            process.exit(1)
        }

        log.warn({
            type: 'shutdown',
            signal: signal,
            status: 'end'
        });
        process.exit()
    })
}