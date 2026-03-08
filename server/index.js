const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());

// Health check endpoint for Koyeb/Render/Railway
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map to store connected clients
// Key: WebSocket instance
// Value: { id, name, ip, socket }
const clients = new Map();

// Helper functions for names
const ADJECTIVES = ['Cool', 'Happy', 'Brave', 'Smart', 'Swift', 'Silent', 'Mighty', 'Clever', 'Wild', 'Calm'];
const ANIMALS = ['Fox', 'Panda', 'Tiger', 'Eagle', 'Dolphin', 'Wolf', 'Owl', 'Bear', 'Falcon', 'Panther'];

function generateName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${adj} ${animal}`;
}

// Extract IP, handling proxies
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
}

// Get all clients with the same IP (same network)
function getPeers(ip, excludeId) {
    const peers = [];
    clients.forEach((client) => {
        if (client.ip === ip && client.id !== excludeId) {
            peers.push({
                id: client.id,
                name: client.name
            });
        }
    });
    return peers;
}

// Send a message to a specific client
function sendToClient(targetId, message) {
    clients.forEach((client) => {
        if (client.id === targetId && client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify(message));
        }
    });
}

// Broadcast a message to all users on the same network (excluding sender)
function broadcastToNetwork(ip, excludeId, message) {
    clients.forEach((client) => {
        if (client.ip === ip && client.id !== excludeId && client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify(message));
        }
    });
}

wss.on('connection', (ws, req) => {
    const id = uuidv4();
    const name = generateName();
    const ip = getClientIp(req);

    // Register client
    clients.set(ws, { id, name, ip, socket: ws });

    console.log(`[+] Client connected: ${name} (${id}) from IP: ${ip}`);

    // Send the client their own info and the list of current peers on their network
    ws.send(JSON.stringify({
        type: 'init',
        id: id,
        name: name,
        peers: getPeers(ip, id)
    }));

    // Notify other peers on the network that a new device joined
    broadcastToNetwork(ip, id, {
        type: 'peer-joined',
        peer: { id, name }
    });

    ws.on('message', (messageAsString) => {
        let message;
        try {
            message = JSON.parse(messageAsString);
        } catch (e) {
            console.error('Invalid message format:', e);
            return;
        }

        const sender = clients.get(ws);
        if (!sender) return;

        // Routing WebRTC signaling messages
        switch (message.type) {
            case 'offer':
            case 'answer':
            case 'candidate':
                // The client should provide the target peer's ID
                if (message.target) {
                    sendToClient(message.target, {
                        ...message,
                        sender: sender.id
                    });
                }
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        if (client) {
            console.log(`[-] Client disconnected: ${client.name} (${client.id})`);
            clients.delete(ws);

            // Notify others on the network
            broadcastToNetwork(client.ip, client.id, {
                type: 'peer-left',
                peerId: client.id
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
