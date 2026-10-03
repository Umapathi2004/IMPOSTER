import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ProfileModal } from '../profile-modal/profile-modal';
import { ProfileConfirm } from '../profile-confirm/profile-confirm';
import { ProfileService, UserProfile } from '../../services/profile.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-home-screen',
  imports: [ProfileModal, ProfileConfirm],
  templateUrl: './home-screen.html',
  styleUrl: './home-screen.css',
})
export class HomeScreen implements OnInit {
  fxOn = false;
  private audio = new Audio('music/game_music.mp3');

  showProfileModal = false;
  showProfileConfirm = false;
  pendingAction: 'create' | 'join' = 'create';
  profile: UserProfile | null = null;
  localIp = signal('...');

  constructor(
    private profileService: ProfileService,
    private router: Router,
  ) {
    this.audio.loop = true;
    this.profile = this.profileService.get();
  }

  ngOnInit() { this._detectLocalIp(); }

  private async _detectLocalIp() {
    try {
      const res = await fetch(`${environment.BACKEND_URL}/api/ip`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        if (data.ip) { this.localIp.set(data.ip); return; }
      }
    } catch {}
    this.localIp.set(window.location.hostname || 'LOCAL');
  }

  toggleFx() {
    this.fxOn = !this.fxOn;
    this.fxOn ? this.audio.play() : (this.audio.pause(), this.audio.currentTime = 0);
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
