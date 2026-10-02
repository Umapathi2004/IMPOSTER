import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ProfileService } from './profile.service';
import { WebRTCService, SignalPayload, GameMessage } from './webrtc.service';
import { LanDiscoveryService } from './lan-discovery.service';

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
}

export interface ActiveRoom {
  roomId: string;
  hostName: string;
  hostAvatar: string;
  maxPlayers: number;
  category: string;
  playerCount: number;
  createdAt: number;
}

export type RoomState = 'idle' | 'hosting' | 'joining' | 'connected' | 'error';

const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#4ADE80;font-weight:bold', ...args);

@Injectable({ providedIn: 'root' })
export class RoomService {

  state$       = new BehaviorSubject<RoomState>('idle');
  players$     = new BehaviorSubject<PlayerInfo[]>([]);
  error$       = new BehaviorSubject<string>('');
  activeRooms$ = new BehaviorSubject<ActiveRoom[]>([]);

  config: RoomConfig | null = null;
  isHost = false;
  myPlayerId = '';

  constructor(
    private profileService: ProfileService,
    private webrtc: WebRTCService,
    private lanDiscovery: LanDiscoveryService,
  ) {
    // Listen to incoming DataChannel messages
    this.webrtc.messages$.subscribe(msg => {
      if (msg) this._handleMessage(msg);
    });
  }

  // ── HOST: configure and open offer ───────────────────────────────────────

  async setConfig(cfg: RoomConfig): Promise<void> {
    this.config = cfg;
    this.isHost = true;
    const profile = this.profileService.get()!;
    this.myPlayerId = profile.uid;

    log('ROOM', 'Created', cfg.roomId);
    this.state$.next('hosting');

    // Seed player list with host
    this._setPlayers([{
      uid: profile.uid,
      name: profile.name,
      avatar: profile.avatar,
      isHost: true,
    }]);

    // Advertise via LAN discovery (BroadcastChannel)
    this.lanDiscovery.startHosting({
      roomId: cfg.roomId,
      roomName: `${profile.name}'s Room`,
      hostName: profile.name,
      hostAvatar: profile.avatar,
      maxPlayers: cfg.maxPlayers,
      playerCount: 1,
      category: cfg.category,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    });

    // Create WebRTC offer — generates QR chunks
    await this.webrtc.createOffer(cfg.roomId, profile.uid);

    // When a joiner connects, send them the welcome message
    this.webrtc.messages$.subscribe(msg => {
      if (msg?.type === 'PLAYER_HELLO') this._onPlayerHello(msg);
    });
  }

  // ── HOST: accept scanned answer from joiner ───────────────────────────────

  async receiveAnswer(payload: SignalPayload): Promise<void> {
    log('SIGNAL', 'Receiving answer from joiner', payload.p);
    await this.webrtc.receiveAnswer(payload);
  }

  // ── JOINER: process scanned offer, generate answer ────────────────────────

  async processOffer(payload: SignalPayload): Promise<void> {
    const profile = this.profileService.get()!;
    this.myPlayerId = profile.uid;
    this.isHost = false;
    this.state$.next('joining');

    log('SIGNAL', 'Processing offer from host', payload.p, 'room', payload.r);

    // Store minimal config from offer room ID
    this.config = {
      roomId: payload.r,
      maxPlayers: 8,
      impostorCount: 1,
      category: 'ALL',
    };

    await this.webrtc.createAnswer(payload, profile.uid);

    // When DataChannel opens, send PLAYER_HELLO
    const sub = this.webrtc.connectionState$.subscribe(state => {
      if (state === 'CONNECTED') {
        sub.unsubscribe();
        this._sendHello();
      }
    });
  }

  // ── HOST: handle PLAYER_HELLO ─────────────────────────────────────────────

  private _onPlayerHello(msg: GameMessage) {
    const { uid, name, avatar } = msg.payload;
    const current = this.players$.value;

    if (current.length >= (this.config?.maxPlayers ?? 8)) {
      log('ROOM', 'Room full, rejecting', uid);
      this.webrtc.send('PLAYER_REJECTED', { reason: 'ROOM_FULL' });
      return;
    }

    if (current.find(p => p.uid === uid)) {
      log('ROOM', 'Player already in room', uid);
      return;
    }

    const newPlayer: PlayerInfo = { uid, name, avatar, isHost: false };
    const updated = [...current, newPlayer];
    this._setPlayers(updated);
    log('ROOM', 'Player joined', name, `(${updated.length}/${this.config?.maxPlayers})`);

    // Send acceptance + full game state
    this.webrtc.send('PLAYER_ACCEPTED', {
      uid,
      roomId: this.config!.roomId,
      config: this.config,
      players: updated,
    });

    // Broadcast to all (in star topology, host relays — for now single connection)
    this.webrtc.send('PLAYER_JOINED', { player: newPlayer, players: updated });
    this.state$.next('connected');
  }

  // ── JOINER: send hello after DataChannel opens ────────────────────────────

  private _sendHello() {
    const profile = this.profileService.get()!;
    log('ROOM', 'Sending PLAYER_HELLO');
    this.webrtc.send('PLAYER_HELLO', {
      uid: profile.uid,
      name: profile.name,
      avatar: profile.avatar,
    });
  }

  // ── Message dispatcher ────────────────────────────────────────────────────

  private _handleMessage(msg: GameMessage) {
    log('GAME', 'received', msg.type);
    switch (msg.type) {
      case 'PLAYER_ACCEPTED': {
        const { config, players } = msg.payload;
        this.config = config;
        this._setPlayers(players);
        this.state$.next('connected');
        log('ROOM', 'Accepted into room', config.roomId);
        break;
      }
      case 'PLAYER_JOINED': {
        this._setPlayers(msg.payload.players);
        break;
      }
      case 'PLAYER_LEFT': {
        const updated = this.players$.value.filter(p => p.uid !== msg.payload.uid);
        this._setPlayers(updated);
        break;
      }
      case 'GAME_STATE': {
        // Future: update game state
        break;
      }
    }
  }

  // ── Broadcast to all connected peers ─────────────────────────────────────

  broadcast(type: string, payload: any) {
    this.webrtc.send(type, payload);
  }

  // ── Leave / destroy ───────────────────────────────────────────────────────

  disconnect() {
    if (this.isHost) {
      this.webrtc.send('PLAYER_LEFT', { uid: this.myPlayerId });
      this.lanDiscovery.stopHosting();
    }
    this.webrtc.close();
    this.config = null;
    this.isHost = false;
    this.myPlayerId = '';
    this.state$.next('idle');
    this.players$.next([]);
    this.error$.next('');
    this.activeRooms$.next([]);
    log('ROOM', 'Disconnected');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _setPlayers(players: PlayerInfo[]) {
    this.players$.next(players);
    // Keep activeRooms$ count in sync
    this.lanDiscovery.updateHosting({ playerCount: players.length });
  }

  // Kept for backward compat with join-room screen
  async probeRoom(_roomId: string): Promise<ActiveRoom | null> {
    // Without a server, probing is not possible cross-device.
    // Return null — user must scan QR or enter code.
    return null;
  }

  refreshRooms() { /* no-op — rooms discovered via QR */ }

  static generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}
