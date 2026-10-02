// server.js — Room discovery server for IMPOSTER
// Run with: node server.js
// Angular dev server proxies /api and /ws to this

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*');
  res.setHeader('Feature-Policy', 'camera *; microphone *');
  next();
});

// In-memory room store: roomId -> ActiveRoom
const rooms = new Map();
const ROOM_TTL = 2 * 60 * 60 * 1000; // 2 hours

function cleanExpired() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL) rooms.delete(id);
  }
}

function broadcast(wss, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// REST endpoints
app.get('/api/ip', (req, res) => {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return res.json({ ip: addr.address });
      }
    }
  }
  res.json({ ip: 'N/A' });
});

app.get('/api/rooms', (req, res) => {
  cleanExpired();
  res.json(Array.from(rooms.values()));
});

app.post('/api/rooms', (req, res) => {
  const room = { ...req.body, createdAt: Date.now() };
  rooms.set(room.roomId, room);
  broadcast(wss, { type: 'rooms', rooms: Array.from(rooms.values()) });
  res.json({ ok: true });
});

app.delete('/api/rooms/:id', (req, res) => {
  rooms.delete(req.params.id);
  broadcast(wss, { type: 'rooms', rooms: Array.from(rooms.values()) });
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  cleanExpired();
  ws.send(JSON.stringify({ type: 'rooms', rooms: Array.from(rooms.values()) }));
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`IMPOSTER room server running on http://0.0.0.0:${PORT}`);
});
