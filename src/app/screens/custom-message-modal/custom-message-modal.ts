import { Component, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CustomMessageService, ModalOptions, ToastItem } from '../../services/custom-message.service';

@Component({
  selector: 'app-custom-message-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './custom-message-modal.html',
  styleUrl: './custom-message-modal.css',
})
export class CustomMessageModal implements OnInit, OnDestroy {
  modal: ModalOptions | null = null;
  toasts: ToastItem[] = [];

  private subs = new Subscription();

  constructor(
    public messageService: CustomMessageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subs.add(
      this.messageService.modal$.subscribe((m) => {
        this.modal = m;
        this.cdr.markForCheck();
      })
    );

    this.subs.add(
      this.messageService.toasts$.subscribe((t) => {
        this.toasts = t;
        this.cdr.markForCheck();
      })
    );
  }

  onAcknowledge(): void {
    this.messageService.closeModal();
  }

  dismissToast(id: string): void {
    this.messageService.dismissToast(id);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}
