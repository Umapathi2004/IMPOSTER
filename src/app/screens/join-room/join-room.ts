import { Component, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ProfileModal } from '../profile-modal/profile-modal';
import { ProfileConfirm } from '../profile-confirm/profile-confirm';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { RoomService } from '../../services/room.service';
import { WebRTCService, QrChunk, SignalPayload } from '../../services/webrtc.service';
import { LanDiscoveryService, DiscoveredRoom } from '../../services/lan-discovery.service';
import { QrScannerService } from '../../services/qr-scanner.service';

type Tab      = 'qr' | 'nearby' | 'code';
type JoinStep = 'idle' | 'show-answer' | 'waiting';

const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#E88A52;font-weight:bold', ...args);

@Component({
  selector: 'app-join-room',
  imports: [ProfileModal, ProfileConfirm, FormsModule],
  templateUrl: './join-room.html',
  styleUrl: './join-room.css',
})
export class JoinRoom implements OnInit, OnDestroy {
  @ViewChild('offerVideo') offerVideo!: ElementRef<HTMLVideoElement>;

  profile: UserProfile | null = null;
  showProfileModal   = false;
  showProfileConfirm = false;

  activeTab: Tab = 'qr';
  step: JoinStep = 'idle';

  // ── QR scan ───────────────────────────────────────────────────────────────
  showScanner   = false;
  scanError     = '';
  scanActive    = false;
  scannedChunks: QrChunk[] = [];
  scanProgress  = '';
  processing    = false;  // true while createAnswer is running

  // ── Answer display ────────────────────────────────────────────────────────
  answerChunks: QrChunk[] = [];
  currentAnswerIdx = 0;
  answerQrUrls: string[] = [];

  get answerQrUrl(): string { return this.answerQrUrls[this.currentAnswerIdx] ?? ''; }

  // ── Nearby ────────────────────────────────────────────────────────────────
  nearbyRooms: DiscoveredRoom[] = [];
  readonly lanSupported: boolean;

  // ── Room code ─────────────────────────────────────────────────────────────
  roomCodeInput = '';
  codeError     = '';

  // ── Connection ────────────────────────────────────────────────────────────
  connectionState = '';

  private subs        = new Subscription();
  private stream: MediaStream | null = null;
  private scanInterval: any = null;
  private _pendingOffer: SignalPayload | null = null;

  constructor(
    private router: Router,
    private profileService: ProfileService,
    private roomService: RoomService,
    private webrtc: WebRTCService,
    private lanDiscovery: LanDiscoveryService,
    private qrScanner: QrScannerService,
  ) {
    this.lanSupported = this.lanDiscovery.supported;
  }

  ngOnInit() {
    this.profile = this.profileService.get();

    this.subs.add(this.webrtc.connectionState$.subscribe(s => {
      this.connectionState = s;
      log('JOIN', 'connection state ->', s);
      if (s === 'CONNECTED') {
        const roomId = this.roomService.config?.roomId ?? this._pendingOffer?.r ?? '';
        log('ROOM', 'Connected — navigating to lobby', roomId);
        this.router.navigate(['/lobby', roomId]);
      }
    }));

    this.subs.add(this.webrtc.answerChunks$.subscribe(chunks => {
      this.answerChunks = chunks;
      this.currentAnswerIdx = 0;
    }));

    this.subs.add(this.webrtc.answerQrUrls$.subscribe(urls => {
      this.answerQrUrls = urls;
    }));

    this.subs.add(this.webrtc.currentChunkIdx$.subscribe(idx => {
      this.currentAnswerIdx = idx;
    }));

    // Start nearby discovery
    this.lanDiscovery.startDiscovery();
    this.subs.add(this.lanDiscovery.rooms$.subscribe(rooms => {
      this.nearbyRooms = rooms.filter(r => r.playerCount < r.maxPlayers);
    }));
  }

  // ── Tab ───────────────────────────────────────────────────────────────────

  setTab(tab: Tab) {
    this.activeTab = tab;
    this.scanError = '';
    this.codeError = '';
  }

  // ── Profile gate ──────────────────────────────────────────────────────────

  private _afterProfile(offer: SignalPayload) {
    this._pendingOffer = offer;
    if (!this.profile) {
      this.showProfileModal = true;
    } else {
      this.showProfileConfirm = true;
    }
  }

