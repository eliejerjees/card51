import { Rank, STANDARD_RANKS, STANDARD_SUITS, type Suit } from "./card";
import { AceMode, GroupValidator, type MeldValidation } from "./groupValidator";
import type { AceMode as AceModeType, CardDTO, CardID, MeldKind } from "./types";

export type MeldCandidate = {
  cardIds: CardID[];
  validation: Extract<MeldValidation, { ok: true }>;
};

type CandidateOptions = {
  kind?: MeldKind;
  maxCandidates?: number;
};

function choose<T>(items: ReadonlyArray<T>, count: number): T[][] {
  if (count === 0) return [[]];
  if (count < 0 || count > items.length) return [];
  const output: T[][] = [];
  const visit = (start: number, selected: T[]): void => {
    if (selected.length === count) {
      output.push([...selected]);
      return;
    }
    for (let index = start; index <= items.length - (count - selected.length); index++) {
      selected.push(items[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return output;
}

function cartesian<T>(groups: ReadonlyArray<ReadonlyArray<T>>, limit: number): T[][] {
  let results: T[][] = [[]];
  for (const group of groups) {
    const next: T[][] = [];
    for (const result of results) {
      for (const item of group) {
        next.push([...result, item]);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    results = next;
    if (results.length === 0) break;
  }
  return results;
}

function rankForIndex(index: number): CardDTO["rank"] {
  if (index === 1 || index === 14) return Rank.ACE;
  return STANDARD_RANKS[index - 2];
}

function candidateKey(candidate: MeldCandidate): string {
  const jokerKey = Object.entries(candidate.validation.jokerMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, represented]) => `${id}:${represented.rank}:${represented.suit}`)
    .join("|");
  const aceKey = candidate.validation.complete ? "" : candidate.validation.aceMode ?? "";
  return `${candidate.validation.kind}:${aceKey}:${[...candidate.cardIds].sort().join(",")}:${jokerKey}`;
}

/**
 * Generates melds from rank/suit windows instead of testing every hand subset.
 * This keeps bot and trash-eligibility searches bounded as hands grow.
 */
export function findMeldCandidates(
  handIds: ReadonlyArray<CardID>,
  cardsById: Record<CardID, CardDTO>,
  options: CandidateOptions = {},
): MeldCandidate[] {
  const maxCandidates = options.maxCandidates ?? 25_000;
  const cards = handIds.map((id) => cardsById[id]).filter((card): card is CardDTO => Boolean(card));
  const jokers = cards.filter((card) => card.rank === Rank.JOKER);
  const natural = cards.filter((card) => card.rank !== Rank.JOKER);
  const output: MeldCandidate[] = [];
  const keys = new Set<string>();

  const add = (cardIds: CardID[], kind: MeldKind, aceMode?: AceModeType): void => {
    if (output.length >= maxCandidates) return;
    const validation = GroupValidator.validateMeld(cardIds.map((id) => cardsById[id]), { kind, aceMode });
    if (!validation.ok) return;
    const candidate = { cardIds: validation.orderedIds, validation };
    const key = candidateKey(candidate);
    if (!keys.has(key)) {
      keys.add(key);
      output.push(candidate);
    }
  };

  if (!options.kind || options.kind === "SET") {
    for (const rank of STANDARD_RANKS) {
      const bySuit = new Map<Suit, CardDTO[]>();
      for (const suit of STANDARD_SUITS) {
        bySuit.set(suit, natural.filter((card) => card.rank === rank && card.suit === suit));
      }
      for (const size of [3, 4]) {
        for (let jokerCount = 0; jokerCount <= Math.min(jokers.length, size - 1); jokerCount++) {
          const naturalCount = size - jokerCount;
          const availableSuits = STANDARD_SUITS.filter((suit) => (bySuit.get(suit)?.length ?? 0) > 0);
          for (const suits of choose(availableSuits, naturalCount)) {
            const naturalVariants = cartesian(suits.map((suit) => bySuit.get(suit)!), maxCandidates - output.length);
            for (const jokerSelection of choose(jokers, jokerCount)) {
              for (const variant of naturalVariants) {
                add([...variant.map((card) => card.id), ...jokerSelection.map((card) => card.id)], "SET");
                if (output.length >= maxCandidates) break;
              }
              if (output.length >= maxCandidates) break;
            }
            if (output.length >= maxCandidates) break;
          }
          if (output.length >= maxCandidates) break;
        }
        if (output.length >= maxCandidates) break;
      }
      if (output.length >= maxCandidates) break;
    }
  }

  if ((!options.kind || options.kind === "RUN") && output.length < maxCandidates) {
    for (const suit of STANDARD_SUITS) {
      const byRank = new Map<CardDTO["rank"], CardDTO[]>();
      for (const rank of STANDARD_RANKS) {
        byRank.set(rank, natural.filter((card) => card.suit === suit && card.rank === rank));
      }
      for (const mode of [AceMode.LOW, AceMode.HIGH] as const) {
        const min = mode === AceMode.LOW ? 1 : 2;
        const max = mode === AceMode.LOW ? 13 : 14;
        for (let length = 3; length <= 13; length++) {
          for (let start = min; start <= max - length + 1; start++) {
            const positionOptions: CardDTO[][] = [];
            for (let index = start; index < start + length; index++) {
              positionOptions.push([...(byRank.get(rankForIndex(index)) ?? []), ...jokers]);
            }
            if (positionOptions.some((choices) => choices.length === 0)) continue;

            const selected: CardDTO[] = [];
            const used = new Set<CardID>();
            const build = (position: number): void => {
              if (output.length >= maxCandidates) return;
              if (position === positionOptions.length) {
                add(selected.map((card) => card.id), "RUN", mode);
                return;
              }
              for (const card of positionOptions[position]) {
                if (used.has(card.id)) continue;
                used.add(card.id);
                selected.push(card);
                build(position + 1);
                selected.pop();
                used.delete(card.id);
                if (output.length >= maxCandidates) return;
              }
            };
            build(0);
            if (output.length >= maxCandidates) break;
          }
          if (output.length >= maxCandidates) break;
        }
        if (output.length >= maxCandidates) break;
      }
      if (output.length >= maxCandidates) break;
    }
  }

  return output;
}
