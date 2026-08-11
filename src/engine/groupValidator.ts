import { cardPointValue, Rank, STANDARD_SUITS, Suit } from "./card";
import type { AceMode as AceModeType, CardDTO, CardID, Meld, MeldKind } from "./types";

export const AceMode = {
  LOW: "LOW",
  HIGH: "HIGH",
} as const satisfies Record<string, AceModeType>;

export type JokerRep = { suit: Suit; rank: Rank };

export type MeldValidation =
  | {
      ok: true;
      kind: MeldKind;
      aceMode?: AceModeType;
      orderedIds: CardID[];
      jokerMap: Record<CardID, JokerRep>;
      points: number;
      complete: boolean;
    }
  | { ok: false; error: string };

export type MeldValidationOptions = {
  kind?: MeldKind;
  aceMode?: AceModeType;
  fixedJokerMap?: Partial<Record<CardID, JokerRep>>;
};

const rankIndex = (rank: Rank, mode: AceModeType): number => {
  if (rank === Rank.ACE) return mode === AceMode.HIGH ? 14 : 1;
  const order: Rank[] = [
    Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN,
    Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING,
  ];
  const index = order.indexOf(rank);
  return index < 0 ? 0 : index + 2;
};

const indexToRank = (value: number): Rank => {
  const ranks: Record<number, Rank> = {
    1: Rank.ACE, 2: Rank.TWO, 3: Rank.THREE, 4: Rank.FOUR, 5: Rank.FIVE,
    6: Rank.SIX, 7: Rank.SEVEN, 8: Rank.EIGHT, 9: Rank.NINE, 10: Rank.TEN,
    11: Rank.JACK, 12: Rank.QUEEN, 13: Rank.KING, 14: Rank.ACE,
  };
  return ranks[value] ?? Rank.JOKER;
};

const isJoker = (card: CardDTO): boolean => card.rank === Rank.JOKER;

function hasValidCards(cards: ReadonlyArray<CardDTO | undefined>): cards is ReadonlyArray<CardDTO> {
  return cards.every(Boolean);
}

function matchesFixedRepresentations(
  jokerMap: Record<CardID, JokerRep>,
  fixed: Partial<Record<CardID, JokerRep>> | undefined,
): boolean {
  if (!fixed) return true;
  return Object.entries(fixed).every(([id, expected]) => {
    const actual = jokerMap[id];
    return !expected || (actual?.rank === expected.rank && actual.suit === expected.suit);
  });
}

function pointsFor(cards: ReadonlyArray<CardDTO>, jokerMap: Record<CardID, JokerRep>): number {
  return cards.reduce((sum, card) => {
    const represented = isJoker(card) ? jokerMap[card.id] : undefined;
    return sum + cardPointValue(represented?.rank ?? card.rank);
  }, 0);
}

export class GroupValidator {
  public static validateMeld(
    cards: ReadonlyArray<CardDTO | undefined>,
    options: MeldValidationOptions = {},
  ): MeldValidation {
    if (!hasValidCards(cards)) return { ok: false, error: "Meld contains an unknown card." };
    if (new Set(cards.map((card) => card.id)).size !== cards.length) {
      return { ok: false, error: "A physical card cannot appear twice in one meld." };
    }

    if (!options.kind || options.kind === "SET") {
      const set = this.validateSet(cards, options.fixedJokerMap);
      if (set.ok) return set;
      if (options.kind === "SET") return set;
    }

    if (!options.kind || options.kind === "RUN") {
      const modes: AceModeType[] = options.aceMode ? [options.aceMode] : [AceMode.LOW, AceMode.HIGH];
      const candidates = modes
        .map((mode) => this.validateRun(cards, mode, options.fixedJokerMap))
        .filter((result): result is Extract<MeldValidation, { ok: true }> => result.ok)
        .sort((a, b) => b.points - a.points || (a.aceMode === AceMode.LOW ? -1 : 1));
      if (candidates[0]) return candidates[0];
    }

    return { ok: false, error: "Cards do not form a valid set or run." };
  }

