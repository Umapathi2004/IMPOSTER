import { Component, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService, PlayerInfo } from '../../services/room.service';
import { WebRTCService, QrChunk, SignalPayload } from '../../services/webrtc.service';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { QrScannerService } from '../../services/qr-scanner.service';

@Component({
  selector: 'app-lobby',
  imports: [],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css',
})
export class Lobby implements OnInit, OnDestroy {
  @ViewChild('answerVideo') answerVideo!: ElementRef<HTMLVideoElement>;

  roomId = '';
  profile!: UserProfile;
  players: PlayerInfo[] = [];

  // QR display (offer chunks)
  qrChunks: QrChunk[] = [];
  currentChunkIdx = 0;
  qrImageUrls: string[] = [];

  get qrImageUrl(): string { return this.qrImageUrls[this.currentChunkIdx] ?? ''; }

  // Answer scanner
  showAnswerScanner = false;
  scanActive        = false;
  scanError         = '';
  answerStatus      = '';
  scannedChunks: QrChunk[] = [];

  connectionState = '';

  private subs = new Subscription();
  private stream: MediaStream | null = null;
  private scanInterval: any = null;

  get config() { return this.roomService.config; }
  get isHost()  { return this.roomService.isHost; }

  get allPlayers(): PlayerInfo[] { return this.players; }

  get canStart() {
    return this.isHost
      && this.config != null
      && this.players.length >= this.config.maxPlayers;
  }

  get currentChunk(): QrChunk | null {
    return this.qrChunks[this.currentChunkIdx] ?? null;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private roomService: RoomService,
    private webrtc: WebRTCService,
    private profileService: ProfileService,
    private qrScanner: QrScannerService,
  ) {}

  ngOnInit() {
    this.profile = this.profileService.get()!;
    this.roomId  = this.route.snapshot.paramMap.get('id') ?? '';

    this.subs.add(this.roomService.players$.subscribe(p => this.players = p));
    this.subs.add(this.webrtc.connectionState$.subscribe(s => this.connectionState = s));

    this.subs.add(this.webrtc.offerChunks$.subscribe(chunks => {
      this.qrChunks = chunks;
      this.currentChunkIdx = 0;
    }));

    this.subs.add(this.webrtc.offerQrUrls$.subscribe(urls => {
      this.qrImageUrls = urls;
    }));

    this.subs.add(this.webrtc.currentChunkIdx$.subscribe(idx => {
      this.currentChunkIdx = idx;
    }));
  }

  // ── QR rendering ─────────────────────────────────────────────────────────

  nextChunk()  { this.webrtc.nextChunk(); }
  prevChunk()  { this.webrtc.prevChunk(); }

  // ── Answer scanner (host scans joiner's answer QR) ───────────────────────

  async openAnswerScanner() {
    this.scanError = '';
    this.scannedChunks = [];
    this.answerStatus = '';
    this.showAnswerScanner = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setTimeout(() => this._startAnswerDetection(), 100);
    } catch {
      this.scanError = 'CAMERA ACCESS DENIED';
    }
  }

  private _startAnswerDetection() {
    const video = this.answerVideo?.nativeElement;
    if (!video || !this.stream) return;
    video.srcObject = this.stream;
    video.play();
    this.scanActive = true;

    this.scanInterval = setInterval(async () => {
      const raw = await this.qrScanner.scan(video);
      if (raw) this._handleAnswerChunk(raw);
    }, 300);
  }

  private _handleAnswerChunk(raw: string) {
    const chunk = this.webrtc.parseChunk(raw);
    if (!chunk) { this.scanError = 'INVALID QR'; return; }
    if (!this.scannedChunks.find(c => c.i === chunk.i)) this.scannedChunks.push(chunk);
    this.answerStatus = `SCANNED ${this.scannedChunks.length} / ${chunk.n}`;
    if (this.scannedChunks.length === chunk.n) {
      this._stopAnswerScanner();
      this.showAnswerScanner = false;
      const payload = this.webrtc.decodeChunks(this.scannedChunks);
      if (payload && payload.t === 'answer') {
        this.roomService.receiveAnswer(payload);
        this.answerStatus = 'ANSWER RECEIVED ✔';
      } else {
        this.scanError = 'INVALID ANSWER QR — ASK JOINER TO SHOW AGAIN';
      }
    }
  }

  closeAnswerScanner() { this._stopAnswerScanner(); this.showAnswerScanner = false; }

  private _stopAnswerScanner() {
    clearInterval(this.scanInterval);
    this.scanInterval = null;
    this.scanActive = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  editRoom()    { this.router.navigate(['/create-room']); }

  destroyRoom() {
    this.roomService.disconnect();
    this.router.navigate(['/']);
  }

  startGame() {
    if (!this.canStart) return;
    this.roomService.broadcast('GAME_START', { config: this.config });
    this.router.navigate(['/game', this.roomId]);
  }

  goBack() {
    this.roomService.disconnect();
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this._stopAnswerScanner();
    this.subs.unsubscribe();
  }
}
