import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService, PlayerInfo, GameAssignment } from '../../services/room.service';
import { ProfileService } from '../../services/profile.service';
import { CustomMessageService } from '../../services/custom-message.service';

type RevealStep = 'back' | 'front' | 'waiting' | 'imposter-reveal';

@Component({
  selector: 'app-game',
  imports: [],
  templateUrl: './game.html',
  styleUrl: './game.css',
})
export class Game implements OnInit, OnDestroy {
  roomId = '';

  isImpostor = false;
  word: string | null = null;
  hint: string | null = null;
  players: PlayerInfo[] = [];
  myUid = '';

  revealStep: RevealStep = 'back';
  isFlipping = false;
  hasConfirmedRole = false;
  hasClickedShowImposter = false;

  revealedUids = new Set<string>();     // players who viewed role & clicked OK
  showImposterUids = new Set<string>(); // players who clicked Show Imposter
  leftUids = new Set<string>();         // players who left / disconnected
  rejoinedUids = new Set<string>();     // players who recently rejoined
  lastRejoinedName = '';
  private rejoinedTimeout: any = null;
  impostorPlayers: PlayerInfo[] = [];   // Imposters to display directly
  isReconnecting = false;

  private subs = new Subscription();

  get isHost() { return this.roomService.isHost; }
  get myProfile() { return this.profileService.get(); }
  get activePlayers(): PlayerInfo[] {
    return this.players.filter(p => !this.leftUids.has(p.uid));
  }
  get activePlayersCount(): number {
    return this.activePlayers.length;
  }
  get activeShowImposterCount(): number {
    return Array.from(this.showImposterUids).filter(uid => !this.leftUids.has(uid)).length;
  }
  get leftPlayersNames(): string {
    return this.players.filter(p => this.leftUids.has(p.uid)).map(p => p.name).join(', ');
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private roomService: RoomService,
    private profileService: ProfileService,
    private messageService: CustomMessageService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    this.roomId = (this.route.snapshot.paramMap.get('id') ?? '').toUpperCase();
    this.myUid = this.profileService.get()?.uid ?? '';

    // Apply stored assignment if present
    if (this.roomService.lastAssignment) {
      this._applyAssignment(this.roomService.lastAssignment);
    } else {
      // User refreshed the page or entered URL directly — attempt reconnection
      await this._attemptReconnect();
    }

    // Subscribe to game start
    this.subs.add(this.roomService.gameStart$.subscribe(a => {
      this._applyAssignment(a);
      this.cdr.markForCheck();
    }));

    // Listen for WebSocket game messages
    this.subs.add(this.roomService.messages$.subscribe(msg => {
      if (msg.type === 'PLAYER_LEFT') {
        const uid = msg.payload?.uid || msg.senderUid;
        if (uid) {
          this.leftUids.add(uid);
          this.rejoinedUids.delete(uid);
          const p = this.players.find(x => x.uid === uid);
          const name = p?.name || msg.payload?.name || 'A CREW MEMBER';
          this.messageService.toast(`${name} LEFT THE GAME`, 'warning');
          this._checkAllShowImposter();
          this.cdr.markForCheck();
        }
      } else if (msg.type === 'PLAYER_REJOINED') {
        const uid = msg.payload?.player?.uid || msg.senderUid;
        if (uid) {
          this.leftUids.delete(uid);
          this.rejoinedUids.add(uid);
          const p = msg.payload?.player || this.players.find(x => x.uid === uid);
          const name = p?.name || 'CREW MEMBER';
          this.lastRejoinedName = name;
          this.messageService.toast(`${name} REJOINED THE GAME`, 'success');

          clearTimeout(this.rejoinedTimeout);
          this.rejoinedTimeout = setTimeout(() => {
            this.rejoinedUids.delete(uid);
            if (this.lastRejoinedName === name) this.lastRejoinedName = '';
            this.cdr.markForCheck();
          }, 8000);

          this.cdr.markForCheck();
        }
      } else if (msg.type === 'IMPOSTOR_REVEALED') {
        this._handleImpostorRevealed(msg.payload);
      } else if (msg.type === 'GAME_ACTION') {
        const action = msg.payload?.action;
        if (action === 'CARD_REVEALED') {
          if (msg.senderUid) this.revealedUids.add(msg.senderUid);
          this.cdr.markForCheck();
        } else if (action === 'SHOW_IMPOSTER') {
          if (msg.senderUid) this.showImposterUids.add(msg.senderUid);
          this._checkAllShowImposter();
          this.cdr.markForCheck();
        } else if (action === 'IMPOSTER_IDENTITY') {
          if (msg.payload?.player) {
            const p = msg.payload.player;
            if (!this.impostorPlayers.some(i => i.uid === p.uid)) {
              this.impostorPlayers.push(p);
            }
          }
          this.revealStep = 'imposter-reveal';
          this.cdr.markForCheck();
        }
      }
    }));

    // Listen for room reset to navigate back to lobby together
    this.subs.add(this.roomService.roomReset$.subscribe(() => {
      this.router.navigate(['/lobby', this.roomId]);
    }));

    this.subs.add(this.roomService.roomClosed$.subscribe(async reason => {
      await this.messageService.alert(
        reason || 'The host has left the room. The game has ended.',
        'TERMINAL CLOSED',
        'warning'
      );
      this.router.navigate(['/']);
    }));
  }

