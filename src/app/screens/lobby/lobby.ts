import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import QRCode from 'qrcode';
import { RoomService, PlayerInfo } from '../../services/room.service';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { CustomMessageService } from '../../services/custom-message.service';

@Component({
  selector: 'app-lobby',
  imports: [],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css',
})
export class Lobby implements OnInit, OnDestroy {
  roomId = '';
  profile!: UserProfile;
  players: PlayerInfo[] = [];

  // Invite QR code (Single scan of Room ID)
  qrImageUrl = '';
  copied = false;

  connectionState = 'IDLE';
  gameStarted = false;

  get emptySlots(): number[] {
    const max = this.config?.maxPlayers ?? 4;
    return Array(Math.max(0, max - this.players.length)).fill(0);
  }

  private subs = new Subscription();

  get config() { return this.roomService.config; }
  get isHost()  { return this.roomService.isHost; }
  get allPlayers(): PlayerInfo[] { return this.players; }

  get canStart() {
    return this.isHost
      && this.players.length >= 2
      && this.connectionState === 'CONNECTED';
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private roomService: RoomService,
    private profileService: ProfileService,
    private messageService: CustomMessageService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.profile = this.profileService.get()!;
    this.roomId  = (this.route.snapshot.paramMap.get('id') ?? '').toUpperCase();

    // Immediately initialize current room data before any async calls
    this.players = this.roomService.players$.value;
    this.connectionState = this.roomService.connectionState$.value;

    // Subscriptions setup synchronously so no events are missed
    this.subs.add(this.roomService.players$.subscribe(p => {
      this.players = p;
      this.cdr.markForCheck();
    }));

    this.subs.add(this.roomService.connectionState$.subscribe(s => {
      this.connectionState = s;
      this.cdr.markForCheck();
    }));

    this.subs.add(this.roomService.gameStart$.subscribe(() => {
      this.gameStarted = true;
      this.router.navigate(['/game', this.roomId]);
    }));

    this.subs.add(this.roomService.roomClosed$.subscribe(async reason => {
      await this.messageService.alert(
        reason || 'The host has left the room. The game has ended.',
        'ROOM CLOSED',
        'warning'
      );
      this.router.navigate(['/']);
    }));

    // Generate QR code immediately for the room
    if (this.roomId) {
      this._generateQrCode(this.roomId);
    }

    // If player navigated directly or refreshed, ensure connected to room
    if (!this.roomService.config || this.roomService.config.roomId !== this.roomId || this.roomService.roomStatus === 'in-game') {
      this.roomService.joinRoom(this.roomId).then(async ok => {
        if (!ok) {
          const err = this.roomService.lastJoinError;
          if (err?.code === 'NOT_ALLOWED_IN_GAME') {
            await this.messageService.showModal({
              title: 'NOT ALLOWED IN THIS GAME',
              message: err.message || 'You are not allowed to join this game. Game is already in progress!',
              type: 'error',
              buttonText: 'RETURN TO HOME',
              icon: 'fa-solid fa-ban',
            });
            this.router.navigate(['/']);
            return;
          }
        }
        if (this.roomService.lastAssignment || this.roomService.roomStatus === 'in-game') {
          this.router.navigate(['/game', this.roomId]);
          return;
        }
        this.cdr.markForCheck();
      });
    } else {
      // Already in room — re-sync room state from server
      this.roomService.ensureWebSocketConnected();
    }
  }

  private async _generateQrCode(code: string) {
    try {
      this.qrImageUrl = await QRCode.toDataURL(code, {
        margin: 1,
        width: 250,
        color: { dark: '#000000', light: '#ffffff' },
      });
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Failed to generate invite QR:', e);
    }
  }

  copyRoomId() {
    navigator.clipboard?.writeText(this.roomId);
    this.copied = true;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.copied = false;
      this.cdr.markForCheck();
    }, 2000);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  editRoom() {
    this.router.navigate(['/create-room']);
  }

  async destroyRoom() {
    if (confirm('Are you sure you want to destroy this room?')) {
      await this.roomService.destroyRoom();
      this.router.navigate(['/']);
    }
  }

  async startGame() {
    if (!this.canStart) return;
    const ok = await this.roomService.startGame();
    if (!ok) {
      await this.messageService.alert(
        this.roomService.error$.value || 'Could not start game',
        'LAUNCH FAILED',
        'error'
      );
    }
  }

  async goBack() {
    await this.roomService.leaveRoom();
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
