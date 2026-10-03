# IMPOSTER Backend Service

A standalone Node.js backend service providing room management, discovery, and real-time multiplayer updates for the IMPOSTER game.

## Features
- **Create Room**: Configure player limits, impostor counts, and categories.
- **Login / Join Room**: Fast room joining by code or active room browser.
- **Active Rooms List**: Dynamic discovery of all active lobbies on the local network or internet.
- **Real-Time WebSocket Sync**: Instant room state updates, player presence, game start broadcasts, and player messaging without WebRTC complexities.
- **Cross-Platform LAN Support**: Discovers LAN/Wi-Fi Hotspot IP addresses for local network gameplay.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
By default, the server starts on `http://0.0.0.0:3000`.

### Development Mode (Auto-restart on change)
```bash
npm run dev
```

## API Endpoints

### REST API
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/ip` | Returns the LAN/Hotspot IPv4 address of the host machine |
| `GET` | `/api/rooms` | Lists all active rooms with player count, category, and host |
| `GET` | `/api/rooms/:id` | Returns complete details and player list for a specific room |
| `POST` | `/api/rooms` | Creates a new room (stores host, rules, and settings) |
| `POST` | `/api/rooms/:id/join` | Joins an active room as a crew member |
| `POST` | `/api/rooms/:id/leave` | Leaves a room; reassigns host or closes empty rooms |
| `DELETE` | `/api/rooms/:id` | Host destroys/closes the room |
| `POST` | `/api/rooms/:id/start` | Host triggers game start for all participants |
| `POST` | `/api/rooms/:id/message` | Sends a custom game message to all room players |

### WebSocket Endpoint
Connect to `ws://<HOST_IP>:3000/ws?roomId=<ROOM_ID>&uid=<PLAYER_UID>`.

#### Events:
- `ROOM_UPDATED`: Sent automatically when players join, leave, or room settings change.
- `GAME_START`: Sent to all players when host clicks Start Game.
- `ROOM_CLOSED`: Sent when host closes or destroys the room.
- `PING` / `PONG`: Heartbeat connection health.