  public static validateSet(
    cards: ReadonlyArray<CardDTO | undefined>,
    fixedJokerMap?: Partial<Record<CardID, JokerRep>>,
  ): MeldValidation {
    if (!hasValidCards(cards)) return { ok: false, error: "Set contains an unknown card." };
    if (cards.length < 3 || cards.length > 4) {
      return { ok: false, error: "A set must contain three or four cards." };
    }
    if (new Set(cards.map((card) => card.id)).size !== cards.length) {
      return { ok: false, error: "A physical card cannot appear twice in one set." };
    }

    const jokers = cards.filter(isJoker).sort((a, b) => a.id.localeCompare(b.id));
    const natural = cards.filter((card) => !isJoker(card));
    if (fixedJokerMap && Object.keys(fixedJokerMap).some((id) => !jokers.some((joker) => joker.id === id))) {
      return { ok: false, error: "Only Jokers in this meld may receive represented identities." };
    }
    if (natural.length === 0) return { ok: false, error: "A set needs a natural card to establish its rank." };

    const rank = natural[0].rank;
    if (!natural.every((card) => card.rank === rank)) {
      return { ok: false, error: "Every card in a set must have the same rank." };
    }
    const naturalSuits = natural.map((card) => card.suit);
    if (new Set(naturalSuits).size !== naturalSuits.length) {
      return { ok: false, error: "A set cannot contain duplicate suits." };
    }

    const missingSuits = STANDARD_SUITS.filter((suit) => !naturalSuits.includes(suit));
    const jokerMap: Record<CardID, JokerRep> = {};
    const reserved = new Set<Suit>();

    for (const joker of jokers) {
      const fixed = fixedJokerMap?.[joker.id];
      if (!fixed) continue;
      if (fixed.rank !== rank || !missingSuits.includes(fixed.suit) || reserved.has(fixed.suit)) {
        return { ok: false, error: "A Joker's represented card must preserve the set." };
      }
      jokerMap[joker.id] = fixed;
      reserved.add(fixed.suit);
    }
    for (const joker of jokers) {
      if (jokerMap[joker.id]) continue;
      const suit = missingSuits.find((candidate) => !reserved.has(candidate));
      if (!suit) return { ok: false, error: "There are too many Jokers for this set." };
      jokerMap[joker.id] = { rank, suit };
      reserved.add(suit);
    }

    const representedSuit = (card: CardDTO): Suit => isJoker(card) ? jokerMap[card.id].suit : card.suit;
    const suitOrder: Suit[] = [Suit.CLUBS, Suit.DIAMONDS, Suit.SPADES, Suit.HEARTS];
    const bySuit = (a: CardDTO, b: CardDTO): number => suitOrder.indexOf(representedSuit(a)) - suitOrder.indexOf(representedSuit(b));
    const isRed = (suit: Suit): boolean => suit === Suit.DIAMONDS || suit === Suit.HEARTS;
    const red = cards.filter((card) => isRed(representedSuit(card))).sort(bySuit);
    const black = cards.filter((card) => !isRed(representedSuit(card))).sort(bySuit);
    const first = red.length > black.length ? red : black;
    const second = first === red ? black : red;
    const alternating: CardDTO[] = [];
    for (let index = 0; index < first.length; index++) {
      if (first[index]) alternating.push(first[index]);
      if (second[index]) alternating.push(second[index]);
    }
    const orderedIds = alternating.map((card) => card.id);

    return {
      ok: true,
      kind: "SET",
      orderedIds,
      jokerMap,
      points: pointsFor(cards, jokerMap),
      complete: cards.length === 4,
    };
  }

  public static validateRun(
    cards: ReadonlyArray<CardDTO | undefined>,
    mode: AceModeType,
    fixedJokerMap?: Partial<Record<CardID, JokerRep>>,
  ): MeldValidation {
    if (!hasValidCards(cards)) return { ok: false, error: "Run contains an unknown card." };
    if (cards.length < 3 || cards.length > 13) {
      return { ok: false, error: "A run must contain between three and thirteen cards." };
    }
    if (new Set(cards.map((card) => card.id)).size !== cards.length) {
      return { ok: false, error: "A physical card cannot appear twice in one run." };
    }

    const jokers = cards.filter(isJoker).sort((a, b) => a.id.localeCompare(b.id));
    const natural = cards.filter((card) => !isJoker(card));
    if (fixedJokerMap && Object.keys(fixedJokerMap).some((id) => !jokers.some((joker) => joker.id === id))) {
      return { ok: false, error: "Only Jokers in this meld may receive represented identities." };
    }
    if (natural.length === 0) return { ok: false, error: "A run needs a natural card to establish its suit." };
    const suit = natural[0].suit;
    if (!natural.every((card) => card.suit === suit)) {
      return { ok: false, error: "Every card in a run must have the same suit." };
    }

    const naturalIndexes = natural.map((card) => rankIndex(card.rank, mode));
    if (new Set(naturalIndexes).size !== naturalIndexes.length) {
      return { ok: false, error: "A run cannot contain duplicate ranks." };
    }

    const minRank = mode === AceMode.LOW ? 1 : 2;
    const maxRank = mode === AceMode.LOW ? 13 : 14;
    const candidates: Extract<MeldValidation, { ok: true }>[] = [];
    for (let start = minRank; start <= maxRank - cards.length + 1; start++) {
      const end = start + cards.length - 1;
      if (!naturalIndexes.every((value) => value >= start && value <= end)) continue;

      const missing: number[] = [];
      for (let value = start; value <= end; value++) {
        if (!naturalIndexes.includes(value)) missing.push(value);
      }
      if (missing.length !== jokers.length) continue;

      const jokerMap: Record<CardID, JokerRep> = {};
      jokers.forEach((joker, index) => {
        jokerMap[joker.id] = { suit, rank: indexToRank(missing[index]) };
      });
      if (!matchesFixedRepresentations(jokerMap, fixedJokerMap)) continue;

      const byIndex = new Map(natural.map((card) => [rankIndex(card.rank, mode), card.id]));
      const jokerByIndex = new Map(jokers.map((joker, index) => [missing[index], joker.id]));
      const orderedIds: CardID[] = [];
      for (let value = start; value <= end; value++) {
        orderedIds.push(byIndex.get(value) ?? jokerByIndex.get(value)!);
      }
      const usesAceBoundary = natural.some((card) => card.rank === Rank.ACE)
        || Object.values(jokerMap).some((represented) => represented.rank === Rank.ACE);
      candidates.push({
        ok: true,
        kind: "RUN",
        aceMode: usesAceBoundary ? mode : undefined,
        orderedIds,
        jokerMap,
        points: pointsFor(cards, jokerMap),
        complete: cards.length === 13,
      });
    }

    candidates.sort((a, b) => b.points - a.points || a.orderedIds.join().localeCompare(b.orderedIds.join()));
    return candidates[0] ?? { ok: false, error: "Run ranks must be sequential without wrapping the Ace." };
  }
}

export function calculateMeldValue(meld: Pick<Meld, "cardIds" | "jokerMap">, cardsById: Record<CardID, CardDTO>): number {
  return meld.cardIds.reduce((sum, id) => {
    const card = cardsById[id];
    if (!card) return sum;
    const represented = card.rank === Rank.JOKER ? meld.jokerMap[id] : undefined;
    return sum + cardPointValue(represented?.rank ?? card.rank);
  }, 0);
}
