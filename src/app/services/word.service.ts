import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

export interface WordEntry { word: string; hint: string; category: string; }

export interface CategoryInfo {
  id: string;
  label: string;
  count: number;
  index: string;
}

@Injectable({ providedIn: 'root' })
export class WordService {
  private words: WordEntry[] = [];
  categories$ = new BehaviorSubject<CategoryInfo[]>([
    { id: 'ALL', label: 'ALL CATEGORIES', count: 0, index: '...' }
  ]);

  constructor(private http: HttpClient) {}

  async load(): Promise<void> {
    const words = await firstValueFrom(this.http.get<WordEntry[]>('/words.json'));
    this.words = words;
    this.categories$.next(this.buildCategories(words));
  }

  getWords(category: string): WordEntry[] {
    if (category === 'ALL') return this.words;
    return this.words.filter(w => w.category === category);
  }

  private buildCategories(words: WordEntry[]): CategoryInfo[] {
    const map = new Map<string, WordEntry[]>();
    words.forEach(w => {
      if (!map.has(w.category)) map.set(w.category, []);
      map.get(w.category)!.push(w);
    });
    return [
      { id: 'ALL', label: 'ALL CATEGORIES', count: words.length, index: [...map.keys()].slice(0, 5).join(', ') },
      ...[...map.entries()].map(([cat, ws]) => ({
        id: cat,
        label: cat.toUpperCase(),
        count: ws.length,
        index: ws.slice(0, 4).map(w => w.word.toUpperCase()).join(', '),
      })),
    ];
  }
}
