import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import QRCode from 'qrcode';

export type ConnectionState =
  | 'IDLE' | 'CREATING_ROOM' | 'WAITING_FOR_PLAYERS'
  | 'SIGNALING' | 'CONNECTING' | 'CONNECTED'
  | 'DISCONNECTED' | 'FAILED' | 'CLOSED';

export interface SignalPayload {
  v: 1;
  r: string;
  p: string;
  t: 'offer' | 'answer';
  s: string;
}

export interface QrChunk {
  sid: string;
  i: number;
  n: number;
  d: string;
}

export interface GameMessage {
  id: string;
  type: string;
  timestamp: number;
  payload: any;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};
const CHUNK_SIZE  = 800;
const ICE_TIMEOUT = 5000;

const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#E88A52;font-weight:bold', ...args);

@Injectable({ providedIn: 'root' })
export class WebRTCService {

  connectionState$ = new BehaviorSubject<ConnectionState>('IDLE');
  messages$        = new BehaviorSubject<GameMessage | null>(null);

  // Chunks
  offerChunks$     = new BehaviorSubject<QrChunk[]>([]);
  answerChunks$    = new BehaviorSubject<QrChunk[]>([]);
  qrChunks$        = new BehaviorSubject<QrChunk[]>([]);
  currentChunkIdx$ = new BehaviorSubject<number>(0);

  // Locally generated QR data URLs (no internet needed)
  offerQrUrls$     = new BehaviorSubject<string[]>([]);
  answerQrUrls$    = new BehaviorSubject<string[]>([]);

  private hostPc: RTCPeerConnection | null = null;
  private hostDc: RTCDataChannel   | null = null;
  private joinPc: RTCPeerConnection | null = null;
  private joinDc: RTCDataChannel   | null = null;

  private get dc(): RTCDataChannel | null {
    if (this.hostDc?.readyState === 'open') return this.hostDc;
    if (this.joinDc?.readyState === 'open') return this.joinDc;
    return this.hostDc ?? this.joinDc;
  }

  private newMsgId() { return Math.random().toString(36).slice(2, 10); }

  private setState(s: ConnectionState) {
    log('STATE', s);
    this.connectionState$.next(s);
  }

  // ── QR chunking ───────────────────────────────────────────────────────────

