import { Injectable } from '@angular/core';

export interface UserProfile {
  uid: string;
  name: string;
  avatar: string;
}

const KEY = 'imposter_profile';

function generateUid(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  get(): UserProfile | null {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  }

  save(profile: Omit<UserProfile, 'uid'>): UserProfile {
    const existing = this.get();
    const full: UserProfile = {
      uid: existing?.uid ?? generateUid(),
      ...profile,
    };
    localStorage.setItem(KEY, JSON.stringify(full));
    return full;
  }
}
