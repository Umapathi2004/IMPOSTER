import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { ProfileService, UserProfile } from './profile.service';

export interface RoomConfig {
  roomId: string;
  maxPlayers: number;
  impostorCount: number;
  category: string;
}

export interface PlayerInfo {
  uid: string;
  name: string;
  avatar: string;
  isHost: boolean;
  joinedAt?: number;
}

export interface ActiveRoom {
  roomId: string;
  roomName: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  maxPlayers: number;
  playerCount: number;
  impostorCount: number;
  category: string;
  status: 'waiting' | 'in-game' | 'closed';
  createdAt: number;
  lastActive: number;
}

export interface GameMessage {
  type: string;
  payload?: any;
  senderUid?: string;
  timestamp?: number;
}

export type RoomState = 'idle' | 'hosting' | 'joining' | 'connected' | 'error';
export type ConnectionStatus = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';

const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#4ADE80;font-weight:bold', ...args);

@Injectable({ providedIn: 'root' })
export class RoomService implements OnDestroy {

  state$            = new BehaviorSubject<RoomState>('idle');
  connectionState$  = new BehaviorSubject<ConnectionStatus>('IDLE');
  players$          = new BehaviorSubject<PlayerInfo[]>([]);
  activeRooms$      = new BehaviorSubject<ActiveRoom[]>([]);
  error$            = new BehaviorSubject<string>('');
  messages$         = new Subject<GameMessage>();
  gameStart$        = new Subject<{ config: RoomConfig; players: PlayerInfo[] }>();
  roomClosed$       = new Subject<string>();

  config: RoomConfig | null = null;
  isHost = false;
  myPlayerId = '';
  currentRoomId: string | null = null;

  private ws: WebSocket | null = null;
  private wsConnecting = false;
  private reconnectTimer: any = null;
  private pingTimer: any = null;

  constructor(private profileService: ProfileService) {
    // Connect to WebSocket immediately to receive live active rooms
    this.ensureWebSocketConnected();
  }

  // ── Helper: URLs ──────────────────────────────────────────────────────────

  private getApiUrl(path: string): string {
    if (window.location.port === '3000' || !window.location.port) {
      return path;
    }
    const host = window.location.hostname || 'localhost';
    const protocol = window.location.protocol || 'http:';
    return `${protocol}//${host}:3000${path}`;
  }

  private getWsUrl(): string {
    const isHttps = window.location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = window.location.port === '3000' || !window.location.port ? '' : ':3000';
    return `${proto}//${host}${port}/ws`;
  }

  // ── Persistent Single WebSocket Connection ────────────────────────────────

  ensureWebSocketConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.wsConnecting) return;

    this.wsConnecting = true;
    const url = this.getWsUrl();
    log('WS', 'Connecting to', url);

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        log('WS', 'Connected to backend WebSocket');
        this.wsConnecting = false;
        this.connectionState$.next('CONNECTED');

        // If currently in a room, re-register
        if (this.currentRoomId && this.myPlayerId) {
          const profile = this.profileService.get();
          this.ws?.send(JSON.stringify({
            type: 'JOIN_ROOM',
            roomId: this.currentRoomId,
            uid: this.myPlayerId,
            player: profile,
          }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleWsMessage(data);
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.wsConnecting = false;
        this.ws = null;
        log('WS', 'Disconnected from backend WebSocket — will reconnect');
        if (this.state$.value === 'connected' || this.state$.value === 'hosting') {
          this.connectionState$.next('DISCONNECTED');
        }
        // Auto-reconnect in 2 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.ensureWebSocketConnected(), 2000);
      };

      this.ws.onerror = (err) => {
        this.wsConnecting = false;
        log('WS', 'WebSocket error:', err);
      };

      // Heartbeat ping every 20s
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'PING' }));
        }
      }, 20000);

    } catch (e) {
      this.wsConnecting = false;
      log('WS', 'Failed to initialize WebSocket', e);
    }
  }

  private _handleWsMessage(msg: any) {
    switch (msg.type) {
      // Live list of active rooms pushed from backend
      case 'ACTIVE_ROOMS': {
        if (Array.isArray(msg.rooms)) {
          this.activeRooms$.next(msg.rooms);
        }
        break;
      }

      // Room state updated (players joined / left / reconnected)
      case 'ROOM_UPDATED': {
        if (msg.room) {
          if (!this.currentRoomId || msg.room.roomId === this.currentRoomId) {
            this._applyRoomData(msg.room);
          }
        }
        break;
      }

      // Host started the game
      case 'GAME_START': {
        log('GAME', 'GAME_START received');
        if (msg.config && msg.players) {
          this.config = msg.config;
          this.players$.next(msg.players);
          this.gameStart$.next({ config: msg.config, players: msg.players });
        }
        break;
      }

      // Room closed / destroyed
      case 'ROOM_CLOSED': {
        log('ROOM', 'Room closed by server / host');
        this.roomClosed$.next(msg.reason || 'Room closed');
        this.resetRoomState();
        break;
      }

      case 'GAME_ACTION':
      case 'GAME_MESSAGE': {
        this.messages$.next({
          type: msg.type,
          payload: msg.payload,
          senderUid: msg.senderUid,
          timestamp: msg.timestamp,
        });
        break;
      }
    }
  }

  // ── 1. Create Room (Host) ─────────────────────────────────────────────────

  async createRoom(cfg: RoomConfig): Promise<boolean> {
    const profile = this.profileService.get();
    if (!profile) {
      this.error$.next('Profile required to create room');
      return false;
    }

    this.ensureWebSocketConnected();
    this.state$.next('hosting');
    this.connectionState$.next('CONNECTING');
    this.config = cfg;
    this.isHost = true;
    this.myPlayerId = profile.uid;
    this.currentRoomId = cfg.roomId;

    const payload = {
      roomId: cfg.roomId,
      roomName: `${profile.name}'s Room`,
      maxPlayers: cfg.maxPlayers,
      impostorCount: cfg.impostorCount,
      category: cfg.category,
      player: {
        uid: profile.uid,
        name: profile.name,
        avatar: profile.avatar,
      },
    };

    try {
      const res = await fetch(this.getApiUrl('/api/rooms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      log('ROOM', 'Room created on backend', data.room.roomId);

      this._applyRoomData(data.room);

      // Register socket in this room channel
      this._sendWs({
        type: 'JOIN_ROOM',
        roomId: cfg.roomId,
        uid: profile.uid,
        player: profile,
      });

      this.state$.next('connected');
      this.connectionState$.next('CONNECTED');
      return true;
    } catch (err: any) {
      log('ROOM', 'Failed to create room:', err);
      this.error$.next(err.message || 'Failed to create room on server');
      this.connectionState$.next('FAILED');
      this.state$.next('error');
      return false;
    }
  }

  // ── 2. Join Room (Crew) ───────────────────────────────────────────────────

  async joinRoom(roomId: string): Promise<boolean> {
    const profile = this.profileService.get();
    if (!profile) {
      this.error$.next('Profile required to join room');
      return false;
    }

    this.ensureWebSocketConnected();
    const cleanRoomId = roomId.trim().toUpperCase();
    this.state$.next('joining');
    this.connectionState$.next('CONNECTING');
    this.myPlayerId = profile.uid;
    this.currentRoomId = cleanRoomId;

    try {
      const res = await fetch(this.getApiUrl(`/api/rooms/${cleanRoomId}/join`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            uid: profile.uid,
            name: profile.name,
            avatar: profile.avatar,
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Could not join room (${res.status})`);
      }

      const data = await res.json();
      log('ROOM', 'Joined room successfully', data.room.roomId);

      this._applyRoomData(data.room);

      // Register socket in this room channel
      this._sendWs({
        type: 'JOIN_ROOM',
        roomId: cleanRoomId,
        uid: profile.uid,
        player: profile,
      });

      this.state$.next('connected');
      this.connectionState$.next('CONNECTED');
      return true;
    } catch (err: any) {
      log('ROOM', 'Failed to join room:', err);
      this.error$.next(err.message || 'Could not connect to room');
      this.connectionState$.next('FAILED');
      this.state$.next('error');
      return false;
    }
  }

  // ── 3. Fetch Active Rooms (One-time REST if needed, WS keeps it synced) ────

  async fetchActiveRooms(): Promise<ActiveRoom[]> {
    this.ensureWebSocketConnected();
    try {
      const res = await fetch(this.getApiUrl('/api/rooms'));
      if (res.ok) {
        const list: ActiveRoom[] = await res.json();
        this.activeRooms$.next(list);
        return list;
      }
    } catch (err) {
      // WS will still deliver if available
    }
    return this.activeRooms$.value;
  }

  // ── 4. Leave Room ─────────────────────────────────────────────────────────

  async leaveRoom(): Promise<void> {
    const roomId = this.currentRoomId;
    const uid = this.myPlayerId;

    if (roomId && uid) {
      this._sendWs({ type: 'LEAVE_ROOM', roomId, uid });
      try {
        await fetch(this.getApiUrl(`/api/rooms/${roomId}/leave`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid }),
        });
      } catch (e) {}
    }

    this.resetRoomState();
  }

  // ── 5. Destroy Room (Host) ────────────────────────────────────────────────

  async destroyRoom(): Promise<void> {
    const roomId = this.currentRoomId;
    if (roomId) {
      try {
        await fetch(this.getApiUrl(`/api/rooms/${roomId}`), {
          method: 'DELETE',
        });
      } catch (e) {}
    }

    this.resetRoomState();
  }

  // ── 6. Start Game (Host) ──────────────────────────────────────────────────

  async startGame(): Promise<boolean> {
    if (!this.currentRoomId) return false;

    try {
      const res = await fetch(this.getApiUrl(`/api/rooms/${this.currentRoomId}/start`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: this.myPlayerId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start game');
      }

      return true;
    } catch (err: any) {
      log('ROOM', 'Failed to start game:', err);
      this.error$.next(err.message || 'Failed to start game');
      return false;
    }
  }

  // ── 7. Send Game Action / Message ─────────────────────────────────────────

  sendMessage(type: string, payload: any) {
    if (this.currentRoomId) {
      this._sendWs({
        type: 'GAME_ACTION',
        roomId: this.currentRoomId,
        uid: this.myPlayerId,
        payload,
      });
    }
  }

  private _sendWs(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (e) {}
    }
  }

  private _applyRoomData(room: any) {
    this.config = {
      roomId: room.roomId,
      maxPlayers: room.maxPlayers,
      impostorCount: room.impostorCount,
      category: room.category,
    };

    if (Array.isArray(room.players)) {
      this.players$.next(room.players);
    }

    this.isHost = (room.hostId === this.myPlayerId);
  }

  resetRoomState() {
    this.currentRoomId = null;
    this.config = null;
    this.isHost = false;
    this.state$.next('idle');
    this.connectionState$.next('IDLE');
    this.players$.next([]);
    this.error$.next('');
  }

  static generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  ngOnDestroy() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
  }
}
