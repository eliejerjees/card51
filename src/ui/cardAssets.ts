// src/ui/cardAssets.ts

import type { CardDTO } from "../engine/types";
import type { Rank, Suit } from "../engine/card";

export function assetRank(rank: Rank): string {
  switch (rank) {
    case "ACE": return "A";
    case "KING": return "K";
    case "QUEEN": return "Q";
    case "JACK": return "J";
    case "TEN": return "T";
    case "NINE": return "9";
    case "EIGHT": return "8";
    case "SEVEN": return "7";
    case "SIX": return "6";
    case "FIVE": return "5";
    case "FOUR": return "4";
    case "THREE": return "3";
    case "TWO": return "2";
    case "JOKER": return "1";
    default: return "";
  }
}

export function assetSuit(suit: Suit): string {
  switch (suit) {
    case "SPADES": return "S";
    case "HEARTS": return "H";
    case "DIAMONDS": return "D";
    case "CLUBS": return "C";
    case "JOKER": return "J";
    default: return "";
  }
}


export function cardAssetPath(card: CardDTO): string {
  if (card.rank === "JOKER") return "/cards/1J.svg";
  return `/cards/${assetRank(card.rank)}${assetSuit(card.suit)}.svg`;
}
export function cardBackAssetPath(): string {
  return "/cards/BACK.svg";
}