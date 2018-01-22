const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 1337 });

/**
 * Helper function for escaping input strings
 */
function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Array with some colors
var colors = [ 'red', 'green', 'blue', 'magenta', 'purple', 'plum', 'orange' ];

function noop() {}

function heartbeat() {
    console.log('pong');
    this.isAlive = true;
}

wss.broadcast = function broadcast(data) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

wss.on('connection', function connection(ws, req) {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    const ip = req.connection.remoteAddress;
    // we need to know client index to remove them on 'close' event
    // var index = wss.clients.push(connection) - 1;
    var userName = false;
    // var userColor = false;
    // let userId = false;

    ws.on('message', function incoming(data) {
        console.log('received: %s', data, 'ip: ', ip);
        console.log('We have ' + wss.clients.size + ' clients');
        // console.log(ws);
        if (userName === false) { // first message sent by user is their name
            // remember user name
            userName = htmlEntities(data);
            // get random color and send it back to the user
            // userColor = colors.shift();
            // userId = ids.shift();
            wss.clients.forEach(function each(client) {
                if (client.nickname === userName) {
                    return ws.send(JSON.stringify({
                        type: 'error',
                        text: 'Failed to connect. Nickname already taken.'
                    }))
                }
            });
            ws.nickname = userName;
            ws.send(JSON.stringify({
                type:'user',
                data: {
                    name: userName
                }
            }));
            // Broadcast to everyone else.
            wss.clients.forEach(function each(client) {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type:'info', data: {
                            time: (new Date()).getTime(),
                            text: userName + ' has joined'
                        } }));
                }
            });
            console.log((new Date()) + ' User is known as: ' + userName + '.');

        } else { // log and broadcast the message
            console.log((new Date()) + ' Received Message from '
                        + userName + ': ' + data);
            
            var obj = {
                time: (new Date()).getTime(),
                text: htmlEntities(data),
                author: userName
            };
            // broadcast message to all connected clients
            var json = JSON.stringify({ type:'message', data: obj });
            wss.broadcast(json);
            // for (var i=0; i < wss.clients.length; i++) {
            //     wss.clients[i].send(json);
            // }
        }
    });

    ws.on('close', function close() {
        console.log('disconnected');
        if (userName !== false) {
            console.log((new Date()) + " Peer "
                + ip + " disconnected.");
            // remove user from the list of connected clients
            // wss.clients.splice(index, 1);
            wss.broadcast(JSON.stringify({ type:'message', data: {
                    time: (new Date()).getTime(),
                    text: userName + ' left the chat, connection lost',
                    author: 'Server'
                } }));
            // push back user's color to be reused by another user
            // colors.push(userColor);
        }
    });

    ws.on("error", function error (err) {
        console.log("Caught flash policy server socket error: ");
        console.log(err.stack);

    });

  // ws.send('something');
});

const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();

        ws.isAlive = false;
        ws.ping(noop);
    });
}, 3000);