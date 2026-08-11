import { findMeldCandidates, type MeldCandidate } from "./meldFinder.js";
import type { CardDTO, CardID } from "./types.js";

export type OpeningGroup = MeldCandidate;

function maskFor(cardIds: ReadonlyArray<CardID>, indexes: Map<CardID, number>): bigint {
  return cardIds.reduce((mask, id) => mask | (1n << BigInt(indexes.get(id)!)), 0n);
}

function bitCount(mask: bigint): number {
  let count = 0;
  while (mask) {
    mask &= mask - 1n;
    count++;
  }
  return count;
}

/** Finds disjoint new melds worth 51+ while preserving the mandatory discard. */
export function findOpeningPlan(
  handIds: ReadonlyArray<CardID>,
  cardsById: Record<CardID, CardDTO>,
  requiredCardId?: CardID,
): OpeningGroup[] | null {
  if (handIds.length < 4 || new Set(handIds).size !== handIds.length) return null;
  const indexes = new Map(handIds.map((id, index) => [id, index]));
  if (requiredCardId && !indexes.has(requiredCardId)) return null;

  const candidates = findMeldCandidates(handIds, cardsById)
    .map((candidate) => ({ ...candidate, mask: maskFor(candidate.cardIds, indexes) }))
    .filter((candidate) => candidate.cardIds.length < handIds.length)
    .sort((a, b) => {
      const aRequired = requiredCardId && a.cardIds.includes(requiredCardId) ? 1 : 0;
      const bRequired = requiredCardId && b.cardIds.includes(requiredCardId) ? 1 : 0;
      return bRequired - aRequired || b.validation.points - a.validation.points || b.cardIds.length - a.cardIds.length;
    });
  const requiredMask = requiredCardId ? 1n << BigInt(indexes.get(requiredCardId)!) : 0n;
  const memo = new Set<string>();

  const search = (start: number, usedMask: bigint, points: number, selected: OpeningGroup[]): OpeningGroup[] | null => {
    if (points >= 51 && bitCount(usedMask) < handIds.length && (!requiredMask || (usedMask & requiredMask))) {
      return selected;
    }
    const key = `${start}:${usedMask}:${Math.min(points, 51)}`;
    if (memo.has(key)) return null;
    memo.add(key);

    for (let index = start; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (candidate.mask & usedMask) continue;
      const combinedMask = candidate.mask | usedMask;
      if (bitCount(combinedMask) >= handIds.length) continue;
      const result = search(index + 1, combinedMask, points + candidate.validation.points, [
        ...selected,
        { cardIds: candidate.cardIds, validation: candidate.validation },
      ]);
      if (result) return result;
    }
    return null;
  };

  return search(0, 0n, 0, []);
}

export function canTakeDiscardForOpening(
  handIds: ReadonlyArray<CardID>,
  discardId: CardID,
  cardsById: Record<CardID, CardDTO>,
): boolean {
  return findOpeningPlan([...handIds, discardId], cardsById, discardId) !== null;
}
