import type { CardDTO, CardID, GameEvent, GameState, Meld, Phase, PlayerID, PlayerPublic } from "./types.js";

export type PlayerGameView = {
  viewer: PlayerID;
  numPlayers: number;
  currentTurn: PlayerID;
  phase: Phase;
  winner: PlayerID | null;
  deckCount: number;
  topDiscardId: CardID | null;
  lastDrawnCardId: CardID | null;
  lastDrawSource: GameState["lastDrawSource"];
  cardsById: Record<CardID, CardDTO>;
  playersPublic: Record<PlayerID, PlayerPublic>;
  ownHand: CardID[];
  tableMelds: Meld[];
  events: GameEvent[];
  turnNumber: number;
  turnTimeLimitMs: number | null;
  lastBurnedMeld: Meld | null;
};

/** Returns only information this player is allowed to know. */
export function createPlayerView(state: GameState, viewer: PlayerID): PlayerGameView {
  const ownHand = state.playersPrivate[viewer]?.hand;
  if (!ownHand) throw new Error("Cannot create a view for an unknown player.");
  const topDiscardId = state.discard[state.discard.length - 1] ?? null;
  const knownIds = new Set<CardID>(ownHand);
  if (topDiscardId) knownIds.add(topDiscardId);
  state.tableMelds.forEach((meld) => meld.cardIds.forEach((id) => knownIds.add(id)));
  state.lastBurnedMeld?.cardIds.forEach((id) => knownIds.add(id));
  state.events.forEach((event) => {
    if (event.cardId) knownIds.add(event.cardId);
  });

  const cardsById = Object.fromEntries(
    [...knownIds].filter((id) => state.cardsById[id]).map((id) => [id, structuredClone(state.cardsById[id])]),
  );
  return {
    viewer,
    numPlayers: state.numPlayers,
    currentTurn: state.currentTurn,
    phase: state.phase,
    winner: state.winner,
    deckCount: state.deckCount,
    topDiscardId,
    lastDrawnCardId: state.currentTurn === viewer ? state.lastDrawnCardId : null,
    lastDrawSource: state.currentTurn === viewer ? state.lastDrawSource : null,
    cardsById,
    playersPublic: structuredClone(state.playersPublic),
    ownHand: [...ownHand],
    tableMelds: structuredClone(state.tableMelds),
    events: structuredClone(state.events),
    turnNumber: state.turnNumber,
    turnTimeLimitMs: state.turnTimeLimitMs,
    lastBurnedMeld: structuredClone(state.lastBurnedMeld),
  };
}
