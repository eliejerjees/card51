import { makeShuffledDeck } from "./deckFactory";
import { GroupValidator } from "./groupValidator";
import type { Action } from "./actions";
import type { CardDTO, CardID, GameState, PlayerID } from "./types";
import { Card } from "./card";

function toCardClass(dto: CardDTO): Card {
  return new Card(dto.suit, dto.rank);
}

function dtoByIds(state: GameState, ids: CardID[]): CardDTO[] {
  return ids.map((id) => state.cardsById[id]);
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

  // verify all exist
  for (const id of cardIds) {
    if (!hand.includes(id)) return false;
  }

  // remove each
  for (const id of cardIds) {
    const idx = hand.indexOf(id);
    hand.splice(idx, 1);
  }

  state.playersPublic[player].handCount = hand.length;
  return true;
}

function addBackToHand(state: GameState, player: PlayerID, cardIds: CardID[]): void {
  state.playersPrivate[player].hand.push(...cardIds);
  state.playersPublic[player].handCount = state.playersPrivate[player].hand.length;
}

function nextTurn(state: GameState): void {
  const next = ((state.currentTurn + 1) % state.numPlayers) as PlayerID;
  state.currentTurn = next;
  state.phase = "DRAW";
  state.lastDrawnCardId = null;
  state.lastDrawSource = null;
}

function newMeldId(): string {
  return "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
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
    lastDrawSource: null,
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

  // Deal 14 each
  let idx = 0;
  for (let p = 0 as PlayerID; p < numPlayers; p = (p + 1) as PlayerID) {
    const hand = deck.slice(idx, idx + 14).map((c) => c.id);
    idx += 14;
    state.playersPrivate[p].hand = hand;
    state.playersPublic[p].handCount = hand.length;
  }

  // Remaining become draw order. We pop from end as "top".
  (state as any).__drawOrder = deck.slice(idx).map((c) => c.id);
  state.deckCount = (state as any).__drawOrder.length;

  return state;
}

