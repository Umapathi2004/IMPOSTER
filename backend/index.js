// backend/index.js — Standalone Node.js Backend Service for IMPOSTER
// Features:
// - Create room
// - Join / login room
// - Real-time active room list pushed over WebSocket (NO POLLING NEEDED)
// - Real-time room player presence and game state over WebSocket
// - Standalone REST API with full CORS support

const express = require('express');
const http = require('http');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);

// ── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// In-memory room store: roomId -> Room
// Room: {
//   roomId: string,
//   roomName: string,
//   hostId: string,
//   hostName: string,
//   hostAvatar: string,
//   maxPlayers: number,
//   impostorCount: number,
//   category: string,
//   status: 'waiting' | 'in-game' | 'closed',
//   players: Array<{ uid, name, avatar, isHost, joinedAt }>,
//   createdAt: number,
//   lastActive: number
// }
const rooms = new Map();

// All connected WebSocket clients
const allClients = new Set();
// Room subscribers: roomId -> Set<ws>
const roomSockets = new Map();
// Socket metadata: ws -> { roomId, uid, player }
const socketMeta = new Map();

// Helper: Format room summary for active room list
function formatRoomSummary(r) {
  return {
    roomId: r.roomId,
    roomName: r.roomName,
    hostId: r.hostId,
    hostName: r.hostName,
    hostAvatar: r.hostAvatar,
    maxPlayers: r.maxPlayers,
    playerCount: r.players.length,
    impostorCount: r.impostorCount,
    category: r.category,
    status: r.status,
    createdAt: r.createdAt,
    lastActive: r.lastActive,
  };
}

function getActiveRoomsList() {
  return Array.from(rooms.values())
    .filter(r => r.status !== 'closed')
    .map(formatRoomSummary);
}

// Helper: Broadcast updated active rooms to ALL connected clients
function broadcastActiveRooms() {
  const payload = JSON.stringify({
    type: 'ACTIVE_ROOMS',
    rooms: getActiveRoomsList(),
    timestamp: Date.now(),
  });

  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        // Ignored
      }
    }
  }
}

// Helper: Broadcast to all connected sockets inside a specific room
function broadcastToRoom(roomId, message, excludeWs = null) {
  const set = roomSockets.get(roomId);
  if (!set) return;

  const payload = JSON.stringify(message);
  for (const client of set) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        console.error(`[WS] Error sending to room ${roomId}:`, err.message);
      }
    }
  }
}

// Clean up stale inactive rooms every 2 minutes
const ROOM_TTL_MS = 60 * 60 * 1000;
function pruneStaleRooms() {
  const now = Date.now();
  let changed = false;
  for (const [id, r] of rooms) {
    if (now - r.lastActive > ROOM_TTL_MS) {
      console.log(`[BACKEND] Pruning stale room: ${id}`);
      broadcastToRoom(id, { type: 'ROOM_CLOSED', roomId: id, reason: 'EXPIRED' });
      rooms.delete(id);
      roomSockets.delete(id);
      changed = true;
    }
  }
  if (changed) broadcastActiveRooms();
}
setInterval(pruneStaleRooms, 2 * 60 * 1000);

// ── REST API ────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'imposter-backend', rooms: rooms.size, clients: allClients.size });
});

// 1. Detect LAN / Hotspot IPv4 address
app.get('/api/ip', (req, res) => {
  const nets = os.networkInterfaces();
  let candidateIp = null;

  for (const [name, iface] of Object.entries(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        if (/^(wlan|wlp|ap|wifi|hotspot)/i.test(name)) {
          return res.json({ ip: addr.address });
        }
        if (!candidateIp) candidateIp = addr.address;
      }
    }
  }

  res.json({ ip: candidateIp || '127.0.0.1' });
});

// 2. GET /api/rooms — List all active rooms
app.get('/api/rooms', (req, res) => {
  res.json(getActiveRoomsList());
});

// 3. GET /api/rooms/:id — Get details of a specific room
app.get('/api/rooms/:id', (req, res) => {
  const roomId = req.params.id.trim().toUpperCase();
  const room = rooms.get(roomId);

  if (!room || room.status === 'closed') {
    return res.status(404).json({ error: 'Room not found or closed' });
  }

  res.json(room);
});

