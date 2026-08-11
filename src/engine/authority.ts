import type { Action } from "./actions";
import { createPlayerView, type PlayerGameView } from "./playerView";
import { applyAction, initGame, type ActionResult } from "./state";
import type { GameState, PlayerID } from "./types";

type WithoutPlayer<T> = T extends { player: PlayerID } ? Omit<T, "player"> : never;
export type PlayerActionRequest = WithoutPlayer<Action>;

export type DispatchResult = {
  result: ActionResult;
  view: PlayerGameView;
};

/**
 * Server-facing boundary for a Card51 match. The caller supplies the authenticated
 * player identity; client payloads cannot choose which player they act as.
 */
export class AuthoritativeGame {
  readonly #state: GameState;
  #turnDraft: { player: PlayerID; state: GameState } | null = null;

  public constructor(
    numPlayers: number,
    options: { random?: () => number; turnTimeLimitMs?: number | null } = {},
  ) {
    this.#state = initGame(numPlayers, options);
  }

  public dispatch(player: PlayerID, request: PlayerActionRequest): DispatchResult {
    if (!this.#state.playersPrivate[player]) {
      throw new Error("Unknown authenticated player.");
    }
    const action = { ...request, player } as Action;
    const target = this.#turnDraft?.player === player ? this.#turnDraft.state : this.#state;
    const result = applyAction(target, action);
    if (result.ok && (action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD")) {
      this.#turnDraft = { player, state: structuredClone(this.#state) };
    } else if (result.ok && action.type === "DISCARD" && this.#turnDraft?.player === player) {
      Object.assign(this.#state, this.#turnDraft.state);
      this.#turnDraft = null;
    }
    return { result, view: this.viewFor(player) };
  }

  public viewFor(player: PlayerID): PlayerGameView {
    const visibleState = this.#turnDraft?.player === player ? this.#turnDraft.state : this.#state;
    return createPlayerView(visibleState, player);
  }

  /** Discards every proposed table action while preserving the already-committed draw. */
  public resetTurnActions(player: PlayerID): PlayerGameView {
    if (!this.#turnDraft || this.#turnDraft.player !== player) {
      throw new Error("This player has no active turn proposal to reset.");
    }
    this.#turnDraft.state = structuredClone(this.#state);
    return this.viewFor(player);
  }
}
