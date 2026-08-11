import type { Action, MeldInput, MeldProposal } from "./actions";
import { makeShuffledDeck, shuffleInPlace } from "./deckFactory";
import { GroupValidator } from "./groupValidator";
import { validateStateInvariants } from "./invariants";
import { canTakeDiscardForOpening } from "./opening";
import type { CardID, GameEventType, GameState, Meld, PlayerID } from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

const success = (): ActionResult => ({ ok: true });
const failure = (error: string): ActionResult => ({ ok: false, error });

function addEvent(
  state: GameState,
  type: GameEventType,
  message: string,
  details: Partial<Pick<Meld, "id">> & { player?: PlayerID; cardId?: CardID } = {},
): void {
  state.events.push({
    id: `event-${state.events.length + 1}`,
    type,
    message,
    player: details.player,
    cardId: details.cardId,
    meldId: details.id,
  });
}

function ensurePlayer(state: GameState, player: PlayerID): string | null {
  if (state.phase === "GAME_OVER") return "The game is over.";
  if (!Number.isInteger(player) || !state.playersPrivate[player]) return "Unknown player.";
  if (player !== state.currentTurn) return "It is not your turn.";
  return null;
}

function uniqueKnownHandCards(state: GameState, player: PlayerID, cardIds: CardID[]): string | null {
  if (cardIds.length === 0) return "Select at least one card.";
  if (new Set(cardIds).size !== cardIds.length) return "A physical card can only be used once.";
  const hand = state.playersPrivate[player].hand;
  if (cardIds.some((id) => !state.cardsById[id] || !hand.includes(id))) return "Every selected card must be in your hand.";
  return null;
}

function removeFromHand(state: GameState, player: PlayerID, cardIds: CardID[]): boolean {
  if (uniqueKnownHandCards(state, player, cardIds)) return false;
  const removed = new Set(cardIds);
  state.playersPrivate[player].hand = state.playersPrivate[player].hand.filter((id) => !removed.has(id));
  state.playersPublic[player].handCount = state.playersPrivate[player].hand.length;
  return true;
}

function addToHand(state: GameState, player: PlayerID, cardIds: CardID[]): void {
  state.playersPrivate[player].hand.push(...cardIds);
  state.playersPublic[player].handCount = state.playersPrivate[player].hand.length;
}

function newMeldId(state: GameState): string {
  return `meld-${state.turnNumber}-${state.tableMelds.length + state.events.length + 1}`;
}

function normalizeMeldInput(input: MeldInput): MeldProposal {
  return Array.isArray(input) ? { cardIds: input } : input;
}

function burnOrActivateMeld(state: GameState, meld: Meld, complete: boolean, player: PlayerID): void {
  if (!complete) {
    state.tableMelds.push(meld);
    return;
  }
  state.lastBurnedMeld = structuredClone(meld);
  state.discard.push(...meld.cardIds);
  addEvent(state, "BURN", `Player ${player + 1} completed and burnt a ${meld.kind.toLowerCase()}.`, {
    player,
    id: meld.id,
  });
}

function recycleDiscardIntoDrawPile(state: GameState): boolean {
  if (state.drawPile.length > 0) return true;
  if (state.discard.length <= 1) return false;
  const topDiscard = state.discard.pop()!;
  state.drawPile = [...state.discard];
  state.discard = [topDiscard];
  shuffleInPlace(state.drawPile);
  state.deckCount = state.drawPile.length;
  return true;
}

function nextTurn(state: GameState): void {
  state.currentTurn = (state.currentTurn + 1) % state.numPlayers;
  state.phase = "DRAW";
  state.lastDrawnCardId = null;
  state.lastDrawSource = null;
  state.lastBurnedMeld = null;
  state.turnNumber += 1;
}

