import type { CardDTO } from "./types";
import { Rank, STANDARD_RANKS, STANDARD_SUITS, Suit } from "./card";

export function shuffleInPlace<T>(arr: T[], random: () => number = Math.random): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Matches your Java: 2 decks of normal cards, plus 2 jokers total
export function makeShuffledDeck(random: () => number = Math.random): CardDTO[] {
  const out: CardDTO[] = [];

  for (let d = 0; d < 2; d++) {
    for (const s of STANDARD_SUITS) {
      for (const r of STANDARD_RANKS) {
        out.push({ id: `deck${d + 1}-${r}-${s}`, suit: s, rank: r });
      }
    }
  }

  out.push({ id: "joker-1", suit: Suit.JOKER, rank: Rank.JOKER });
  out.push({ id: "joker-2", suit: Suit.JOKER, rank: Rank.JOKER });

  shuffleInPlace(out, random);
  return out;
}
