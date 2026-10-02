import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface DiscoveredRoom {
  roomId: string;
  roomName: string;
  hostName: string;
  hostAvatar: string;
  maxPlayers: number;
  playerCount: number;
  category: string;
  createdAt: number;
  lastSeen: number;
}

const CHANNEL_NAME = 'imposter-lan-discovery';
const ANNOUNCE_INTERVAL = 2000;   // host broadcasts every 2s
const STALE_TIMEOUT    = 6000;    // remove room if not seen for 6s
const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#60A5FA;font-weight:bold', ...args);

@Injectable({ providedIn: 'root' })
export class LanDiscoveryService implements OnDestroy {

  rooms$   = new BehaviorSubject<DiscoveredRoom[]>([]);
  /** true only when BroadcastChannel is available */
  readonly supported = typeof BroadcastChannel !== 'undefined';

  private channel: BroadcastChannel | null = null;
  private announceTimer: any = null;
  private pruneTimer: any    = null;
  private hostingRoom: DiscoveredRoom | null = null;

  // ── HOST: advertise room ──────────────────────────────────────────────────

  startHosting(room: DiscoveredRoom) {
    if (!this.supported) return;
    this.hostingRoom = room;
    this._openChannel();
    this._announce();
    this.announceTimer = setInterval(() => this._announce(), ANNOUNCE_INTERVAL);
    log('DISCOVERY', 'Hosting room', room.roomId);
  }

  updateHosting(patch: Partial<DiscoveredRoom>) {
    if (!this.hostingRoom) return;
    this.hostingRoom = { ...this.hostingRoom, ...patch };
  }

  stopHosting() {
    clearInterval(this.announceTimer);
    this.announceTimer = null;
    if (this.hostingRoom && this.channel) {
      this.channel.postMessage({ type: 'ROOM_CLOSED', roomId: this.hostingRoom.roomId });
    }
    this.hostingRoom = null;
    log('DISCOVERY', 'Stopped hosting');
  }

  // ── JOINER: listen for rooms ──────────────────────────────────────────────

  startDiscovery() {
    if (!this.supported) {
      log('DISCOVERY', 'BroadcastChannel not supported — fallback to QR/code');
      return;
    }
    this._openChannel();
    this.pruneTimer = setInterval(() => this._pruneStale(), STALE_TIMEOUT);
    log('DISCOVERY', 'Listening for rooms...');
  }

  stopDiscovery() {
    clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    // Don't close channel here — host may still need it
    log('DISCOVERY', 'Stopped discovery');
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _openChannel() {
    if (this.channel) return;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (e) => this._onMessage(e.data);
  }

  private _announce() {
    if (!this.channel || !this.hostingRoom) return;
    this.channel.postMessage({
      type: 'ROOM_ANNOUNCE',
      room: { ...this.hostingRoom, lastSeen: Date.now() },
    });
  }

  private _onMessage(data: any) {
    if (data.type === 'ROOM_ANNOUNCE') {
      const room: DiscoveredRoom = { ...data.room, lastSeen: Date.now() };
      // Don't list our own hosted room
      if (this.hostingRoom?.roomId === room.roomId) return;
      const current = this.rooms$.value;
      const idx = current.findIndex(r => r.roomId === room.roomId);
      if (idx >= 0) {
        const updated = [...current];
        updated[idx] = room;
        this.rooms$.next(updated);
      } else {
        log('DISCOVERY', 'Found room', room.roomId, room.roomName);
        this.rooms$.next([...current, room]);
      }
    }
    if (data.type === 'ROOM_CLOSED') {
      this.rooms$.next(this.rooms$.value.filter(r => r.roomId !== data.roomId));
      log('DISCOVERY', 'Room closed', data.roomId);
    }
  }

  private _pruneStale() {
    const now = Date.now();
    const fresh = this.rooms$.value.filter(r => now - r.lastSeen < STALE_TIMEOUT);
    if (fresh.length !== this.rooms$.value.length) {
      this.rooms$.next(fresh);
    }
  }

  ngOnDestroy() {
    this.stopHosting();
    this.stopDiscovery();
    this.channel?.close();
    this.channel = null;
  }
}
