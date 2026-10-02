import { Component, EventEmitter, Output } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ProfileService, UserProfile } from '../../services/profile.service';

@Component({
  selector: 'app-profile-modal',
  imports: [FormsModule],
  templateUrl: './profile-modal.html',
  styleUrl: './profile-modal.css',
})
export class ProfileModal {
  @Output() done = new EventEmitter<UserProfile>();
  @Output() close = new EventEmitter<void>();

  avatars = [
    'avatars/01_orange_shush.png',
    'avatars/02_blue_headset.png',
    'avatars/03_red_arms_crossed.png',
    'avatars/04_yellow_thumbs_up.png',
    'avatars/05_green_shush.png',
    'avatars/06_orange_dab.png',
    'avatars/07_purple_point.png',
    'avatars/08_pink_heart.png',
    'avatars/09_black_thinking.png',
    'avatars/10_white_wave.png',
    'avatars/11_cyan_salute.png',
  ];

  name = '';
  avatar = this.avatars[0];

  constructor(private profileService: ProfileService) {
    const existing = this.profileService.get();
    if (existing) {
      this.name = existing.name;
      this.avatar = existing.avatar;
    }
  }

  select(a: string) { this.avatar = a; }

  onNameInput(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.toUpperCase();
    this.name = input.value;
  }

  confirm() {
    if (!this.name.trim()) return;
    const profile = this.profileService.save({ name: this.name.trim(), avatar: this.avatar });
    this.done.emit(profile);
  }
}
