import type { Rank, Suit } from "./card";

export type CardID = string;

export type CardDTO = {
  id: CardID;
  suit: Suit;
  rank: Rank;
};

export type DrawSource = "DECK" | "DISCARD";

export type PlayerID = number;

export type Phase = "DRAW" | "ACTION" | "DISCARD" | "GAME_OVER";

export type AceMode = "LOW" | "HIGH";

export type JokerRep = {
  suit: Suit;
  rank: Rank;
}

export type MeldKind = "SET" | "RUN";

export type Meld = {
  id: string;
  owner: PlayerID;
  cardIds: CardID[];
  kind: MeldKind;
  aceMode?: AceMode;
  jokerMap: Record<CardID, { suit: Suit; rank: Rank }>;
};

export type GameEventType =
  | "DRAW_DECK"
  | "DRAW_DISCARD"
  | "OPEN"
  | "CREATE_MELD"
  | "EXTEND_MELD"
  | "REPLACE_JOKER"
  | "BURN"
  | "DISCARD"
  | "WIN";

export type GameEvent = {
  id: string;
  type: GameEventType;
  message: string;
  player?: PlayerID;
  cardId?: CardID;
  meldId?: string;
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
  numPlayers: number;
  currentTurn: PlayerID;
  phase: Phase;
  winner: PlayerID | null;

  drawPile: CardID[]; // top is last
  deckCount: number;
  discard: CardID[]; // top is last
  lastDrawnCardId: CardID | null;

  lastDrawSource: DrawSource | null;

  // All cards known locally in bots mode
  cardsById: Record<CardID, CardDTO>;

  playersPublic: Record<PlayerID, PlayerPublic>;
  playersPrivate: Record<PlayerID, PlayerPrivate>;

  tableMelds: Meld[];
  events: GameEvent[];
  turnNumber: number;
  turnTimeLimitMs: number | null;
  lastBurnedMeld: Meld | null;
};
