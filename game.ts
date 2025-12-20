// src/engine/game.ts
//
// This is a direct TypeScript port of your Java Game loop,
// but with ONE critical change: no Scanner/console input.
// Instead, the Game asks a "DecisionProvider" for choices.
// Your web UI will implement DecisionProvider later.

import { Deck } from "./deck";
import { Card } from "./card";
import { Player } from "./player";
import { GroupValidator, AceMode } from "./groupValidator";
import { GameUtils } from "./gameUtils";

export interface DecisionProvider {
  /** Return 1 for Deck, 2 for Discard. */
  chooseDrawSource(ctx: { playerIndex: number; canDrawDiscard: boolean; discardTop?: Card }): 1 | 2;

  /**
   * Return index (0-based) into openables, or null to skip opening.
   * UI should present groups and points to the user.
   */
  chooseOpenGroup(
    ctx: { playerIndex: number; drawn: Card },
    openables: ReadonlyArray<ReadonlyArray<Card>>,
    points: ReadonlyArray<number>
  ): number | null;

  /** After opening, decide whether to lay a new meld. */
  chooseLayNewMeld(ctx: { playerIndex: number }): boolean;

  /**
   * Choose a meld from all candidates (0-based), or null to skip.
   * Only called if chooseLayNewMeld returned true.
   */
  choosePostOpenMeld(
    ctx: { playerIndex: number },
    candidates: ReadonlyArray<ReadonlyArray<Card>>,
    points: ReadonlyArray<number>
  ): number | null;

  /** Choose a discard card index (0-based) from current hand. */
  chooseDiscardIndex(ctx: { playerIndex: number }, hand: ReadonlyArray<Card>): number;
}

export class Game {
  private deck: Deck = new Deck();
  private players: Player[] = [];
  private turn: number = 0;

  constructor(numPlayers: number) {
    for (let i = 0; i < numPlayers; i++) this.players.push(new Player());
    this.deal();
  }

  private deal(): void {
    for (const p of this.players) {
      for (let j = 0; j < 14; j++) p.addCard(this.deck.draw());
    }
  }

  /**
   * Runs until someone wins.
   * The UI supplies choices through DecisionProvider.
   *
   * Returns the winning player index (0-based).
   */
  public run(decider: DecisionProvider): number {
    while (true) {
      const p = this.players[this.turn];

      // DRAW PHASE
      const canDrawDiscard = p.hasOpened() && !this.deck.isDiscardEmpty();
      const drawChoice = decider.chooseDrawSource({
        playerIndex: this.turn,
        canDrawDiscard,
        discardTop: this.deck.peekDiscard(),
      });

      let drawn: Card;

      if (drawChoice === 2 && canDrawDiscard) {
        drawn = this.deck.pullDiscard();
      } else {
        drawn = this.deck.draw();
        // In Java you printed a message when they tried discard but couldn't.
        // UI can show that based on canDrawDiscard.
      }

      p.addCard(drawn);

      // OPENING LOGIC (must include the drawn card, and group points >= 51)
      if (!p.hasOpened()) {
        const candidates: Card[][] = [
          ...GameUtils.findSets(p.getHand()),
          ...GameUtils.findRuns(p.getHand(), AceMode.LOW),
          ...GameUtils.findRuns(p.getHand(), AceMode.HIGH),
        ];

        const openables: Card[][] = [];
        const pts: number[] = [];

        for (const g of candidates) {
          if (g.includes(drawn)) {
            const gp = GroupValidator.getGroupPoints(g);
            if (gp >= 51) {
              openables.push(g);
              pts.push(gp);
            }
          }
        }

        if (openables.length > 0) {
          const sel = decider.chooseOpenGroup({ playerIndex: this.turn, drawn }, openables, pts);

          if (sel !== null && sel >= 0 && sel < openables.length) {
            const chosen = openables[sel];

            // must keep at least one card to discard
            if (p.getHand().length - chosen.length < 1) {
              // opening cancelled (UI can display)
            } else {
              for (const c of chosen) p.removeCard(c);
              p.addGroup(chosen);
              p.open();
            }
          }
        }
      } else {
        // POST-OPEN: additional melds
        const wantsMeld = decider.chooseLayNewMeld({ playerIndex: this.turn });

        if (wantsMeld) {
          const all: Card[][] = [
            ...GameUtils.findSets(p.getHand()),
            ...GameUtils.findRuns(p.getHand(), AceMode.LOW),
            ...GameUtils.findRuns(p.getHand(), AceMode.HIGH),
          ];

          const pts = all.map((g) => GroupValidator.getGroupPoints(g));
          const sel = decider.choosePostOpenMeld({ playerIndex: this.turn }, all, pts);

          if (sel !== null && sel >= 0 && sel < all.length) {
            const chosen = all[sel];
            if (p.getHand().length - chosen.length < 1) {
              // must leave one to discard (UI can display)
            } else {
              for (const c of chosen) p.removeCard(c);
              p.addGroup(chosen);
            }
          }
        }
      }

      // DISCARD PHASE
      const hand = p.getHand();
      const discardIndex = decider.chooseDiscardIndex({ playerIndex: this.turn }, hand);

      if (discardIndex < 0 || discardIndex >= hand.length) {
        throw new Error(`Invalid discard index ${discardIndex} for hand size ${hand.length}.`);
      }

      const disc = hand[discardIndex];
      p.removeCard(disc);
      this.deck.discard(disc);

      // WIN CHECK
      if (p.getHand().length === 0) {
        return this.turn;
      }

      this.turn = (this.turn + 1) % this.players.length;
    }
  }

  // Useful for UI
  public getPlayers(): ReadonlyArray<Player> {
    return this.players;
  }

  public getCurrentPlayerIndex(): number {
    return this.turn;
  }

  public getDeck(): Deck {
    return this.deck;
  }
}