export function initGame(
  numPlayers: number,
  options: { random?: () => number; turnTimeLimitMs?: number | null } = {},
): GameState {
  if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 4) {
    throw new Error("Card51 currently supports two to four players.");
  }
  const random = options.random ?? Math.random;
  const deck = makeShuffledDeck(random);
  const cardsById = Object.fromEntries(deck.map((card) => [card.id, card]));
  const playersPublic: GameState["playersPublic"] = {};
  const playersPrivate: GameState["playersPrivate"] = {};
  for (let player = 0; player < numPlayers; player++) {
    playersPublic[player] = { id: player, opened: false, handCount: 0 };
    playersPrivate[player] = { hand: [] };
  }

  let dealt = 0;
  for (let player = 0; player < numPlayers; player++) {
    const hand = deck.slice(dealt, dealt + 14).map((card) => card.id);
    dealt += 14;
    playersPrivate[player].hand = hand;
    playersPublic[player].handCount = hand.length;
  }
  const drawPile = deck.slice(dealt).map((card) => card.id);

  return {
    numPlayers,
    currentTurn: Math.floor(random() * numPlayers),
    phase: "DRAW",
    winner: null,
    drawPile,
    deckCount: drawPile.length,
    discard: [],
    lastDrawnCardId: null,
    lastDrawSource: null,
    cardsById,
    playersPublic,
    playersPrivate,
    tableMelds: [],
    events: [],
    turnNumber: 1,
    turnTimeLimitMs: options.turnTimeLimitMs ?? null,
    lastBurnedMeld: null,
  };
}

function drawFromDeck(state: GameState, player: PlayerID): ActionResult {
  if (state.phase !== "DRAW") return failure("You have already drawn this turn.");
  if (!recycleDiscardIntoDrawPile(state)) return failure("The draw pile is empty and there are no discards to recycle.");
  const id = state.drawPile.pop()!;
  state.deckCount = state.drawPile.length;
  addToHand(state, player, [id]);
  state.lastDrawnCardId = id;
  state.lastDrawSource = "DECK";
  state.phase = "ACTION";
  addEvent(state, "DRAW_DECK", `Player ${player + 1} drew from the draw pile.`, { player });
  return success();
}

function drawFromDiscard(state: GameState, player: PlayerID): ActionResult {
  if (state.phase !== "DRAW") return failure("You have already drawn this turn.");
  const id = state.discard[state.discard.length - 1];
  if (!id) return failure("The trash pile is empty.");
  if (!state.playersPublic[player].opened) {
    const canOpen = canTakeDiscardForOpening(state.playersPrivate[player].hand, id, state.cardsById);
    if (!canOpen) return failure("You may only take this trash card if it enables a legal 51-point opening that uses it.");
  }
  state.discard.pop();
  addToHand(state, player, [id]);
  state.lastDrawnCardId = id;
  state.lastDrawSource = "DISCARD";
  state.phase = "ACTION";
  addEvent(state, "DRAW_DISCARD", `Player ${player + 1} took the top trash card.`, { player, cardId: id });
  return success();
}

function openWithGroups(state: GameState, player: PlayerID, groups: MeldInput[]): ActionResult {
  if (state.phase !== "ACTION") return failure("Draw before opening.");
  if (state.playersPublic[player].opened) return failure("You have already opened.");
  if (groups.length === 0) return failure("Opening requires at least one meld.");
  const proposals = groups.map(normalizeMeldInput);
  const allIds = proposals.flatMap((group) => group.cardIds);
  const handError = uniqueKnownHandCards(state, player, allIds);
  if (handError) return failure(handError);
  if (state.playersPrivate[player].hand.length - allIds.length < 1) {
    return failure("You must keep one card for the required final discard.");
  }
  if (state.lastDrawSource === "DISCARD" && (!state.lastDrawnCardId || !allIds.includes(state.lastDrawnCardId))) {
    return failure("Your opening must use the exact trash card you picked up.");
  }

  const validations = proposals.map((proposal) => GroupValidator.validateMeld(
    proposal.cardIds.map((id) => state.cardsById[id]),
    { kind: proposal.kind, aceMode: proposal.aceMode, fixedJokerMap: proposal.jokerMap },
  ));
  const invalid = validations.find((validation) => !validation.ok);
  if (invalid && !invalid.ok) return failure(invalid.error);
  const valid = validations.filter((validation): validation is Extract<typeof validation, { ok: true }> => validation.ok);
  const points = valid.reduce((sum, validation) => sum + validation.points, 0);
  if (points < 51) return failure(`Opening is worth ${points}; at least 51 points are required.`);

  removeFromHand(state, player, allIds);
  state.playersPublic[player].opened = true;
  addEvent(state, "OPEN", `Player ${player + 1} opened with ${points} points.`, { player });
  valid.forEach((validation) => {
    const meld: Meld = {
      id: newMeldId(state),
      owner: player,
      cardIds: validation.orderedIds,
      kind: validation.kind,
      aceMode: validation.aceMode,
      jokerMap: validation.jokerMap,
    };
    burnOrActivateMeld(state, meld, validation.complete, player);
  });
  return success();
}

