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

export const STANDARD_SUITS: Suit[] = [Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, Suit.SPADES];
export const STANDARD_RANKS: Rank[] = [
  Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN,
  Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE,
];
const TEN_POINT_RANKS: Rank[] = [Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE];

export function cardPointValue(rank: Rank): number {
  if (rank === Rank.JOKER) return 0;
  if (TEN_POINT_RANKS.includes(rank)) return 10;
  return STANDARD_RANKS.indexOf(rank) + 2;
}

export class Card {
  public readonly suit: Suit;
  public readonly rank: Rank;

  constructor(suit: Suit, rank: Rank,) {
    this.suit = suit;
    this.rank = rank;
  }

  public isJoker(): boolean {
    return this.rank === Rank.JOKER;
  }

  public getValue(): number {
    return cardPointValue(this.rank);
  }

  public toString(): string {
    return this.isJoker() ? "JOKER" : `${this.rank} of ${this.suit}`;
  }
}
