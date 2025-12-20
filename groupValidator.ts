// src/engine/groupValidator.ts
//
// Direct port of your Java GroupValidator, including Ace LOW/HIGH run logic
// and the joker "fills gaps" rule.

import { Card, Rank, Suit } from "./card";

export enum AceMode {
  LOW = "LOW",
  HIGH = "HIGH",
}

export class GroupValidator {
  public static isValidSet(cards: ReadonlyArray<Card>): boolean {
    if (cards.length < 3 || cards.length > 4) return false;

    const suits = new Set<Suit>();
    let rank: Rank | null = null;
    let jokers = 0;

    for (const c of cards) {
      if (c.isJoker()) {
        jokers++;
      } else {
        if (rank === null) rank = c.rank;
        else if (c.rank !== rank) return false;
        suits.add(c.suit);
      }
    }

    // suits must be unique among non-jokers; jokers can stand in for missing suits
    return suits.size + jokers === cards.length;
  }

  public static isValidRun(cards: ReadonlyArray<Card>, mode: AceMode): boolean {
    if (cards.length < 3) return false;

    const sorted = [...cards].sort(
      (a, b) => this.getRankIndex(a.rank, mode) - this.getRankIndex(b.rank, mode)
    );

    let suit: Suit | null = null;
    let jokers = 0;

    for (const c of sorted) {
      if (c.isJoker()) {
        jokers++;
      } else {
        if (suit === null) suit = c.suit;
        else if (c.suit !== suit) return false;
      }
    }

    let gaps = 0;

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      // Same behavior as your Java: ignore gap checks if either is a joker.
      if (prev.isJoker() || curr.isJoker()) continue;

      const diff =
        this.getRankIndex(curr.rank, mode) - this.getRankIndex(prev.rank, mode) - 1;

      if (diff > 0) {
        gaps += diff;
        if (gaps > jokers) return false;
      }
    }

    return true;
  }

  private static getRankIndex(rank: Rank, mode: AceMode): number {
    switch (rank) {
      case Rank.TWO:
        return 2;
      case Rank.THREE:
        return 3;
      case Rank.FOUR:
        return 4;
      case Rank.FIVE:
        return 5;
      case Rank.SIX:
        return 6;
      case Rank.SEVEN:
        return 7;
      case Rank.EIGHT:
        return 8;
      case Rank.NINE:
        return 9;
      case Rank.TEN:
        return 10;
      case Rank.JACK:
        return 11;
      case Rank.QUEEN:
        return 12;
      case Rank.KING:
        return 13;
      case Rank.ACE:
        return mode === AceMode.HIGH ? 14 : 1;
      // Joker and anything unexpected
      default:
        return 0;
    }
  }

  public static getGroupPoints(cards: ReadonlyArray<Card>): number {
    let sum = 0;
    for (const c of cards) sum += c.getValue();
    return sum;
  }
}
