// src/engine/gameUtils.ts
//
// Direct port of your Java combinator search.
// NOTE: This is exponential (same as your Java). Fine for small hands,
// but you may want a smarter generator later.

import { Card } from "./card";
import { GroupValidator, AceMode } from "./groupValidator";

export class GameUtils {
  /** Find all valid sets (size 3 and 4). */
  public static findSets(hand: ReadonlyArray<Card>): Card[][] {
    const sets: Card[][] = [];
    this.combine(hand, 3, 0, [], sets, true, undefined);
    this.combine(hand, 4, 0, [], sets, true, undefined);
    return sets;
  }

  /** Find all valid runs (size 3..hand.length) under the given AceMode. */
  public static findRuns(hand: ReadonlyArray<Card>, mode: AceMode): Card[][] {
    const runs: Card[][] = [];
    for (let size = 3; size <= hand.length; size++) {
      this.combine(hand, size, 0, [], runs, false, mode);
    }
    return runs;
  }

  private static combine(
    hand: ReadonlyArray<Card>,
    size: number,
    start: number,
    temp: Card[],
    out: Card[][],
    setMode: boolean,
    mode: AceMode | undefined
  ): void {
    if (temp.length === size) {
      if (setMode) {
        if (GroupValidator.isValidSet(temp)) out.push([...temp]);
      } else {
        if (!mode) throw new Error("AceMode must be provided for run validation.");
        if (GroupValidator.isValidRun(temp, mode)) out.push([...temp]);
      }
      return;
    }

    for (let i = start; i < hand.length; i++) {
      temp.push(hand[i]);
      this.combine(hand, size, i + 1, temp, out, setMode, mode);
      temp.pop();
    }
  }
}
