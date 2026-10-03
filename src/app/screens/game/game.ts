import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService, PlayerInfo, GameAssignment } from '../../services/room.service';
import { ProfileService } from '../../services/profile.service';

type Phase = 'reveal' | 'discuss' | 'vote' | 'result';

@Component({
  selector: 'app-game',
  imports: [],
  templateUrl: './game.html',
  styleUrl: './game.css',
})
export class Game implements OnInit, OnDestroy {
  roomId = '';
  phase: Phase = 'reveal';

  isImpostor = false;
  word: string | null = null;
  players: PlayerInfo[] = [];
  myUid = '';

  revealed = false;

  // Discussion timer
  discussSeconds = 120;
  private timer: any = null;

  // Voting
  votedFor: string | null = null;
  votes = new Map<string, string>(); // voterUid -> targetUid
  allVoted = false;

  get isHost() { return this.roomService.isHost; }

  // Result
  eliminatedPlayer: PlayerInfo | null = null;

  private subs = new Subscription();

  get myProfile() { return this.profileService.get(); }

  get voteResults(): { player: PlayerInfo; count: number }[] {
    const counts = new Map<string, number>();
    for (const target of this.votes.values()) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return this.players
      .map(p => ({ player: p, count: counts.get(p.uid) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }

  get timerDisplay(): string {
    const m = Math.floor(this.discussSeconds / 60);
    const s = this.discussSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private roomService: RoomService,
    private profileService: ProfileService,
  ) {}

  ngOnInit() {
    this.roomId = (this.route.snapshot.paramMap.get('id') ?? '').toUpperCase();
    this.myUid = this.profileService.get()?.uid ?? '';

    // Apply stored assignment (set before navigation from lobby)
    if (this.roomService.lastAssignment) {
      this._applyAssignment(this.roomService.lastAssignment);
    }

    // Also subscribe in case GAME_START arrives after this screen loads
    this.subs.add(this.roomService.gameStart$.subscribe(a => {
      this._applyAssignment(a);
    }));

    // Listen for game actions (votes from other players)
    this.subs.add(this.roomService.messages$.subscribe(msg => {
      if (msg.type === 'GAME_ACTION' && msg.payload?.action === 'VOTE') {
        this.votes.set(msg.senderUid!, msg.payload.targetUid);
        this._checkAllVoted();
      }
    }));

    this.subs.add(this.roomService.roomClosed$.subscribe(() => {
      this.router.navigate(['/']);
    }));
  }

  private _applyAssignment(a: GameAssignment) {
    this.isImpostor = a.isImpostor;
    this.word = a.word;
    this.players = a.players;
  }

  // ── Phase: Reveal ─────────────────────────────────────────────────────────

  tapReveal() { this.revealed = true; }

  proceedToDiscuss() {
    this.phase = 'discuss';
    this.discussSeconds = 120;
    this.timer = setInterval(() => {
      this.discussSeconds--;
      if (this.discussSeconds <= 0) this._endDiscussion();
    }, 1000);
  }

  skipDiscuss() { this._endDiscussion(); }

  private _endDiscussion() {
    clearInterval(this.timer);
    this.phase = 'vote';
  }

  // ── Phase: Vote ───────────────────────────────────────────────────────────

  castVote(targetUid: string) {
    if (this.votedFor) return;
    this.votedFor = targetUid;
    this.votes.set(this.myUid, targetUid);
    this.roomService.sendMessage('GAME_ACTION', { action: 'VOTE', targetUid });
    this._checkAllVoted();
  }

  private _checkAllVoted() {
    if (this.votes.size >= this.players.length) {
      this.allVoted = true;
      setTimeout(() => this._resolveVotes(), 800);
    }
  }

  private _resolveVotes() {
    const counts = new Map<string, number>();
    for (const target of this.votes.values()) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    let maxVotes = 0;
    let eliminatedUid = '';
    for (const [uid, count] of counts) {
      if (count > maxVotes) { maxVotes = count; eliminatedUid = uid; }
    }
    this.eliminatedPlayer = this.players.find(p => p.uid === eliminatedUid) ?? null;
    this.phase = 'result';
  }

  forceResults() { this._resolveVotes(); }

  // ── Navigation ────────────────────────────────────────────────────────────

  async playAgain() {
    await this.roomService.leaveRoom();
    this.router.navigate(['/lobby', this.roomId]);
  }

  async goHome() {
    await this.roomService.leaveRoom();
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.subs.unsubscribe();
  }
}
