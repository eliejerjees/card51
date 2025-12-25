import { applyAction } from "./state";
import type { Action } from "./actions";
import { AceMode, GroupValidator } from "./groupValidator";
import { GameUtils } from "./gameUtils";
import { Card } from "./card";
import type { GameState, PlayerID } from "./types";

function toCard(state: GameState, id: string): Card {
  const dto = state.cardsById[id];
  return new Card(dto.suit, dto.rank);
}

export function botStep(state: GameState, botId: PlayerID): { ok: boolean; error?: string } {
  if (state.currentTurn !== botId) return { ok: false, error: "Not bot turn." };
  if (state.phase === "GAME_OVER") return { ok: false, error: "Game over." };

  // 1) DRAW
  if (state.phase === "DRAW") {
    // simple: always draw deck
    return applyAction(state, { type: "DRAW_DECK", player: botId });
  }

  const handIds = state.playersPrivate[botId].hand;
  const handCards = handIds.map((id) => toCard(state, id));

  // 2) ACTION: try to open if not opened, else try best meld, else pass
  if (state.phase === "ACTION") {
    // inside ACTION phase
    const opened = state.playersPublic[botId].opened;
    const last = state.lastDrawnCardId;

    const melds = GameUtils.findValidMeldsById(handIds, state.cardsById);

    // helper points
    const points = (ids: string[]) =>
      ids.reduce((s, id) => s + toCard(state, id).getValue(), 0);

    if (!opened) {
      if (!last) return applyAction(state, { type: "PASS_ACTION", player: botId });

      const openCandidates = melds
        .filter((m) => m.includes(last))
        .filter((m) => points(m) >= 51);

      if (openCandidates.length === 0) {
        return applyAction(state, { type: "PASS_ACTION", player: botId });
      }

      // pick best (highest points)
      openCandidates.sort((a, b) => points(b) - points(a));
      return applyAction(state, { type: "OPEN_GROUP", player: botId, cardIds: openCandidates[0] });
    } else {
      if (melds.length === 0) return applyAction(state, { type: "PASS_ACTION", player: botId });

      // pick a "best" meld: largest size then highest points
      melds.sort((a, b) => (b.length - a.length) || (points(b) - points(a)));
      return applyAction(state, { type: "LAY_MELD", player: botId, cardIds: melds[0] });
    }

  }

  // 3) DISCARD: discard highest value to move toward empty hand later
  if (state.phase === "DISCARD") {
    let bestIdx = 0;
    let bestVal = -1;
    for (let i = 0; i < handIds.length; i++) {
      const v = toCard(state, handIds[i]).getValue();
      if (v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return applyAction(state, { type: "DISCARD", player: botId, cardId: [handIds[bestIdx]] });
  }

  return { ok: false, error: "No bot move." };
}
