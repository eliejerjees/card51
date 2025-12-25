import type { Rank, Suit } from "./card";
import type { AceMode } from "./groupValidator";

export type CardID = string;

export type CardDTO = {
  id: CardID;
  suit: Suit;
  rank: Rank;
};

export type DrawSource = "DECK" | "DISCARD";

export type PlayerID = 0 | 1 | 2 | 3;

export type Phase = "DRAW" | "ACTION" | "DISCARD" | "GAME_OVER";

export type JokerRep = {
  suit: Suit;
  rank: Rank;
}

export type meldKind = "SET" | "RUN";

export type Meld = {
  id: string;
  owner: PlayerID;
  cardIds: CardID[];
  kind: meldKind;
  aceMode: AceMode;
  jokerMap: Record<CardID, { suit: Suit; rank: Rank }>;
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

  lastDrawSource: DrawSource | null;

  // All cards known locally in bots mode
  cardsById: Record<CardID, CardDTO>;

  playersPublic: Record<PlayerID, PlayerPublic>;
  playersPrivate: Record<PlayerID, PlayerPrivate>;

  tableMelds: Meld[];
};
