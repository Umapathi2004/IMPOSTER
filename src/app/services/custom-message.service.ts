import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type CustomMessageType = 'error' | 'warning' | 'info' | 'success';

export interface ModalOptions {
  title?: string;
  message: string;
  type?: CustomMessageType;
  icon?: string;
  buttonText?: string;
  onConfirm?: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  type: CustomMessageType;
  icon?: string;
}

@Injectable({ providedIn: 'root' })
export class CustomMessageService {
  modal$ = new BehaviorSubject<ModalOptions | null>(null);
  toasts$ = new BehaviorSubject<ToastItem[]>([]);

  private resolveModal?: () => void;

  /**
   * Show a custom retro modal dialog. Returns a Promise that resolves when user clicks the action button.
   */
  showModal(options: ModalOptions): Promise<void> {
    return new Promise((resolve) => {
      this.resolveModal = () => {
        if (options.onConfirm) {
          try { options.onConfirm(); } catch (e) {}
        }
        resolve();
      };

      const defaultIcon =
        options.type === 'error'
          ? 'fa-solid fa-triangle-exclamation'
          : options.type === 'warning'
          ? 'fa-solid fa-shield-halved'
          : options.type === 'success'
          ? 'fa-solid fa-circle-check'
          : 'fa-solid fa-satellite-dish';

      this.modal$.next({
        title: options.title || (options.type === 'error' ? 'ACCESS DENIED' : 'TERMINAL ALERT'),
        message: options.message,
        type: options.type || 'info',
        icon: options.icon || defaultIcon,
        buttonText: options.buttonText || 'ACKNOWLEDGE',
        onConfirm: this.resolveModal,
      });
    });
  }

  /**
   * Convenient helper mimicking native alert() with custom retro aesthetics
   */
  alert(message: string, title?: string, type: CustomMessageType = 'warning'): Promise<void> {
    return this.showModal({
      title: title || (type === 'error' ? 'SYSTEM ERROR' : 'NOTICE'),
      message,
      type,
      buttonText: 'ACKNOWLEDGE',
    });
  }

  /**
   * Close the active modal
   */
  closeModal(): void {
    const cb = this.resolveModal;
    this.resolveModal = undefined;
    this.modal$.next(null);
    if (cb) cb();
  }

  /**
   * Display a quick floating HUD toast notification in-game
   */
  toast(message: string, type: CustomMessageType = 'info', icon?: string): void {
    const id = Math.random().toString(36).substring(2, 9);
    const defaultIcon =
      type === 'error'
        ? 'fa-solid fa-circle-exclamation'
        : type === 'warning'
        ? 'fa-solid fa-person-walking-arrow-right'
        : type === 'success'
        ? 'fa-solid fa-circle-check'
        : 'fa-solid fa-bell';

    const item: ToastItem = {
      id,
      message,
      type,
      icon: icon || defaultIcon,
    };

    const current = this.toasts$.value;
    this.toasts$.next([...current, item]);

    // Auto dismiss after 3.8s
    setTimeout(() => {
      this.dismissToast(id);
    }, 3800);
  }

  dismissToast(id: string): void {
    this.toasts$.next(this.toasts$.value.filter((t) => t.id !== id));
  }
}
