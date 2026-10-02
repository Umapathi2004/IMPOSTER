import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { WordService, CategoryInfo } from '../../services/word.service';

@Component({
  selector: 'app-create-room',
  imports: [FormsModule],
  templateUrl: './create-room.html',
  styleUrl: './create-room.css',
})
export class CreateRoom implements OnInit, OnDestroy {
  profile!: UserProfile;

  playerCount = 4;
  impostorCount = 1;
  readonly playerMin = 2;
  readonly playerMax = 12;

  selectedCategory = 'ALL';
  categories: CategoryInfo[] = [];

  private subs = new Subscription();
  isEditing = false;

  get maxImpostors() { return Math.floor(this.playerCount / 2); }

  get activeCategory(): CategoryInfo | null {
    return this.categories.find(c => c.id === this.selectedCategory) ?? this.categories[0] ?? null;
  }

  constructor(
    private roomService: RoomService,
    private profileService: ProfileService,
    private wordService: WordService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    this.profile = this.profileService.get()!;
  }

  ngOnInit() {
    this.subs.add(this.wordService.categories$.subscribe(cats => {
      this.categories = cats;
    }));
    // Pre-fill if editing existing room
    const cfg = this.roomService.config;
    if (cfg) {
      this.isEditing = true;
      this.playerCount = cfg.maxPlayers;
      this.impostorCount = cfg.impostorCount;
      this.selectedCategory = cfg.category;
    }
  }

  selectCategory(id: string) { this.selectedCategory = id; }

  adjustPlayers(delta: number) {
    this.playerCount = Math.min(this.playerMax, Math.max(this.playerMin, this.playerCount + delta));
    if (this.impostorCount > this.maxImpostors) this.impostorCount = this.maxImpostors;
  }

  adjustImpostors(delta: number) {
    this.impostorCount = Math.min(this.maxImpostors, Math.max(1, this.impostorCount + delta));
  }

  async launch() {
    const roomId = this.isEditing ? this.roomService.config!.roomId : RoomService.generateRoomId();
    await this.roomService.setConfig({
      roomId,
      maxPlayers: this.playerCount,
      impostorCount: this.impostorCount,
      category: this.selectedCategory,
    });
    this.router.navigate(['/lobby', roomId]);
  }

  goBack() {
    if (this.isEditing) this.router.navigate(['/lobby', this.roomService.config!.roomId]);
    else this.router.navigate(['/']);
  }

  ngOnDestroy() { this.subs.unsubscribe(); }
}
