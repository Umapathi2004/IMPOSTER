import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ProfileModal } from '../profile-modal/profile-modal';
import { ProfileConfirm } from '../profile-confirm/profile-confirm';
import { FieldManualModal } from '../field-manual-modal/field-manual-modal';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { RoomService } from '../../services/room.service';
import { AudioService } from '../../services/audio.service';

@Component({
  selector: 'app-home-screen',
  imports: [ProfileModal, ProfileConfirm, FieldManualModal],
  templateUrl: './home-screen.html',
  styleUrl: './home-screen.css',
})
export class HomeScreen implements OnInit {
  get fxOn(): boolean {
    return this.audioService.isPlaying();
  }

  showProfileModal = false;
  showProfileConfirm = false;
  showFieldManual = false;
  pendingAction: 'create' | 'join' = 'create';
  profile: UserProfile | null = null;
  localIp = signal('...');

  constructor(
    private profileService: ProfileService,
    private roomService: RoomService,
    private router: Router,
    private audioService: AudioService,
  ) {
    this.profile = this.profileService.get();
  }

  ngOnInit() { this._detectLocalIp(); }

  private async _detectLocalIp() {
    try {
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      if (isLocal) {
        const url = this.roomService.getApiUrl('/api/ip');
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          if (data.ip) { this.localIp.set(data.ip); return; }
        }
      }
    } catch {}
    this.localIp.set('ONLINE');
  }

  toggleFx() {
    this.audioService.toggle();
  }

  onCreateRoom() { this.handleAction('create'); }
  onJoinRoom()   { this.handleAction('join'); }

  private handleAction(action: 'create' | 'join') {
    this.pendingAction = action;
    if (this.profile) {
      this.showProfileConfirm = true;
    } else {
      this.showProfileModal = true;
    }
  }

  onProfileDone(profile: UserProfile) {
    this.profile = profile;
    this.showProfileModal = false;
    this.proceed();
  }

  onConfirmContinue() {
    this.showProfileConfirm = false;
    this.proceed();
  }

  onConfirmEdit() {
    this.showProfileConfirm = false;
    this.showProfileModal = true;
  }

  private proceed() {
    if (this.pendingAction === 'create') {
      this.router.navigate(['/create-room']);
    } else {
      this.router.navigate(['/join']);
    }
  }
}
