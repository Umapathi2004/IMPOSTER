import { Component } from '@angular/core';
import { Router } from '@angular/router';

interface Category {
  id: string;
  label: string;
  wordCount: number;
  index: string;
}

@Component({
  selector: 'app-word-category',
  imports: [],
  templateUrl: './word-category.html',
  styleUrl: './word-category.css',
})
export class WordCategory {
  selected = 'ALL';

  categories: Category[] = [
    { id: 'ALL',         label: 'ALL CATEGORIES', wordCount: 550, index: 'SCI-FI, ARTIFACTS, BIO-HAZARD, SATELLITES' },
    { id: 'CYBERNETICS', label: 'CYBERNETICS',     wordCount: 120, index: 'IMPLANTS, NEURAL, AUGMENTS, CIRCUITS' },
    { id: 'ORBITAL',     label: 'ORBITAL DECK',    wordCount: 95,  index: 'STATIONS, DOCKING, AIRLOCKS, MODULES' },
    { id: 'TERRAFORM',   label: 'TERRAFORM',       wordCount: 88,  index: 'COLONIES, ATMOSPHERE, SOIL, DOMES' },
    { id: 'BIOHAZARD',   label: 'BIO-HAZARD',      wordCount: 74,  index: 'TOXINS, MUTAGENS, SPORES, QUARANTINE' },
    { id: 'ARTIFACTS',   label: 'ARTIFACTS',       wordCount: 63,  index: 'RELICS, SIGNALS, VAULTS, ANOMALIES' },
  ];

  get active(): Category {
    return this.categories.find(c => c.id === this.selected)!;
  }

  get totalWords(): number {
    return this.active.wordCount;
  }

  select(id: string) { this.selected = id; }

  constructor(private router: Router) {}

  goBack() { this.router.navigate(['/']); }
}
