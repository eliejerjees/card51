import { makeShuffledDeck } from "./deckFactory";
import { AceMode, GroupValidator } from "./groupValidator";
import { GameUtils } from "./gameUtils";
import type { Action } from "./actions";
import type { CardDTO, CardID, GameState, PlayerID } from "./types";
import { Card, Rank, Suit } from "./card";

function toCardClass(dto: CardDTO): Card {
  return new Card(dto.suit, dto.rank);
}

function groupPoints(ids: CardID[], cardsById: Record<CardID, CardDTO>): number {
  return ids.reduce((s, id) => s + toCardClass(cardsById[id]).getValue(), 0);
}

function ensurePlayer(state: GameState, player: PlayerID): string | null {
  if (player !== state.currentTurn) return "Not your turn.";
  if (state.phase === "GAME_OVER") return "Game is over.";
  return null;
}

function removeFromHand(state: GameState, player: PlayerID, cardIds: CardID[]): boolean {
  const hand = state.playersPrivate[player].hand;
  for (const id of cardIds) {
    const idx = hand.indexOf(id);
    if (idx < 0) return false;
  }
  for (const id of cardIds) {
    const idx = hand.indexOf(id);
    hand.splice(idx, 1);
  }
  state.playersPublic[player].handCount = hand.length;
  return true;
}

function nextTurn(state: GameState): void {
  const next = ((state.currentTurn + 1) % state.numPlayers) as PlayerID;
  state.currentTurn = next;
  state.phase = "DRAW";
  state.lastDrawnCardId = null;
}

export function initGame(numPlayers: 2 | 3 | 4): GameState {
  const deck = makeShuffledDeck();
  const cardsById: Record<string, CardDTO> = {};
  for (const c of deck) cardsById[c.id] = c;

  const state: GameState = {
    numPlayers,
    currentTurn: 0,
    phase: "DRAW",
    winner: null,
    deckCount: deck.length,
    discard: [],
    lastDrawnCardId: null,
    cardsById,
    playersPublic: {
      0: { id: 0, opened: false, handCount: 0 },
      1: { id: 1, opened: false, handCount: 0 },
      2: { id: 2, opened: false, handCount: 0 },
      3: { id: 3, opened: false, handCount: 0 },
    },
    playersPrivate: {
      0: { hand: [] },
      1: { hand: [] },
      2: { hand: [] },
      3: { hand: [] },
    },
    tableMelds: [],
  };

  // Deal 14 each from top of deck array
  let idx = 0;
  for (let p = 0 as PlayerID; p < numPlayers; p = (p + 1) as PlayerID) {
    const hand = deck.slice(idx, idx + 14).map((c) => c.id);
    idx += 14;
    state.playersPrivate[p].hand = hand;
    state.playersPublic[p].handCount = hand.length;
  }

  // Remaining become deckCount (we do not need the actual draw pile array yet for bots v1)
  state.deckCount = deck.length - idx;

  // Store the remaining draw pile order locally for bots mode in a hidden field (simple v1)
  (state as any).__drawOrder = deck.slice(idx).map((c) => c.id);

  return state;
}

export function applyAction(state: GameState, action: Action): { ok: boolean; error?: string } {
  const err = ensurePlayer(state, action.player);
  if (err) return { ok: false, error: err };

  const drawOrder: CardID[] = (state as any).__drawOrder;

  if (action.type === "DRAW_DECK") {
    if (state.phase !== "DRAW") return { ok: false, error: "Not in DRAW phase." };
    const id = drawOrder.pop();
    if (!id) return { ok: false, error: "Deck empty." };
    state.deckCount -= 1;
    state.playersPrivate[action.player].hand.push(id);
    state.playersPublic[action.player].handCount += 1;
    state.lastDrawnCardId = id;
    state.phase = "ACTION";
    return { ok: true };
  }

  if (action.type === "DRAW_DISCARD") {
    if (state.phase !== "DRAW") return { ok: false, error: "Not in DRAW phase." };
    if (!state.playersPublic[action.player].opened) {
      // matches your Java behavior: draw from deck if not opened
      return applyAction(state, { type: "DRAW_DECK", player: action.player });
    }
    const id = state.discard.pop();
    if (!id) {
      return applyAction(state, { type: "DRAW_DECK", player: action.player });
    }
    state.playersPrivate[action.player].hand.push(id);
    state.playersPublic[action.player].handCount += 1;
    state.lastDrawnCardId = id;
    state.phase = "ACTION";
    return { ok: true };
  }

  if (action.type === "OPEN_GROUP") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (state.playersPublic[action.player].opened) return { ok: false, error: "Already opened." };
    if (!state.lastDrawnCardId) return { ok: false, error: "No drawn card recorded." };
    if (!action.cardIds.includes(state.lastDrawnCardId))
      return { ok: false, error: "Opening group must include the drawn card." };

    const pts = groupPoints(action.cardIds, state.cardsById);
    if (pts < 51) return { ok: false, error: "Need 51+ points to open." };

    // Must keep 1 card to discard
    const handLen = state.playersPrivate[action.player].hand.length;
    if (handLen - action.cardIds.length < 1) return { ok: false, error: "Must keep one to discard." };

    // Validate set or run using your existing validator
    const cards = action.cardIds.map((id) => toCardClass(state.cardsById[id]));
    const isSet = GroupValidator.isValidSet(cards);
    const isRun = GroupValidator.isValidRun(cards, AceMode.LOW) || GroupValidator.isValidRun(cards, AceMode.HIGH);
    if (!isSet && !isRun) return { ok: false, error: "Not a valid meld." };

    if (!removeFromHand(state, action.player, action.cardIds)) return { ok: false, error: "Card not in hand." };

    state.tableMelds.push({ id: "m_" + Date.now().toString(36), owner: action.player, cardIds: [...action.cardIds] });
    state.playersPublic[action.player].opened = true;
    // After opening, you still must discard
    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "LAY_MELD") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (!state.playersPublic[action.player].opened) return { ok: false, error: "Must open first." };

    const handLen = state.playersPrivate[action.player].hand.length;
    if (handLen - action.cardIds.length < 1) return { ok: false, error: "Must keep one to discard." };

    const cards = action.cardIds.map((id) => toCardClass(state.cardsById[id]));
    const isSet = GroupValidator.isValidSet(cards);
    const isRun = GroupValidator.isValidRun(cards, AceMode.LOW) || GroupValidator.isValidRun(cards, AceMode.HIGH);
    if (!isSet && !isRun) return { ok: false, error: "Not a valid meld." };

    if (!removeFromHand(state, action.player, action.cardIds)) return { ok: false, error: "Card not in hand." };

    state.tableMelds.push({ id: "m_" + Date.now().toString(36), owner: action.player, cardIds: [...action.cardIds] });
    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "PASS_ACTION") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "DISCARD") {
    if (state.phase !== "DISCARD") return { ok: false, error: "Not in DISCARD phase." };
    if (action.cardId.length !== 1) return { ok: false, error: "Discard exactly one card." };
    const id = action.cardId[0];

    if (!removeFromHand(state, action.player, [id])) return { ok: false, error: "Card not in hand." };
    state.discard.push(id);

    if (state.playersPrivate[action.player].hand.length === 0) {
      state.winner = action.player;
      state.phase = "GAME_OVER";
      return { ok: true };
    }

    nextTurn(state);
    return { ok: true };
  }

  return { ok: false, error: "Unknown action." };
}
