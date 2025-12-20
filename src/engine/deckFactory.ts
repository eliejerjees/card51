import type { CardDTO } from "./types";
import { Rank, Suit } from "./card";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Matches your Java: 2 decks of normal cards, plus 2 jokers total
export function makeShuffledDeck(): CardDTO[] {
  const out: CardDTO[] = [];

  for (let d = 0; d < 2; d++) {
    for (const s of Object.values(Suit)) {
      if (s === Suit.JOKER) continue;
      for (const r of Object.values(Rank)) {
        if (r === Rank.JOKER) continue;
        out.push({ id: uid(), suit: s, rank: r });
      }
    }
  }

  out.push({ id: uid(), suit: Suit.JOKER, rank: Rank.JOKER });
  out.push({ id: uid(), suit: Suit.JOKER, rank: Rank.JOKER });

  shuffleInPlace(out);
  return out;
}
