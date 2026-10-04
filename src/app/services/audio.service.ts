import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AudioService {
  private audio = new Audio('music/game_music.mp3');
  readonly isPlaying = signal(false);

  constructor() {
    this.audio.loop = true;
    this.audio.addEventListener('play', () => this.isPlaying.set(true));
    this.audio.addEventListener('pause', () => this.isPlaying.set(false));
    this.audio.addEventListener('ended', () => this.isPlaying.set(false));
  }

  play(): Promise<void> {
    return this.audio.play()
      .then(() => {
        this.isPlaying.set(true);
      })
      .catch((err) => {
        console.warn('Audio play was prevented or failed:', err);
        this.isPlaying.set(false);
      });
  }

  pause(): void {
    this.audio.pause();
    this.isPlaying.set(false);
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.isPlaying.set(false);
  }

  toggle(): void {
    if (this.isPlaying()) {
      this.stop();
    } else {
      this.play();
    }
  }
}
