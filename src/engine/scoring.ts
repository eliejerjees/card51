import { Rank, cardPointValue } from "./card";
import type { GameState, PlayerID } from "./types";

/** Card-value match penalties: winner 0, unopened hands 100, Jokers 20. */
export function calculateRoundPenalties(state: GameState): Record<PlayerID, number> {
  if (state.phase !== "GAME_OVER" || state.winner === null) throw new Error("Round scores are only available after the game ends.");
  return Object.fromEntries(Object.entries(state.playersPrivate).map(([playerKey, player]) => {
    const playerId = Number(playerKey);
    if (playerId === state.winner) return [playerId, 0];
    if (!state.playersPublic[playerId].opened) return [playerId, 100];
    return [playerId, player.hand.reduce((sum, id) => {
      const rank = state.cardsById[id].rank;
      return sum + (rank === Rank.JOKER ? 20 : cardPointValue(rank));
    }, 0)];
  }));
}
