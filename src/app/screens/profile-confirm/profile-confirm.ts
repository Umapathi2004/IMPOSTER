import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UserProfile } from '../../services/profile.service';

@Component({
  selector: 'app-profile-confirm',
  imports: [],
  templateUrl: './profile-confirm.html',
  styleUrl: './profile-confirm.css',
})
export class ProfileConfirm {
  @Input() profile!: UserProfile;
  @Input() action: 'create' | 'join' = 'create';
  @Output() confirm = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  get actionLabel() {
    return this.action === 'create' ? 'CREATE ROOM' : 'JOIN ROOM';
  }
}
