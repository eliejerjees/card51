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
    const opened = state.playersPublic[botId].opened;

    const candidates: Card[][] = [
      ...GameUtils.findSets(handCards),
      ...GameUtils.findRuns(handCards, AceMode.LOW),
      ...GameUtils.findRuns(handCards, AceMode.HIGH),
    ];

    // map candidate Card[] back to ids by matching (suit, rank) is ambiguous with duplicates
    // v1 workaround: choose by indices from hand order (works because we operate on handIds directly)
    // Better approach later: carry ids in parallel when generating groups.
    // For v1 bot, just PASS unless you implement id-aware group generation.
    if (!opened) {
      // open requires lastDrawn included and 51+
      // v1: skip opening to keep bot simple
      return applyAction(state, { type: "PASS_ACTION", player: botId });
    } else {
      return applyAction(state, { type: "PASS_ACTION", player: botId });
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