  onProfileDone(p: UserProfile) {
    this.profile = p;
    this.showProfileModal = false;
    this._processOffer();
  }

  onConfirmContinue() {
    this.showProfileConfirm = false;
    this._processOffer();
  }

  onConfirmEdit() {
    this.showProfileConfirm = false;
    this.showProfileModal = true;
  }

  private async _processOffer() {
    if (!this._pendingOffer) return;
    this.processing = true;
    log('ROOM', 'Processing offer for room', this._pendingOffer.r);
    try {
      await this.roomService.processOffer(this._pendingOffer);
      this.step = 'show-answer';
    } catch (e) {
      this.scanError = 'FAILED TO PROCESS OFFER — TRY AGAIN';
      log('SIGNAL', 'processOffer error', e);
    } finally {
      this.processing = false;
    }
  }

  // ── QR scanner ────────────────────────────────────────────────────────────

  async openScanner() {
    this.scanError = '';
    this.scannedChunks = [];
    this.scanProgress = '';
    this.showScanner = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setTimeout(() => this._startDetection(), 100);
    } catch {
      this.scanError = 'CAMERA ACCESS DENIED';
    }
  }

  private _startDetection() {
    const video = this.offerVideo?.nativeElement;
    if (!video || !this.stream) return;
    video.srcObject = this.stream;
    video.play();
    this.scanActive = true;

    this.scanInterval = setInterval(async () => {
      const raw = await this.qrScanner.scan(video);
      if (raw) this._handleOfferChunk(raw);
    }, 300);
  }

  private _handleOfferChunk(raw: string) {
    const chunk = this.webrtc.parseChunk(raw);
    if (!chunk) { this.scanError = 'INVALID QR — NOT AN IMPOSTER CODE'; return; }

    if (!this.scannedChunks.find(c => c.i === chunk.i)) {
      this.scannedChunks.push(chunk);
    }
    this.scanProgress = `SCANNED ${this.scannedChunks.length} / ${chunk.n}`;

    if (this.scannedChunks.length === chunk.n) {
      this._stopScanner();
      this.showScanner = false;
      const payload = this.webrtc.decodeChunks(this.scannedChunks);
      if (payload && payload.t === 'offer') {
        log('SIGNAL', 'Offer decoded from QR');
        this._afterProfile(payload);
      } else {
        this.scanError = 'INVALID OFFER QR — SCAN HOST QR AGAIN';
      }
    }
  }

  closeScanner() { this._stopScanner(); this.showScanner = false; }

  private _stopScanner() {
    clearInterval(this.scanInterval);
    this.scanInterval = null;
    this.scanActive = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  // ── Nearby join ───────────────────────────────────────────────────────────

  joinNearby(room: DiscoveredRoom) {
    // BroadcastChannel discovery is same-browser only.
    // The offer QR is still required to complete WebRTC signaling.
    // Switch to QR tab and prompt user to scan the host's QR.
    log('DISCOVERY', 'Tapped nearby room', room.roomId, '— switching to QR scan');
    this.activeTab = 'qr';
    this.scanError = `ROOM ${room.roomId} FOUND — SCAN HOST'S QR TO CONNECT`;
  }

  // ── Room code join ────────────────────────────────────────────────────────

  joinByCode() {
    const code = this.roomCodeInput.trim().toUpperCase();
    if (code.length < 4) { this.codeError = 'ENTER A VALID ROOM CODE'; return; }

    // Check if we discovered this room via BroadcastChannel
    const found = this.nearbyRooms.find(r => r.roomId === code);
    if (found) {
      this.joinNearby(found);
      return;
    }

    // No server — can't locate host by code alone across devices
    this.codeError = 'ROOM NOT FOUND NEARBY — ASK HOST TO SHOW QR';
    log('ROOM', 'Code entered but room not in discovery list', code);
  }

  nextAnswerChunk() { this.webrtc.nextChunk(); }
  prevAnswerChunk() { this.webrtc.prevChunk(); }

  get roomConfig() { return this.roomService.config; }

  goBack() { this.router.navigate(['/']); }

  ngOnDestroy() {
    this._stopScanner();
    this.lanDiscovery.stopDiscovery();
    this.subs.unsubscribe();
  }
}
