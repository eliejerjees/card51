import type { Action } from "./actions";
import { createPlayerView, type PlayerGameView } from "./playerView";
import { calculateRoundPenalties } from "./scoring";
import { applyAction, initGame, type ActionResult } from "./state";
import type { GameEventType, GameState, PlayerID } from "./types";

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
  #turnStartBaseline: { player: PlayerID; state: GameState } | null = null;

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
    const turnStart = action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD" ? structuredClone(target) : null;
    const result = applyAction(target, action);
    if (result.ok && (action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD")) {
      this.#turnStartBaseline = { player, state: turnStart! };
      this.#turnDraft = { player, state: structuredClone(this.#state) };
    } else if (result.ok && action.type === "DISCARD" && this.#turnDraft?.player === player) {
      Object.assign(this.#state, this.#turnDraft.state);
      this.#turnDraft = null;
      this.#turnStartBaseline = null;
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

  /** Cancels an unfinished turn and performs a non-strategic stock draw/pass/discard. */
  public completeTimedOutTurn(player: PlayerID, message: string): PlayerGameView {
    if (this.viewFor(player).currentTurn !== player) throw new Error("It is not this player's turn.");
    if (this.#turnStartBaseline?.player === player) Object.assign(this.#state, structuredClone(this.#turnStartBaseline.state));
    this.#turnDraft = null;
    this.#turnStartBaseline = null;
    this.#state.events.push({ id: `event-${this.#state.events.length + 1}`, type: "TIMEOUT", message, player });

    const draw = this.dispatch(player, { type: "DRAW_DECK" });
    if (!draw.result.ok) throw new Error(`Timed-out draw failed: ${draw.result.error}`);
    const drawnId = draw.view.lastDrawnCardId;
    if (!drawnId) throw new Error("Timed-out draw did not return a card.");
    const pass = this.dispatch(player, { type: "PASS_ACTION" });
    if (!pass.result.ok) throw new Error(`Timed-out pass failed: ${pass.result.error}`);
    const discard = this.dispatch(player, { type: "DISCARD", cardId: [drawnId] });
    if (!discard.result.ok) throw new Error(`Timed-out discard failed: ${discard.result.error}`);
    return this.viewFor(player);
  }

  /** Ends a round when every competing human except one has left or been replaced. */
  public completeByForfeit(winner: PlayerID, message: string): PlayerGameView {
    if (!this.#state.playersPrivate[winner]) throw new Error("Unknown winning player.");
    if (this.#state.phase === "GAME_OVER") return this.viewFor(winner);
    this.#turnDraft = null;
    this.#turnStartBaseline = null;
    this.#state.winner = winner;
    this.#state.phase = "GAME_OVER";
    this.#state.events.push({ id: `event-${this.#state.events.length + 1}`, type: "WIN", message, player: winner });
    return this.viewFor(winner);
  }

  public noteEvent(type: GameEventType, message: string, player?: PlayerID): void {
    const event = { id: `event-${this.#state.events.length + 1}`, type, message, player };
    this.#state.events.push(event);
    if (this.#turnDraft) this.#turnDraft.state.events.push(structuredClone(event));
  }

  /** Returns end-of-round penalty points without exposing any player's hand. */
  public roundPenalties(): Record<PlayerID, number> {
    return calculateRoundPenalties(this.#state);
  }
}
