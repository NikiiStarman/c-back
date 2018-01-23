const WebSocket = require('ws');
const isValidUTF8 = require('utf-8-validate');

const wsPort = process.env.WSS_PORT || 1337;
const timeoutLength = process.env.TIMEOUT_LENGTH_MS || 180000;
const maxMessageLength = process.env.MAX_MESSAGE_LENGTH || 280;

const wss = new WebSocket.Server({ port: wsPort });

const nicknameRegex = /^[a-z0-9]{2,10}$/i;

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
    wss.clients.forEach(function each(client) {
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

wss.broadcast = function broadcast(data) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN && client.nickname) {
            client.send(data);
        }
    });
};

wss.on('connection', function connection(ws, req) {
    const ip = req.connection.remoteAddress;
    let nickname = false;
    let terminated = false;

    ws.timeout = setTimeout(() => onTimeout(), timeoutLength);

    function onTimeout() {
        terminated = true;
        ws.terminate();
        wss.broadcast(serverMessage(nickname + ' was disconnected due to inactivity'));
    }

    ws.on('message', function incoming(data) {
        clearTimeout(ws.timeout);
        console.log('received: %s', data, 'ip: ', ip);
        console.log('We have ' + wss.clients.size + ' clients');

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
            wss.clients.forEach(function each(client) {
                if (client !== ws && client.readyState === WebSocket.OPEN && client.nickname) {
                    client.send(newUserMessage);
                }
            });

            console.log((new Date()) + ' User is known as: ' + nickname + '.');
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

    ws.on('close', function close() {
        clearTimeout(ws.timeout);
        console.log('disconnected');
        if (nickname !== false && terminated !== true) {
            console.log((new Date()) + " Peer " + ip + " disconnected.");

            wss.broadcast(serverMessage(nickname + ' left the chat, connection lost'));
        }
    });

    ws.on("error", function error (err) {
        clearTimeout(ws.timeout);
        console.log("Caught flash policy server socket error: ");
        console.log(err.stack);

    });
});