export function applyAction(state: GameState, action: Action): { ok: boolean; error?: string } {
  const err = ensurePlayer(state, action.player);
  if (err) return { ok: false, error: err };

  const drawOrder: CardID[] = (state as any).__drawOrder ?? [];

  if (action.type === "DRAW_DECK") {
    if (state.phase !== "DRAW") return { ok: false, error: "Not in DRAW phase." };
    const id = drawOrder.pop();
    if (!id) return { ok: false, error: "Deck empty." };

    state.deckCount = drawOrder.length;
    state.playersPrivate[action.player].hand.push(id);
    state.playersPublic[action.player].handCount += 1;

    state.lastDrawnCardId = id;
    state.lastDrawSource = "DECK";
    state.phase = "ACTION";
    return { ok: true };
  }

  if (action.type === "DRAW_DISCARD") {
    if (state.phase !== "DRAW") return { ok: false, error: "Not in DRAW phase." };

    // Your current rule: can only draw discard if already opened (you said you may change later)
    if (!state.playersPublic[action.player].opened) {
      return applyAction(state, { type: "DRAW_DECK", player: action.player });
    }

    const id = state.discard.pop();
    if (!id) {
      return applyAction(state, { type: "DRAW_DECK", player: action.player });
    }

    state.playersPrivate[action.player].hand.push(id);
    state.playersPublic[action.player].handCount += 1;

    state.lastDrawnCardId = id;
    state.lastDrawSource = "DISCARD";
    state.phase = "ACTION";
    return { ok: true };
  }

  if (action.type === "OPEN_MULTI") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (state.playersPublic[action.player].opened) return { ok: false, error: "Already opened." };
    if (action.groups.length < 1) return { ok: false, error: "Must open with at least one meld." };

    const flat: CardID[] = action.groups.flat();
    const unique = new Set(flat);
    if (unique.size !== flat.length) return { ok: false, error: "Duplicate card in groups." };

    // Discard-drawn rule: only require inclusion if last draw was from discard
    if (state.lastDrawSource === "DISCARD") {
      if (!state.lastDrawnCardId) return { ok: false, error: "No drawn card recorded." };
      if (!unique.has(state.lastDrawnCardId)) {
        return { ok: false, error: "Opening must include the discard-drawn card." };
      }
    }

    const handLen = state.playersPrivate[action.player].hand.length;
    if (handLen - flat.length < 1) return { ok: false, error: "Must keep one to discard." };

    // ensure in hand
    for (const id of flat) {
      if (!state.playersPrivate[action.player].hand.includes(id)) {
        return { ok: false, error: "Card not in hand." };
      }
    }

    // total points >= 51
    const totalPts = groupPoints(flat, state.cardsById);
    if (totalPts < 51) return { ok: false, error: "Need 51+ points to open." };

    // validate each group and collect validations (so we don't validate twice)
    const validations = action.groups.map((g) => {
      if (g.length < 3) return { ok: false as const, error: "Each group must have 3+ cards." };
      return GroupValidator.validateMeld(dtoByIds(state, g));
    });

    for (const v of validations) {
      if (!v.ok) return { ok: false, error: v.error };
    }

    // remove all cards
    if (!removeFromHand(state, action.player, flat)) return { ok: false, error: "Card not in hand." };

    // add melds using validator outputs (orderedIds + kind + aceMode + jokerMap)
    for (let i = 0; i < action.groups.length; i++) {
      const v = validations[i];
      if (!v.ok) continue; // impossible due to earlier check

      state.tableMelds.push({
        id: newMeldId(),
        owner: action.player,
        cardIds: v.orderedIds,
        kind: v.kind,
        aceMode: v.aceMode,
        jokerMap: v.jokerMap,
      });
    }

    state.playersPublic[action.player].opened = true;
    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "OPEN_GROUP") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (state.playersPublic[action.player].opened) return { ok: false, error: "Already opened." };

    // Only require inclusion if drawn from discard
    if (state.lastDrawSource === "DISCARD") {
      if (!state.lastDrawnCardId) return { ok: false, error: "No drawn card recorded." };
      if (!action.cardIds.includes(state.lastDrawnCardId)) {
        return { ok: false, error: "Opening group must include the discard-drawn card." };
      }
    }

    const pts = groupPoints(action.cardIds, state.cardsById);
    if (pts < 51) return { ok: false, error: "Need 51+ points to open." };

    const handLen = state.playersPrivate[action.player].hand.length;
    if (handLen - action.cardIds.length < 1) return { ok: false, error: "Must keep one to discard." };

    const validation = GroupValidator.validateMeld(dtoByIds(state, action.cardIds));
    if (!validation.ok) return { ok: false, error: validation.error };

    if (!removeFromHand(state, action.player, action.cardIds)) return { ok: false, error: "Card not in hand." };

    state.tableMelds.push({
      id: newMeldId(),
      owner: action.player,
      cardIds: validation.orderedIds,
      kind: validation.kind,
      aceMode: validation.aceMode,
      jokerMap: validation.jokerMap,
    });

    state.playersPublic[action.player].opened = true;
    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "LAY_MELD") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (!state.playersPublic[action.player].opened) return { ok: false, error: "Must open first." };

    const handLen = state.playersPrivate[action.player].hand.length;
    if (handLen - action.cardIds.length < 1) return { ok: false, error: "Must keep one to discard." };

    const validation = GroupValidator.validateMeld(dtoByIds(state, action.cardIds));
    if (!validation.ok) return { ok: false, error: validation.error };

    if (!removeFromHand(state, action.player, action.cardIds)) return { ok: false, error: "Card not in hand." };

    state.tableMelds.push({
      id: newMeldId(),
      owner: action.player,
      cardIds: validation.orderedIds,
      kind: validation.kind,
      aceMode: validation.aceMode,
      jokerMap: validation.jokerMap,
    });

    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "ADD_TO_MELD") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (!state.playersPublic[action.player].opened) return { ok: false, error: "Must open first." };

    const meld = state.tableMelds.find((m) => m.id === action.meldId);
    if (!meld) return { ok: false, error: "Meld not found." };

    const handLen = state.playersPrivate[action.player].hand.length;
    if (handLen - action.cardIds.length < 1) return { ok: false, error: "Must keep one to discard." };

    // remove from hand first
    if (!removeFromHand(state, action.player, action.cardIds)) return { ok: false, error: "Card not in hand." };

    const combinedIds = [...meld.cardIds, ...action.cardIds];
    const validation = GroupValidator.validateMeld(dtoByIds(state, combinedIds));

    if (!validation.ok) {
      // rollback
      addBackToHand(state, action.player, action.cardIds);
      return { ok: false, error: validation.error };
    }

    meld.cardIds = validation.orderedIds;
    meld.kind = validation.kind;
    meld.aceMode = validation.aceMode;
    meld.jokerMap = validation.jokerMap;

    state.phase = "DISCARD";
    return { ok: true };
  }

  if (action.type === "SWAP_JOKER") {
    if (state.phase !== "ACTION") return { ok: false, error: "Not in ACTION phase." };
    if (!state.playersPublic[action.player].opened) return { ok: false, error: "Must open first." };

    const meld = state.tableMelds.find((m) => m.id === action.meldId);
    if (!meld) return { ok: false, error: "Meld not found." };
    if (!meld.cardIds.includes(action.jokerId)) return { ok: false, error: "Joker not in meld." };

    const rep = meld.jokerMap[action.jokerId];
    if (!rep) return { ok: false, error: "This joker has no stored substitution." };

    const replaceDto = state.cardsById[action.replaceWithId];
    if (!replaceDto) return { ok: false, error: "Replacement card not found." };

    if (replaceDto.rank !== rep.rank || replaceDto.suit !== rep.suit) {
      return { ok: false, error: "Replacement card does not match joker substitution." };
    }

    // remove replacement from hand
    if (!removeFromHand(state, action.player, [action.replaceWithId])) {
      return { ok: false, error: "Replacement card not in hand." };
    }

    // swap
    meld.cardIds = meld.cardIds.map((id) => (id === action.jokerId ? action.replaceWithId : id));

    // give joker to player
    state.playersPrivate[action.player].hand.push(action.jokerId);
    state.playersPublic[action.player].handCount = state.playersPrivate[action.player].hand.length;

    // revalidate
    const validation = GroupValidator.validateMeld(dtoByIds(state, meld.cardIds));
    if (!validation.ok) {
      // rollback
      const h = state.playersPrivate[action.player].hand;
      const jIdx = h.indexOf(action.jokerId);
      if (jIdx >= 0) h.splice(jIdx, 1);
      h.push(action.replaceWithId);
      state.playersPublic[action.player].handCount = h.length;

      meld.cardIds = meld.cardIds.map((id) => (id === action.replaceWithId ? action.jokerId : id));
      return { ok: false, error: validation.error };
    }

    meld.cardIds = validation.orderedIds;
    meld.kind = validation.kind;
    meld.aceMode = validation.aceMode;
    meld.jokerMap = validation.jokerMap;

    // stay in ACTION
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
