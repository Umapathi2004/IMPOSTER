import { Component, ChangeDetectorRef, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ProfileModal } from '../profile-modal/profile-modal';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { RoomService, ActiveRoom } from '../../services/room.service';
import { QrScannerService } from '../../services/qr-scanner.service';

type Tab = 'nearby' | 'code' | 'qr';

const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#E88A52;font-weight:bold', ...args);

@Component({
  selector: 'app-join-room',
  imports: [ProfileModal, FormsModule],
  templateUrl: './join-room.html',
  styleUrl: './join-room.css',
})
export class JoinRoom implements OnInit, OnDestroy {
  @ViewChild('offerVideo') offerVideo!: ElementRef<HTMLVideoElement>;

  profile: UserProfile | null = null;
  showProfileModal   = false;
  showProfileConfirm = false;

  activeTab: Tab = 'nearby';

  // ── Active Rooms (Live synced via WebSocket — NO POLLING) ──────────────────
  activeRooms: ActiveRoom[] = [];
  joining = false;
  joinError = '';

  // ── Room Code ─────────────────────────────────────────────────────────────
  roomCodeInput = '';
  codeError     = '';

  // ── QR Scanner ────────────────────────────────────────────────────────────
  showScanner   = false;
  scanError     = '';
  scanActive    = false;
  private stream: MediaStream | null = null;
  private scanInterval: any = null;

  private subs = new Subscription();
  private pendingTargetRoomId: string | null = null;

  constructor(
    private router: Router,
    private profileService: ProfileService,
    public roomService: RoomService,
    private qrScanner: QrScannerService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.profile = this.profileService.get();

    // Ensure WebSocket is active to receive live ACTIVE_ROOMS events
    this.roomService.ensureWebSocketConnected();

    // Subscribe to live active rooms pushed by WebSocket
    this.subs.add(this.roomService.activeRooms$.subscribe(rooms => {
      this.activeRooms = rooms.filter(r => r.status !== 'closed');
      this.cdr.markForCheck();
    }));

    // Initial fetch once just to populate immediately if WS is still handshaking
    this.roomService.fetchActiveRooms();
  }

  setTab(tab: Tab) {
    this.activeTab = tab;
    this.scanError = '';
    this.codeError = '';
    this.joinError = '';
  }

  // ── Join Handler ──────────────────────────────────────────────────────────

  requestJoin(roomId: string) {
    const cleanId = roomId.trim().toUpperCase();
    if (!cleanId) return;

    this.profile = this.profileService.get();

    if (!this.profile) {
      // First time player without a nickname
      this.pendingTargetRoomId = cleanId;
      this.showProfileModal = true;
      return;
    }

    // Player already has a profile — join immediately without blocking confirmation
    this._executeJoin(cleanId);
  }

  onProfileDone(p: UserProfile) {
    this.profile = p;
    this.showProfileModal = false;
    if (this.pendingTargetRoomId) {
      this._executeJoin(this.pendingTargetRoomId);
      this.pendingTargetRoomId = null;
    }
  }

  private async _executeJoin(roomId: string) {
    this.joining = true;
    this.joinError = '';
    this.codeError = '';
    this.scanError = '';

    try {
      const ok = await this.roomService.joinRoom(roomId);
      if (ok) {
        log('JOIN', 'Successfully joined room', roomId);
        if (this.roomService.lastAssignment || this.roomService.roomStatus === 'in-game') {
          this.router.navigate(['/game', roomId]);
        } else {
          this.router.navigate(['/lobby', roomId]);
        }
      } else {
        const err = this.roomService.error$.value || 'Could not join room';
        this.joinError = err.toUpperCase();
        this.codeError = err.toUpperCase();
        this.scanError = err.toUpperCase();
      }
    } catch (e: any) {
      const msg = 'FAILED TO JOIN ROOM — CHECK CODE OR HOST STATUS';
      this.joinError = msg;
      this.codeError = msg;
    } finally {
      this.joining = false;
    }
  }

  // ── Join by Code ──────────────────────────────────────────────────────────

  joinByCode() {
    const code = this.roomCodeInput.trim().toUpperCase();
    if (code.length < 3) {
      this.codeError = 'ENTER A VALID ROOM CODE';
      return;
    }
    this.requestJoin(code);
  }

  // ── QR Scanner ────────────────────────────────────────────────────────────

  async openScanner() {
    this.scanError = '';
    this.showScanner = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
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
      if (raw) {
        log('QR', 'Scanned raw text:', raw);
        this._handleScannedCode(raw);
      }
    }, 300);
  }

  private _handleScannedCode(raw: string) {
    let roomId = raw.trim();
    if (roomId.includes('/lobby/')) {
      roomId = roomId.split('/lobby/')[1]?.split('?')[0]?.split('/')[0] || roomId;
    }
    roomId = roomId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    if (roomId.length >= 3 && roomId.length <= 8) {
      this._stopScanner();
      this.showScanner = false;
      this.requestJoin(roomId);
    } else {
      this.scanError = 'INVALID QR CODE — POINT TO ROOM QR';
    }
  }

  closeScanner() {
    this._stopScanner();
    this.showScanner = false;
  }

  private _stopScanner() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.scanActive = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  goBack() {
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this._stopScanner();
    this.subs.unsubscribe();
  }
}
