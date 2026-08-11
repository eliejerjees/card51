import { findMeldCandidates } from "./meldFinder";
import type { CardDTO, CardID } from "./types";

export class GameUtils {
  public static findValidMeldsById(
    handIds: ReadonlyArray<CardID>,
    cardsById: Record<CardID, CardDTO>,
  ): CardID[][] {
    return findMeldCandidates(handIds, cardsById).map((candidate) => candidate.cardIds);
  }
}
