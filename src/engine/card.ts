// src/engine/card.ts

export const Suit = {
  CLUBS: "CLUBS",
  DIAMONDS: "DIAMONDS",
  HEARTS: "HEARTS",
  SPADES: "SPADES",
  JOKER: "JOKER",
} as const;

export type Suit = typeof Suit[keyof typeof Suit];

export const Rank = {
  TWO: "TWO",
  THREE: "THREE",
  FOUR: "FOUR",
  FIVE: "FIVE",
  SIX: "SIX",
  SEVEN: "SEVEN",
  EIGHT: "EIGHT",
  NINE: "NINE",
  TEN: "TEN",
  JACK: "JACK",
  QUEEN: "QUEEN",
  KING: "KING",
  ACE: "ACE",
  JOKER: "JOKER",
} as const;

export type Rank = typeof Rank[keyof typeof Rank];

export class Card {
  public readonly suit: Suit;
  public readonly rank: Rank;

  constructor(suit: Suit, rank: Rank) {
    this.suit = suit;
    this.rank = rank;
  }

  public isJoker(): boolean {
    return this.rank === Rank.JOKER;
  }

  public getValue(): number {
    if (this.isJoker()) return 0;

    switch (this.rank) {
      case Rank.ACE:
      case Rank.KING:
      case Rank.QUEEN:
      case Rank.JACK:
      case Rank.TEN:
        return 10;
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
      default:
        return 0;
    }
  }

  public toString(): string {
    return this.isJoker() ? "JOKER" : `${this.rank} of ${this.suit}`;
  }
}
