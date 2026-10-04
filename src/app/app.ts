import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CustomMessageModal } from './screens/custom-message-modal/custom-message-modal';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CustomMessageModal],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('IMPOSTER');
}
