import { GroupValidator } from "./groupValidator.js";
import type { CardID, GameState } from "./types.js";

export function validateStateInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const locations = new Map<CardID, string[]>();
  const record = (id: CardID, location: string): void => {
    const entries = locations.get(id) ?? [];
    entries.push(location);
    locations.set(id, entries);
  };

  state.drawPile.forEach((id) => record(id, "draw pile"));
  state.discard.forEach((id) => record(id, "trash"));
  for (let player = 0; player < state.numPlayers; player++) {
    const hand = state.playersPrivate[player]?.hand;
    if (!hand) {
      errors.push(`Player ${player} has no private state.`);
      continue;
    }
    hand.forEach((id) => record(id, `player ${player} hand`));
    if (state.playersPublic[player]?.handCount !== hand.length) {
      errors.push(`Player ${player}'s public hand count is incorrect.`);
    }
  }
  state.tableMelds.forEach((meld) => {
    meld.cardIds.forEach((id) => record(id, `meld ${meld.id}`));
    const validation = GroupValidator.validateMeld(
      meld.cardIds.map((id) => state.cardsById[id]),
      { kind: meld.kind, fixedJokerMap: meld.jokerMap },
    );
    if (!validation.ok) errors.push(`Active meld ${meld.id} is invalid: ${validation.error}`);
    else if (validation.complete) errors.push(`Complete meld ${meld.id} should have burnt.`);
  });

  for (const id of Object.keys(state.cardsById)) {
    const cardLocations = locations.get(id) ?? [];
    if (cardLocations.length === 0) errors.push(`Card ${id} has disappeared.`);
    if (cardLocations.length > 1) errors.push(`Card ${id} exists in multiple locations: ${cardLocations.join(", ")}.`);
  }
  for (const id of locations.keys()) {
    if (!state.cardsById[id]) errors.push(`Unknown card ${id} exists in game state.`);
  }

  if (state.deckCount !== state.drawPile.length) errors.push("The public draw-pile count is incorrect.");
  if (state.phase === "DRAW" && (state.lastDrawnCardId || state.lastDrawSource)) {
    errors.push("A new draw phase retained the previous turn's draw metadata.");
  }
  if ((state.phase === "ACTION" || state.phase === "DISCARD") && (!state.lastDrawnCardId || !state.lastDrawSource)) {
    errors.push("An active turn is missing its draw metadata.");
  }
  return errors;
}
