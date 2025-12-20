import type { Rank, Suit } from "./card";

export type CardID = string;

export type CardDTO = {
  id: CardID;
  suit: Suit;
  rank: Rank;
};

export type PlayerID = 0 | 1 | 2 | 3;

export type Phase = "DRAW" | "ACTION" | "DISCARD" | "GAME_OVER";

export type Meld = {
  id: string; // meld id for UI
  owner: PlayerID;
  cardIds: CardID[];
};

export type PlayerPublic = {
  id: PlayerID;
  opened: boolean;
  handCount: number;
};

export type PlayerPrivate = {
  hand: CardID[];
};

export type GameState = {
  numPlayers: 2 | 3 | 4;
  currentTurn: PlayerID;
  phase: Phase;
  winner: PlayerID | null;

  deckCount: number;
  discard: CardID[]; // top is last
  lastDrawnCardId: CardID | null;

  // All cards known locally in bots mode
  cardsById: Record<CardID, CardDTO>;

  playersPublic: Record<PlayerID, PlayerPublic>;
  playersPrivate: Record<PlayerID, PlayerPrivate>;

  tableMelds: Meld[];
};
