import { Injectable } from '@angular/core';
import jsQR from 'jsqr';

const log = (tag: string, ...args: any[]) =>
  console.log(`%c[${tag}]`, 'color:#A78BFA;font-weight:bold', ...args);

@Injectable({ providedIn: 'root' })
export class QrScannerService {

  private useNative = typeof (window as any)['BarcodeDetector'] !== 'undefined';
  private detector: any = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor() {
    if (this.useNative) {
      this.detector = new (window as any)['BarcodeDetector']({ formats: ['qr_code'] });
      log('QR', 'Using native BarcodeDetector');
    } else {
      this.canvas = document.createElement('canvas');
      this.ctx    = this.canvas.getContext('2d', { willReadFrequently: true })!;
      log('QR', 'Using jsQR fallback');
    }
  }

  /** Scan a single frame from a video element. Returns raw string or null. */
  async scan(video: HTMLVideoElement): Promise<string | null> {
    if (!video || video.readyState < 2) return null;

    if (this.useNative) {
      try {
        const codes = await this.detector.detect(video);
        return codes.length > 0 ? codes[0].rawValue : null;
      } catch {
        return null;
      }
    }

    // jsQR fallback — draw frame to canvas and decode
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    this.canvas!.width  = w;
    this.canvas!.height = h;
    this.ctx!.drawImage(video, 0, 0, w, h);
    const imageData = this.ctx!.getImageData(0, 0, w, h);
    const result = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
    return result ? result.data : null;
  }
}