function layMeld(state: GameState, player: PlayerID, proposal: MeldProposal): ActionResult {
  const { cardIds } = proposal;
  if (state.phase !== "ACTION") return failure("Draw before creating a meld.");
  if (!state.playersPublic[player].opened) return failure("You must open before playing additional melds.");
  const handError = uniqueKnownHandCards(state, player, cardIds);
  if (handError) return failure(handError);
  if (state.playersPrivate[player].hand.length - cardIds.length < 1) {
    return failure("You must keep one card for the required final discard.");
  }
  const validation = GroupValidator.validateMeld(cardIds.map((id) => state.cardsById[id]), {
    kind: proposal.kind,
    aceMode: proposal.aceMode,
    fixedJokerMap: proposal.jokerMap,
  });
  if (!validation.ok) return failure(validation.error);
  removeFromHand(state, player, cardIds);
  const meld: Meld = {
    id: newMeldId(state),
    owner: player,
    cardIds: validation.orderedIds,
    kind: validation.kind,
    aceMode: validation.aceMode,
    jokerMap: validation.jokerMap,
  };
  addEvent(state, "CREATE_MELD", `Player ${player + 1} created a ${validation.kind.toLowerCase()}.`, { player, id: meld.id });
  burnOrActivateMeld(state, meld, validation.complete, player);
  return success();
}

function addToMeld(state: GameState, player: PlayerID, meldId: string, proposal: MeldProposal): ActionResult {
  const { cardIds } = proposal;
  if (state.phase !== "ACTION") return failure("Draw before extending a meld.");
  if (!state.playersPublic[player].opened) return failure("You must open before extending table melds.");
  const handError = uniqueKnownHandCards(state, player, cardIds);
  if (handError) return failure(handError);
  if (state.playersPrivate[player].hand.length - cardIds.length < 1) {
    return failure("You must keep one card for the required final discard.");
  }
  const meldIndex = state.tableMelds.findIndex((meld) => meld.id === meldId);
  if (meldIndex < 0) return failure("That active meld no longer exists.");
  const meld = state.tableMelds[meldIndex];
  const combinedIds = [...meld.cardIds, ...cardIds];
  const validation = GroupValidator.validateMeld(
    combinedIds.map((id) => state.cardsById[id]),
    {
      kind: meld.kind,
      fixedJokerMap: { ...proposal.jokerMap, ...meld.jokerMap },
    },
  );
  if (!validation.ok) return failure(validation.error);
  removeFromHand(state, player, cardIds);
  const updated: Meld = {
    ...meld,
    cardIds: validation.orderedIds,
    aceMode: validation.aceMode,
    jokerMap: validation.jokerMap,
  };
  state.tableMelds.splice(meldIndex, 1);
  addEvent(state, "EXTEND_MELD", `Player ${player + 1} extended a table meld.`, { player, id: meldId });
  burnOrActivateMeld(state, updated, validation.complete, player);
  return success();
}

