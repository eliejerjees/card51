import { findMeldCandidates } from "./meldFinder.js";
import type { CardDTO, CardID } from "./types.js";

export class GameUtils {
  public static findValidMeldsById(
    handIds: ReadonlyArray<CardID>,
    cardsById: Record<CardID, CardDTO>,
  ): CardID[][] {
    return findMeldCandidates(handIds, cardsById).map((candidate) => candidate.cardIds);
  }
}
