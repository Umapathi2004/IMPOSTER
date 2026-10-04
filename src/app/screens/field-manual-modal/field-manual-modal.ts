import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-field-manual-modal',
  standalone: true,
  imports: [],
  templateUrl: './field-manual-modal.html',
  styleUrl: './field-manual-modal.css',
})
export class FieldManualModal {
  @Output() close = new EventEmitter<void>();

  onOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('overlay')) {
      this.close.emit();
    }
  }
}