// 4. POST /api/rooms — Create a new room
app.post('/api/rooms', (req, res) => {
  try {
    const { roomId, roomName, maxPlayers, impostorCount, category, player } = req.body;

    if (!roomId || !player || !player.uid) {
      return res.status(400).json({ error: 'Missing roomId or host player information' });
    }

    const id = roomId.trim().toUpperCase();

    // Check if room code already exists and is active by someone else
    if (rooms.has(id)) {
      const existing = rooms.get(id);
      if (existing.status !== 'closed' && existing.hostId !== player.uid) {
        return res.status(409).json({ error: 'Room with this code is already active' });
      }
    }

    const hostPlayer = {
      uid: player.uid,
      name: player.name || 'Host',
      avatar: player.avatar || '',
      isHost: true,
      joinedAt: Date.now(),
    };

    const newRoom = {
      roomId: id,
      roomName: roomName || `${hostPlayer.name}'s Room`,
      hostId: hostPlayer.uid,
      hostName: hostPlayer.name,
      hostAvatar: hostPlayer.avatar,
      maxPlayers: Number(maxPlayers) || 6,
      impostorCount: Number(impostorCount) || 1,
      category: category || 'ALL',
      status: 'waiting',
      players: [hostPlayer],
      createdAt: Date.now(),
      lastActive: Date.now(),
    };

    rooms.set(id, newRoom);
    console.log(`[BACKEND] Room created: ${id} by host ${hostPlayer.name} (${hostPlayer.uid})`);

    // Broadcast updated rooms list to all clients browsing lobbies
    broadcastActiveRooms();

    res.status(201).json({ success: true, room: newRoom });
  } catch (err) {
    console.error('[API] Error creating room:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. POST /api/rooms/:id/join — Join / login into a room
app.post('/api/rooms/:id/join', (req, res) => {
  try {
    const roomId = req.params.id.trim().toUpperCase();
    const { player } = req.body;

    if (!player || !player.uid) {
      return res.status(400).json({ error: 'Missing player information' });
    }

    const room = rooms.get(roomId);
    if (!room || room.status === 'closed') {
      return res.status(404).json({ error: 'Room not found or no longer active' });
    }

    if (room.status === 'in-game') {
      return res.status(403).json({ error: 'Game already in progress in this room' });
    }

    // Check if player is already in room
    const existingPlayerIndex = room.players.findIndex(p => p.uid === player.uid);

    if (existingPlayerIndex >= 0) {
      // Reconnecting
      room.players[existingPlayerIndex].name = player.name || room.players[existingPlayerIndex].name;
      room.players[existingPlayerIndex].avatar = player.avatar || room.players[existingPlayerIndex].avatar;
      room.lastActive = Date.now();

      broadcastToRoom(roomId, {
        type: 'ROOM_UPDATED',
        room,
        action: 'PLAYER_REJOINED',
        player: room.players[existingPlayerIndex],
      });

      return res.json({ success: true, room, message: 'Reconnected to room' });
    }

    // Check capacity
    if (room.players.length >= room.maxPlayers) {
      return res.status(400).json({ error: 'Room is full' });
    }

    // Add player
    const newPlayer = {
      uid: player.uid,
      name: player.name || 'Crew Member',
      avatar: player.avatar || '',
      isHost: false,
      joinedAt: Date.now(),
    };

    room.players.push(newPlayer);
    room.lastActive = Date.now();

    console.log(`[BACKEND] Player ${newPlayer.name} (${newPlayer.uid}) joined room ${roomId}. Total: ${room.players.length}/${room.maxPlayers}`);

    // Broadcast to room members
    broadcastToRoom(roomId, {
      type: 'ROOM_UPDATED',
      room,
      action: 'PLAYER_JOINED',
      player: newPlayer,
    });

    // Broadcast updated player count to lobby browsers
    broadcastActiveRooms();

    res.json({ success: true, room });
  } catch (err) {
    console.error('[API] Error joining room:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. POST /api/rooms/:id/leave — Player leaves room
app.post('/api/rooms/:id/leave', (req, res) => {
  try {
    const roomId = req.params.id.trim().toUpperCase();
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ error: 'Missing uid' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.json({ success: true, message: 'Room already gone' });
    }

    const leavingPlayer = room.players.find(p => p.uid === uid);
    room.players = room.players.filter(p => p.uid !== uid);
    room.lastActive = Date.now();

    console.log(`[BACKEND] Player ${leavingPlayer?.name || uid} left room ${roomId}. Remaining: ${room.players.length}`);

    // If host leaves or no players remain
    if (room.hostId === uid || room.players.length === 0) {
      if (room.players.length > 0) {
        // Reassign host
        room.players[0].isHost = true;
        room.hostId = room.players[0].uid;
        room.hostName = room.players[0].name;
        room.hostAvatar = room.players[0].avatar;
        console.log(`[BACKEND] Transferred host in room ${roomId} to ${room.hostName}`);

        broadcastToRoom(roomId, {
          type: 'ROOM_UPDATED',
          room,
          action: 'HOST_CHANGED',
          newHost: room.players[0],
        });
      } else {
        // Empty room — close it
        room.status = 'closed';
        broadcastToRoom(roomId, { type: 'ROOM_CLOSED', roomId, reason: 'EMPTY' });
        rooms.delete(roomId);
        roomSockets.delete(roomId);
        console.log(`[BACKEND] Closed empty room ${roomId}`);
      }
    } else {
      broadcastToRoom(roomId, {
        type: 'ROOM_UPDATED',
        room,
        action: 'PLAYER_LEFT',
        uid,
      });
    }

    broadcastActiveRooms();
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Error leaving room:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 7. DELETE /api/rooms/:id — Host destroys room
app.delete('/api/rooms/:id', (req, res) => {
  try {
    const roomId = req.params.id.trim().toUpperCase();
    const room = rooms.get(roomId);

    if (room) {
      room.status = 'closed';
      broadcastToRoom(roomId, { type: 'ROOM_CLOSED', roomId, reason: 'HOST_DESTROYED' });
      rooms.delete(roomId);
      roomSockets.delete(roomId);
      console.log(`[BACKEND] Host destroyed room ${roomId}`);
      broadcastActiveRooms();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Error destroying room:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 8. POST /api/rooms/:id/start — Host starts game
app.post('/api/rooms/:id/start', (req, res) => {
  try {
    const roomId = req.params.id.trim().toUpperCase();
    const { uid } = req.body;

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (uid && room.hostId !== uid) {
      return res.status(403).json({ error: 'Only the host can start the game' });
    }

    if (room.players.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start game' });
    }

    room.status = 'in-game';
    room.lastActive = Date.now();

    console.log(`[BACKEND] Game started in room ${roomId} with ${room.players.length} players!`);

    broadcastToRoom(roomId, {
      type: 'GAME_START',
      roomId,
      config: {
        roomId: room.roomId,
        category: room.category,
        maxPlayers: room.maxPlayers,
        impostorCount: room.impostorCount,
      },
      players: room.players,
    });

    broadcastActiveRooms();
    res.json({ success: true, room });
  } catch (err) {
    console.error('[API] Error starting game:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  allClients.add(ws);

  // Send immediate active rooms list as soon as any client connects
  try {
    ws.send(JSON.stringify({
      type: 'ACTIVE_ROOMS',
      rooms: getActiveRoomsList(),
      timestamp: Date.now(),
    }));
  } catch (e) {}

  // Parse optional roomId and uid from query params
  try {
    const url = new URL(req.url, 'http://localhost');
    const initialRoomId = url.searchParams.get('roomId')?.trim().toUpperCase();
    const initialUid = url.searchParams.get('uid');

    if (initialRoomId) {
      registerSocketInRoom(ws, initialRoomId, initialUid);
    }
  } catch (e) {
    console.error('[WS] URL parse error:', e);
  }

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleWsMessage(ws, data);
    } catch (err) {
      console.error('[WS] Malformed message received:', err.message);
    }
  });

  ws.on('close', () => {
    allClients.delete(ws);
    cleanupSocket(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket error:', err.message);
    allClients.delete(ws);
    cleanupSocket(ws);
  });

  // Welcome ping
  try {
    ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() }));
  } catch (e) {}
});

function registerSocketInRoom(ws, roomId, uid) {
  if (!roomSockets.has(roomId)) {
    roomSockets.set(roomId, new Set());
  }
  roomSockets.get(roomId).add(ws);
  socketMeta.set(ws, { roomId, uid });

  // Send current room state to joining socket immediately
  const room = rooms.get(roomId);
  if (room && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'ROOM_UPDATED', room }));
    } catch (e) {}
  }
}

function cleanupSocket(ws) {
  const meta = socketMeta.get(ws);
  if (meta) {
    const { roomId, uid } = meta;
    const set = roomSockets.get(roomId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        roomSockets.delete(roomId);
      }
    }
    socketMeta.delete(ws);
    console.log(`[WS] Client disconnected from room ${roomId} (uid: ${uid || 'anon'})`);
  }
}

function handleWsMessage(ws, data) {
  const { type, roomId, uid, player, payload } = data;
  const upperRoomId = roomId ? roomId.trim().toUpperCase() : null;

  switch (type) {
    // Client joins room channel
    case 'JOIN_ROOM': {
      if (upperRoomId) {
        registerSocketInRoom(ws, upperRoomId, uid || player?.uid);
        console.log(`[WS] Socket registered for room ${upperRoomId}`);

        // If player provided, also ensure they are in the room object
        const room = rooms.get(upperRoomId);
        if (room && player && player.uid) {
          const idx = room.players.findIndex(p => p.uid === player.uid);
          if (idx === -1 && room.players.length < room.maxPlayers) {
            room.players.push({
              uid: player.uid,
              name: player.name || 'Crew Member',
              avatar: player.avatar || '',
              isHost: false,
              joinedAt: Date.now(),
            });
            room.lastActive = Date.now();
            broadcastToRoom(upperRoomId, { type: 'ROOM_UPDATED', room, action: 'PLAYER_JOINED', player });
            broadcastActiveRooms();
          }
        }
      }
      break;
    }

    // Client requests fresh active rooms list
    case 'GET_ACTIVE_ROOMS': {
      try {
        ws.send(JSON.stringify({
          type: 'ACTIVE_ROOMS',
          rooms: getActiveRoomsList(),
          timestamp: Date.now(),
        }));
      } catch (e) {}
      break;
    }

    // Client leaves room channel
    case 'LEAVE_ROOM': {
      cleanupSocket(ws);
      break;
    }

    // Heartbeat
    case 'PING': {
      try {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      } catch (e) {}
      break;
    }

    // Request room sync
    case 'SYNC_ROOM': {
      if (upperRoomId && rooms.has(upperRoomId)) {
        try {
          ws.send(JSON.stringify({ type: 'ROOM_UPDATED', room: rooms.get(upperRoomId) }));
        } catch (e) {}
      }
      break;
    }

    // In-game broadcast
    case 'GAME_ACTION': {
      if (upperRoomId) {
        broadcastToRoom(upperRoomId, {
          type: 'GAME_ACTION',
          payload,
          senderUid: uid,
          timestamp: Date.now(),
        }, ws);
      }
      break;
    }

    default:
      // Unknown type
      break;
  }
}

// ── Static Frontend Serving (Optional standalone production mode) ───────────
const distPath = path.join(__dirname, '../dist/IMPOSTER/browser');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log(`[BACKEND] Serving Angular frontend build from ${distPath}`);
}

// ── Process Crash Guards ────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ [BACKEND ERROR] Port ${PORT} is already in use by another process.`);
    console.error(`Run this command to free port ${PORT}: fuser -k ${PORT}/tcp\n`);
    process.exit(1);
  } else {
    console.error('[BACKEND ERROR]', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`  IMPOSTER Backend Service running on port ${PORT}`);
  console.log(`  REST API:   http://0.0.0.0:${PORT}/api/rooms`);
  console.log(`  WebSocket:  ws://0.0.0.0:${PORT}/ws`);
  console.log(`===================================================`);
});
