import type { Action } from "./actions";
import { cardPointValue } from "./card";
import { GameUtils } from "./gameUtils";
import { GroupValidator } from "./groupValidator";
import { canTakeDiscardForOpening, findOpeningPlan } from "./opening";
import { createPlayerView, type PlayerGameView } from "./playerView";
import { applyAction, type ActionResult } from "./state";
import type { CardID, GameState, PlayerID } from "./types";

/** Delay between visible bot actions in every game mode. */
export const BOT_ACTION_DELAY_MS = 900;

function usefulOpenDiscard(view: PlayerGameView, discardId: CardID): boolean {
  const hypothetical = [...view.ownHand, discardId];
  if (GameUtils.findValidMeldsById(hypothetical, view.cardsById).some((meld) => meld.includes(discardId))) return true;
  return view.tableMelds.some((meld) => {
    const validation = GroupValidator.validateMeld(
      [...meld.cardIds, discardId].map((id) => view.cardsById[id]),
      { kind: meld.kind, fixedJokerMap: meld.jokerMap },
    );
    return validation.ok;
  });
}

function chooseJokerReplacement(view: PlayerGameView): Action | null {
  for (const meld of view.tableMelds) {
    for (const [jokerId, represented] of Object.entries(meld.jokerMap)) {
      const replacementId = view.ownHand.find((id) => {
        const card = view.cardsById[id];
        return card.rank === represented.rank && card.suit === represented.suit;
      });
      if (replacementId) {
        return {
          type: "SWAP_JOKER",
          player: view.viewer,
          meldId: meld.id,
          jokerId,
          replaceWithId: replacementId,
        };
      }
    }
  }
  return null;
}

function chooseMeldExtension(view: PlayerGameView): Action | null {
  if (view.ownHand.length <= 1) return null;
  for (const meld of view.tableMelds) {
    for (const cardId of view.ownHand) {
      const validation = GroupValidator.validateMeld(
        [...meld.cardIds, cardId].map((id) => view.cardsById[id]),
        { kind: meld.kind, fixedJokerMap: meld.jokerMap },
      );
      if (validation.ok) {
        return { type: "ADD_TO_MELD", player: view.viewer, meldId: meld.id, cardIds: [cardId] };
      }
    }
  }
  return null;
}

/** Chooses a move using only information visible to this bot player. */
export function chooseBotAction(view: PlayerGameView): Action | null {
  if (view.phase === "GAME_OVER" || view.currentTurn !== view.viewer) return null;
  const player = view.viewer;

  if (view.phase === "DRAW") {
    const discardId = view.topDiscardId;
    if (discardId) {
      const opened = view.playersPublic[player].opened;
      const shouldTake = opened
        ? usefulOpenDiscard(view, discardId)
        : canTakeDiscardForOpening(view.ownHand, discardId, view.cardsById);
      if (shouldTake) return { type: "DRAW_DISCARD", player };
    }
    return { type: "DRAW_DECK", player };
  }

  if (view.phase === "ACTION") {
    if (!view.playersPublic[player].opened) {
      const required = view.lastDrawSource === "DISCARD" ? view.lastDrawnCardId ?? undefined : undefined;
      const plan = findOpeningPlan(view.ownHand, view.cardsById, required);
      if (plan) return { type: "OPEN_MULTI", player, groups: plan.map((group) => ({
        cardIds: group.cardIds,
        kind: group.validation.kind,
        aceMode: group.validation.aceMode,
        jokerMap: group.validation.jokerMap,
      })) };
      return { type: "PASS_ACTION", player };
    }

    const replacement = chooseJokerReplacement(view);
    if (replacement) return replacement;
    const extension = chooseMeldExtension(view);
    if (extension) return extension;
    const meld = GameUtils.findValidMeldsById(view.ownHand, view.cardsById)
      .filter((candidate) => view.ownHand.length - candidate.length >= 1)
      .sort((a, b) => b.length - a.length)[0];
    if (meld) return { type: "LAY_MELD", player, cardIds: meld };
    return { type: "PASS_ACTION", player };
  }

  const legalDiscards = view.ownHand.filter(
    (id) => !(view.lastDrawSource === "DISCARD" && view.lastDrawnCardId === id),
  );
  const discardId = legalDiscards.sort(
    (a, b) => cardPointValue(view.cardsById[b].rank) - cardPointValue(view.cardsById[a].rank),
  )[0];
  return discardId ? { type: "DISCARD", player, cardId: [discardId] } : null;
}

export function botStep(state: GameState, botId: PlayerID): ActionResult {
  if (state.currentTurn !== botId) return { ok: false, error: "It is not this bot's turn." };
  const action = chooseBotAction(createPlayerView(state, botId));
  if (!action) return { ok: false, error: "The bot has no legal move." };
  return applyAction(state, action);
}
