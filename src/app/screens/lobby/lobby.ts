import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import QRCode from 'qrcode';
import { RoomService, PlayerInfo } from '../../services/room.service';
import { ProfileService, UserProfile } from '../../services/profile.service';

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

  connectionState = 'CONNECTING';
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
  ) {}

  async ngOnInit() {
    this.profile = this.profileService.get()!;
    this.roomId  = (this.route.snapshot.paramMap.get('id') ?? '').toUpperCase();

    // If player navigated directly or refreshed, ensure connected to room
    if (!this.roomService.config || this.roomService.config.roomId !== this.roomId) {
      if (this.profile) {
        await this.roomService.joinRoom(this.roomId);
      }
    }

    // Generate clean QR code of the room ID
    try {
      this.qrImageUrl = await QRCode.toDataURL(this.roomId, {
        margin: 1,
        width: 250,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (e) {
      console.error('Failed to generate invite QR:', e);
    }

    // Subscriptions
    this.subs.add(this.roomService.players$.subscribe(p => {
      this.players = p;
    }));

    this.subs.add(this.roomService.connectionState$.subscribe(s => {
      this.connectionState = s;
    }));

    this.subs.add(this.roomService.gameStart$.subscribe(() => {
      this.gameStarted = true;
      // When ready: this.router.navigate(['/game', this.roomId]);
    }));

    this.subs.add(this.roomService.roomClosed$.subscribe(reason => {
      alert(`The room was closed (${reason})`);
      this.router.navigate(['/']);
    }));
  }

  copyRoomId() {
    navigator.clipboard?.writeText(this.roomId);
    this.copied = true;
    setTimeout(() => this.copied = false, 2000);
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
      alert(this.roomService.error$.value || 'Could not start game');
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