  private async _attemptReconnect() {
    this.isReconnecting = true;
    this.cdr.markForCheck();

    try {
      const ok = await this.roomService.joinRoom(this.roomId);
      if (!ok) {
        const lastErr = this.roomService.lastJoinError;
        const msg = lastErr?.message || 'You are not allowed to join this game. Game is already in progress!';
        await this.messageService.showModal({
          title: 'NOT ALLOWED IN THIS GAME',
          message: msg,
          type: 'error',
          buttonText: 'RETURN TO HOME',
          icon: 'fa-solid fa-ban',
        });
        this.router.navigate(['/']);
        return;
      }

      if (this.roomService.lastAssignment) {
        this._applyAssignment(this.roomService.lastAssignment);
        this.messageService.toast('RECONNECTED TO GAME SESSION', 'success');
      } else {
        // Room exists but game hasn't started yet
        this.router.navigate(['/lobby', this.roomId]);
      }
    } catch (err: any) {
      await this.messageService.showModal({
        title: 'NOT ALLOWED IN THIS GAME',
        message: err.message || 'You are not allowed to join this game. Game is already in progress!',
        type: 'error',
        buttonText: 'RETURN TO HOME',
        icon: 'fa-solid fa-ban',
      });
      this.router.navigate(['/']);
    } finally {
      this.isReconnecting = false;
      this.cdr.markForCheck();
    }
  }

  private _applyAssignment(a: GameAssignment) {
    this.isImpostor = a.isImpostor;
    this.word = a.word;
    this.hint = a.hint || null;
    this.players = a.players;
    this.revealStep = 'back';
    this.isFlipping = false;
    this.hasConfirmedRole = false;
    this.hasClickedShowImposter = false;
    this.revealedUids.clear();
    this.showImposterUids.clear();
    this.impostorPlayers = [];

    if (a.leftUids && Array.isArray(a.leftUids)) {
      this.leftUids = new Set(a.leftUids);
    }
    if (a.revealedUids && Array.isArray(a.revealedUids)) {
      this.revealedUids = new Set(a.revealedUids);
      if (this.revealedUids.has(this.myUid)) {
        this.revealStep = 'waiting';
        this.hasConfirmedRole = true;
      }
    }
    if (a.showImposterUids && Array.isArray(a.showImposterUids)) {
      this.showImposterUids = new Set(a.showImposterUids);
      if (this.showImposterUids.has(this.myUid)) {
        this.hasClickedShowImposter = true;
      }
    }

    this.cdr.markForCheck();
  }

  tapReveal() {
    if (this.revealStep !== 'back' || this.isFlipping) return;
    this.isFlipping = true;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.revealStep = 'front';
      this.isFlipping = false;
      this.cdr.markForCheck();
    }, 350);
  }

  confirmReveal() {
    this.hasConfirmedRole = true;
    this.revealedUids.add(this.myUid);
    this.roomService.sendMessage('GAME_ACTION', { action: 'CARD_REVEALED' });
    this.revealStep = 'waiting';
    this.cdr.markForCheck();
  }

  requestShowImposter() {
    if (this.hasClickedShowImposter) return;
    this.hasClickedShowImposter = true;
    this.showImposterUids.add(this.myUid);
    this.roomService.sendMessage('GAME_ACTION', { action: 'SHOW_IMPOSTER' });
    this._checkAllShowImposter();
    this.cdr.markForCheck();
  }

  private _checkAllShowImposter() {
    this.cdr.markForCheck();
    const active = this.activePlayers;
    const activeVotes = this.activeShowImposterCount;
    if (active.length > 0 && activeVotes >= active.length) {
      if (this.isImpostor && this.myProfile) {
        const mePlayer: PlayerInfo = this.players.find(p => p.uid === this.myUid) || {
          uid: this.myProfile.uid,
          name: this.myProfile.name,
          avatar: this.myProfile.avatar,
          isHost: this.isHost,
        };
        if (!this.impostorPlayers.some(i => i.uid === this.myUid)) {
          this.impostorPlayers.push(mePlayer);
        }
        this.roomService.sendMessage('GAME_ACTION', {
          action: 'IMPOSTER_IDENTITY',
          player: mePlayer,
        });
      }
      this.roomService.fetchImpostors().then(res => {
        if (res) {
          this._handleImpostorRevealed(res);
        }
      });
      this.revealStep = 'imposter-reveal';
      this.cdr.markForCheck();
    }
  }

  private _handleImpostorRevealed(payload: any) {
    if (Array.isArray(payload?.impostors) && payload.impostors.length > 0) {
      this.impostorPlayers = payload.impostors;
    }
    if (payload?.word) {
      this.word = payload.word;
    }
    this.revealStep = 'imposter-reveal';
    this.cdr.markForCheck();
  }

  async playAgain() {
    await this.roomService.resetGame();
    this.router.navigate(['/lobby', this.roomId]);
  }

  async goHome() {
    await this.roomService.leaveRoom();
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