  private encodeToChunks(payload: SignalPayload): QrChunk[] {
    const json  = JSON.stringify(payload);
    const total = Math.ceil(json.length / CHUNK_SIZE);
    const sid   = Math.random().toString(36).slice(2, 8);
    const chunks: QrChunk[] = [];
    for (let i = 0; i < total; i++) {
      chunks.push({ sid, i, n: total, d: json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
    }
    log('SIGNAL', `Encoded ${total} chunk(s), ${json.length} chars`);
    return chunks;
  }

  private async chunksToQrUrls(chunks: QrChunk[]): Promise<string[]> {
    return Promise.all(chunks.map(chunk =>
      QRCode.toDataURL(JSON.stringify(chunk), {
        errorCorrectionLevel: 'L',
        width: 280,
        margin: 2,
        color: { dark: '#B43F1A', light: '#180600' },
      })
    ));
  }

  decodeChunks(chunks: QrChunk[]): SignalPayload | null {
    if (!chunks.length) return null;
    const sorted = [...chunks].sort((a, b) => a.i - b.i);
    if (sorted.length !== sorted[0].n) return null;
    try { return JSON.parse(sorted.map(c => c.d).join('')); } catch { return null; }
  }

  parseChunk(raw: string): QrChunk | null {
    try { return JSON.parse(raw) as QrChunk; } catch { return null; }
  }

  // ── ICE wait ──────────────────────────────────────────────────────────────

  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, ICE_TIMEOUT);
    });
  }

  // ── DataChannel wiring ────────────────────────────────────────────────────

  private wireDataChannel(dc: RTCDataChannel, role: 'host' | 'join') {
    dc.onopen    = () => { log('DATA', `[${role}] open`); this.setState('CONNECTED'); };
    dc.onclose   = () => { log('DATA', `[${role}] closed`); this.setState('DISCONNECTED'); };
    dc.onerror   = (e) => log('DATA', `[${role}] error`, e);
    dc.onmessage = (e) => {
      try {
        const msg: GameMessage = JSON.parse(e.data);
        log('DATA', `[${role}] rx`, msg.type);
        this.messages$.next(msg);
      } catch { log('DATA', 'parse error', e.data); }
    };
  }

  // ── HOST: create offer ────────────────────────────────────────────────────

  async createOffer(roomId: string, hostPlayerId: string): Promise<void> {
    log('WEBRTC', 'createOffer', roomId);
    this.setState('CREATING_ROOM');

    this.hostDc?.close(); this.hostPc?.close();

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.hostPc = pc;

    pc.oniceconnectionstatechange = () => {
      log('ICE', '[host]', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') this.setState('FAILED');
    };
    pc.onconnectionstatechange = () => {
      log('WEBRTC', '[host]', pc.connectionState);
      if (pc.connectionState === 'connected')    this.setState('CONNECTED');
      if (pc.connectionState === 'failed')       this.setState('FAILED');
      if (pc.connectionState === 'disconnected') this.setState('DISCONNECTED');
    };

    const dc = pc.createDataChannel('imposter-game', { ordered: true });
    this.hostDc = dc;
    this.wireDataChannel(dc, 'host');

    await pc.setLocalDescription(await pc.createOffer());
    log('SIGNAL', 'Offer created, waiting for ICE...');
    await this.waitForIce(pc);
    log('SIGNAL', 'ICE complete');

    const payload: SignalPayload = {
      v: 1, r: roomId, p: hostPlayerId, t: 'offer',
      s: pc.localDescription!.sdp,
    };

    const chunks = this.encodeToChunks(payload);
    const urls   = await this.chunksToQrUrls(chunks);

    this.offerChunks$.next(chunks);
    this.offerQrUrls$.next(urls);
    this.qrChunks$.next(chunks);
    this.currentChunkIdx$.next(0);
    this.setState('WAITING_FOR_PLAYERS');
    log('SIGNAL', `Offer QR ready (${chunks.length} chunk(s))`);
  }

  // ── HOST: receive answer ──────────────────────────────────────────────────

  async receiveAnswer(payload: SignalPayload): Promise<void> {
    if (!this.hostPc) { log('WEBRTC', 'receiveAnswer: no hostPc'); return; }
    log('WEBRTC', 'Setting answer on hostPc');
    this.setState('CONNECTING');
    await this.hostPc.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: payload.s })
    );
    log('WEBRTC', 'Remote desc set — waiting for connection...');
  }

  // ── JOINER: create answer ─────────────────────────────────────────────────

  async createAnswer(payload: SignalPayload, joinerPlayerId: string): Promise<void> {
    log('WEBRTC', 'createAnswer for room', payload.r);
    this.setState('SIGNALING');

    this.joinDc?.close(); this.joinPc?.close();

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.joinPc = pc;

    pc.oniceconnectionstatechange = () => {
      log('ICE', '[join]', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') this.setState('FAILED');
    };
    pc.onconnectionstatechange = () => {
      log('WEBRTC', '[join]', pc.connectionState);
      if (pc.connectionState === 'connected')    this.setState('CONNECTED');
      if (pc.connectionState === 'failed')       this.setState('FAILED');
      if (pc.connectionState === 'disconnected') this.setState('DISCONNECTED');
    };
    pc.ondatachannel = (e) => {
      log('DATA', '[join] got channel');
      this.joinDc = e.channel;
      this.wireDataChannel(e.channel, 'join');
    };

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: payload.s })
    );
    await pc.setLocalDescription(await pc.createAnswer());
    log('SIGNAL', 'Answer created, waiting for ICE...');
    await this.waitForIce(pc);
    log('SIGNAL', 'ICE complete');

    const answerPayload: SignalPayload = {
      v: 1, r: payload.r, p: joinerPlayerId, t: 'answer',
      s: pc.localDescription!.sdp,
    };

    const chunks = this.encodeToChunks(answerPayload);
    const urls   = await this.chunksToQrUrls(chunks);

    this.answerChunks$.next(chunks);
    this.answerQrUrls$.next(urls);
    this.qrChunks$.next(chunks);
    this.currentChunkIdx$.next(0);
    log('SIGNAL', `Answer QR ready (${chunks.length} chunk(s))`);
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  send(type: string, payload: any): boolean {
    const dc = this.dc;
    if (dc?.readyState !== 'open') { log('DATA', 'Cannot send — no open channel'); return false; }
    const msg: GameMessage = { id: this.newMsgId(), type, timestamp: Date.now(), payload };
    dc.send(JSON.stringify(msg));
    log('DATA', 'sent', type);
    return true;
  }

  // ── QR navigation ─────────────────────────────────────────────────────────

  nextChunk() {
    const idx = this.currentChunkIdx$.value;
    if (idx < this.qrChunks$.value.length - 1) this.currentChunkIdx$.next(idx + 1);
  }

  prevChunk() {
    const idx = this.currentChunkIdx$.value;
    if (idx > 0) this.currentChunkIdx$.next(idx - 1);
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getDiagnostics(): object {
    return {
      host: this.hostPc ? { conn: this.hostPc.connectionState, ice: this.hostPc.iceConnectionState, dc: this.hostDc?.readyState } : 'none',
      join: this.joinPc ? { conn: this.joinPc.connectionState, ice: this.joinPc.iceConnectionState, dc: this.joinDc?.readyState } : 'none',
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  close() {
    log('WEBRTC', 'Closing');
    this.hostDc?.close(); this.hostPc?.close();
    this.joinDc?.close(); this.joinPc?.close();
    this.hostDc = null; this.hostPc = null;
    this.joinDc = null; this.joinPc = null;
    this.offerChunks$.next([]); this.offerQrUrls$.next([]);
    this.answerChunks$.next([]); this.answerQrUrls$.next([]);
    this.qrChunks$.next([]);
    this.setState('CLOSED');
  }
}