function replaceJoker(
  state: GameState,
  player: PlayerID,
  meldId: string,
  jokerId: CardID,
  replacementId: CardID,
): ActionResult {
  if (state.phase !== "ACTION") return failure("Draw before replacing a Joker.");
  if (!state.playersPublic[player].opened) return failure("You must open before replacing a Joker.");
  const meld = state.tableMelds.find((candidate) => candidate.id === meldId);
  if (!meld || !meld.cardIds.includes(jokerId)) return failure("That Joker is not in the selected active meld.");
  const represented = meld.jokerMap[jokerId];
  const replacement = state.cardsById[replacementId];
  if (!represented || !replacement) return failure("The Joker or replacement card is unknown.");
  if (!state.playersPrivate[player].hand.includes(replacementId)) return failure("The replacement card must be in your hand.");
  if (replacement.rank !== represented.rank || replacement.suit !== represented.suit) {
    return failure("The replacement must be the exact card represented by the Joker.");
  }

  const replacementIds = meld.cardIds.map((id) => (id === jokerId ? replacementId : id));
  const validation = GroupValidator.validateMeld(replacementIds.map((id) => state.cardsById[id]), {
    kind: meld.kind,
  });
  if (!validation.ok) return failure(validation.error);
  removeFromHand(state, player, [replacementId]);
  addToHand(state, player, [jokerId]);
  meld.cardIds = validation.orderedIds;
  meld.aceMode = validation.aceMode;
  meld.jokerMap = validation.jokerMap;
  addEvent(state, "REPLACE_JOKER", `Player ${player + 1} replaced and freed a Joker.`, { player, id: meldId });
  return success();
}

function discard(state: GameState, player: PlayerID, cardIds: CardID[]): ActionResult {
  if (state.phase !== "DISCARD") return failure("Finish or pass your action phase before discarding.");
  if (cardIds.length !== 1) return failure("Discard exactly one card.");
  const id = cardIds[0];
  if (state.lastDrawSource === "DISCARD" && state.lastDrawnCardId === id) {
    return failure("You cannot immediately discard the same physical card you took from the trash.");
  }
  if (!removeFromHand(state, player, [id])) return failure("The discarded card must be in your hand.");
  state.discard.push(id);
  addEvent(state, "DISCARD", `Player ${player + 1} discarded a card.`, { player, cardId: id });

  if (state.playersPrivate[player].hand.length === 0) {
    state.winner = player;
    state.phase = "GAME_OVER";
    addEvent(state, "WIN", `Player ${player + 1} won the game.`, { player });
    return success();
  }
  nextTurn(state);
  return success();
}

function applyActionToDraft(state: GameState, action: Action): ActionResult {
  const playerError = ensurePlayer(state, action.player);
  if (playerError) return failure(playerError);

  switch (action.type) {
    case "DRAW_DECK": return drawFromDeck(state, action.player);
    case "DRAW_DISCARD": return drawFromDiscard(state, action.player);
    case "OPEN_GROUP": return openWithGroups(state, action.player, [action.cardIds]);
    case "OPEN_MULTI": return openWithGroups(state, action.player, action.groups);
    case "LAY_MELD": return layMeld(state, action.player, action);
    case "ADD_TO_MELD": return addToMeld(state, action.player, action.meldId, action);
    case "SWAP_JOKER": return replaceJoker(
      state,
      action.player,
      action.meldId,
      action.jokerId,
      action.replaceWithId,
    );
    case "PASS_ACTION":
      if (state.phase !== "ACTION") return failure("There is no action phase to finish.");
      if (!state.playersPublic[action.player].opened && state.lastDrawSource === "DISCARD") {
        return failure("After taking trash while closed, you must open using that card.");
      }
      state.phase = "DISCARD";
      return success();
    case "DISCARD": return discard(state, action.player, action.cardId);
  }
}

/**
 * Applies a requested move atomically. Invalid moves and invariant failures leave
 * the authoritative input state unchanged.
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  const draft = structuredClone(state);
  const result = applyActionToDraft(draft, action);
  if (!result.ok) return result;
  const invariantErrors = validateStateInvariants(draft);
  if (invariantErrors.length > 0) {
    return failure(`Move rejected because it would corrupt game state: ${invariantErrors[0]}`);
  }
  Object.assign(state, draft);
  return success();
}
