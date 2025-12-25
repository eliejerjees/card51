// src/engine/gameUtils.ts
import type { CardDTO, CardID } from "./types";
import { GroupValidator } from "./groupValidator";

export class GameUtils {
  public static findValidMeldsById(
    handIds: ReadonlyArray<CardID>,
    cardsById: Record<CardID, CardDTO>
  ): CardID[][] {
    const out: CardID[][] = [];
    for (let size = 3; size <= handIds.length; size++) {
      this.combine(handIds, size, 0, [], out, cardsById);
    }
    return out;
  }

  private static combine(
    handIds: ReadonlyArray<CardID>,
    size: number,
    start: number,
    temp: CardID[],
    out: CardID[][],
    cardsById: Record<CardID, CardDTO>
  ): void {
    if (temp.length === size) {
      const dtos = temp.map((id) => cardsById[id]);
      const res = GroupValidator.validateMeld(dtos);
      if (res.ok) out.push([...temp]);
      return;
    }

    for (let i = start; i < handIds.length; i++) {
      temp.push(handIds[i]);
      this.combine(handIds, size, i + 1, temp, out, cardsById);
      temp.pop();
    }
  }
}