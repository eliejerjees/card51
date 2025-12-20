// src/engine/deck.ts

import { Card, Rank, Suit } from "./card";

export class Deck {
  private drawPile: Card[] = [];
  private discardPile: Card[] = [];

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    this.drawPile = [];
    this.discardPile = [];

    // 2 decks, no joker suit/rank inside the main loops
    for (let d = 0; d < 2; d++) {
      for (const s of Object.values(Suit)) {
        if (s === Suit.JOKER) continue;

        for (const r of Object.values(Rank)) {
          if (r === Rank.JOKER) continue;
          this.drawPile.push(new Card(s, r));
        }
      }
    }

    // Only 2 jokers total (matches your Java)
    this.drawPile.push(new Card(Suit.JOKER, Rank.JOKER));
    this.drawPile.push(new Card(Suit.JOKER, Rank.JOKER));

    this.shuffleInPlace(this.drawPile);
  }

  public draw(): Card {
    if (this.drawPile.length === 0) this.reshuffle();
    const c = this.drawPile.pop();
    if (!c) throw new Error("Cannot draw: draw pile is empty.");
    return c;
  }

  public discard(c: Card): void {
    this.discardPile.push(c);
  }

  public pullDiscard(): Card {
    const c = this.discardPile.pop();
    if (!c) throw new Error("Cannot pull discard: discard pile is empty.");
    return c;
  }

  public peekDiscard(): Card | undefined {
    return this.discardPile[this.discardPile.length - 1];
  }

  public isDiscardEmpty(): boolean {
    return this.discardPile.length === 0;
  }

  private reshuffle(): void {
    if (this.discardPile.length === 0) {
      throw new Error("Cannot reshuffle: discard pile is empty.");
    }
    if (this.discardPile.length === 1) {
      // Only top card exists; nothing to reshuffle back into draw pile.
      throw new Error("Cannot reshuffle: not enough cards in discard pile.");
    }

    const top = this.discardPile.pop()!;

    // Move remaining discards into draw pile
    this.drawPile.push(...this.discardPile);
    this.discardPile = [top];

    this.shuffleInPlace(this.drawPile);
  }

  private shuffleInPlace<T>(arr: T[]): void {
    // Fisher–Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}
