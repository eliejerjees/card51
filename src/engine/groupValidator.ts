// src/engine/groupValidator.ts
//
// Direct port of your Java GroupValidator, including Ace LOW/HIGH run logic
// and the joker "fills gaps" rule.

import type { CardDTO, CardID } from "./types";
import { Rank, Suit } from "./card";


export const AceMode = {
  LOW: "LOW",
  HIGH: "HIGH",
} as const;

export type AceMode = typeof AceMode[keyof typeof AceMode];

export type JokerRep = {
  suit: Suit;
  rank: Rank;
}

export type MeldValidation = |{
  ok: true;
  kind: "SET" | "RUN";
  aceMode?: AceMode;
  orderedIds: CardID[];
  jokerMap: Record<CardID, JokerRep>;
} | {
  ok: false;
  error: string;
}

const SUIT_ORDER: Suit[] = [Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, Suit.SPADES];

function rankIndex(rank: Rank, mode: AceMode): number {
  switch (rank) {
    case Rank.TWO: return 2;
    case Rank.THREE: return 3;
    case Rank.FOUR: return 4;
    case Rank.FIVE: return 5;
    case Rank.SIX: return 6;
    case Rank.SEVEN: return 7;
    case Rank.EIGHT: return 8;
    case Rank.NINE: return 9;
    case Rank.TEN: return 10;
    case Rank.JACK: return 11;
    case Rank.QUEEN: return 12;
    case Rank.KING: return 13;
    case Rank.ACE: return mode === AceMode.HIGH ? 14 : 1;
    default: return 0;
  }
}

function indexToRank(idx: number, mode: AceMode): Rank {
  // idx is 1..14 (depending on mode)
  switch (idx) {
    case 1: return Rank.ACE; // only meaningful for LOW
    case 2: return Rank.TWO;
    case 3: return Rank.THREE;
    case 4: return Rank.FOUR;
    case 5: return Rank.FIVE;
    case 6: return Rank.SIX;
    case 7: return Rank.SEVEN;
    case 8: return Rank.EIGHT;
    case 9: return Rank.NINE;
    case 10: return Rank.TEN;
    case 11: return Rank.JACK;
    case 12: return Rank.QUEEN;
    case 13: return Rank.KING;
    case 14: return Rank.ACE; // only meaningful for HIGH
    default: return Rank.JOKER;
  }
}

function isJoker(c: CardDTO): boolean {
  return c.rank === Rank.JOKER;
}

export class GroupValidator {
  //one entry point that decides set vs run (low/high ace)
  public static validateMeld(cards: ReadonlyArray<CardDTO>): MeldValidation {
    const setRes = this.validateSet(cards);
    if (setRes.ok) return setRes;

    const low = this.validateRun(cards, AceMode.LOW);
    if (low.ok) return low;

    const high = this.validateRun(cards, AceMode.HIGH);
    if (high.ok) return high;

    return {
      ok: false,
      error: "Not a valid set or run."
    } ;
  }

  public static validateSet(cards: ReadonlyArray<CardDTO>): MeldValidation {
    if (cards.length < 3 || cards.length > 4) {
      return { ok: false, error: "Set must be size 3 or 4." };
    }

    const jokers = cards.filter(isJoker);
    const non = cards.filter((c) => !isJoker(c));

    if(non.length === 0) return { ok: false, error: "Set must have at least one non-joker card." };

    // All non-jokers must share rank
    const rank = non[0].rank;
    for (const c of non) if (c.rank !== rank) return { ok: false, error: "Set ranks must match." };

    // Suits unique among non-jokers
    const suitSet = new Set<Suit>();
    for (const c of non) {
      if (suitSet.has(c.suit)) return { ok: false, error: "Duplicate suit in set." };
      suitSet.add(c.suit);
    }


    if(suitSet.size + jokers.length !== cards.length) return {ok: false, error: "Invalid set size."};

    // Canonical joker mapping: fill missing suits in SUIT_ORDER
    const missing = SUIT_ORDER.filter((s) => !suitSet.has(s));
    const jokerIds = jokers.map((c) => c.id).sort();
    const jokerMap: Record<CardID, JokerRep> = {};

    for(let i = 0; i < jokerIds.length; i++) {
      const suit = missing[i];
      if (!suit) return { ok: false, error: "Too many jokers for set." };
      jokerMap[jokerIds[i]] = { suit, rank: rank };
    }

    // Order: non-jokers first by suit order, then jokers in order of assigned suit

    const orderedNon = [...non].sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit));
    const orderedIds = [...orderedNon.map((c) => c.id), ...jokerIds];

    return { ok: true, kind: "SET", orderedIds, jokerMap };
  }

public static validateRun(cards: ReadonlyArray<CardDTO>, mode: AceMode): MeldValidation {
    if (cards.length < 3) return { ok: false, error: "Run must be at least 3 cards." };

    const jokers = cards.filter(isJoker);
    const non = cards.filter((c) => !isJoker(c));

    if (non.length === 0) return { ok: false, error: "Run cannot be all jokers." };

    // All non-jokers must share suit
    const suit = non[0].suit;
    for (const c of non) if (c.suit !== suit) return { ok: false, error: "Run suit must match." };

    // No duplicate ranks among non-jokers
    const idxs = non.map((c) => rankIndex(c.rank, mode)).sort((a, b) => a - b);
    for (let i = 1; i < idxs.length; i++) {
      if (idxs[i] === idxs[i - 1]) return { ok: false, error: "Duplicate rank in run." };
    }

    const len = cards.length;
    const min = idxs[0];
    const max = idxs[idxs.length - 1];

    // Find a canonical contiguous window [start..start+len-1] that can contain all non-jokers
    // and be completed with available jokers. Choose smallest start that works.
    const maxRank = mode === AceMode.HIGH ? 14 : 13; // LOW run uses Ace=1..13
    const minRank = mode === AceMode.HIGH ? 2 : 1;

    let chosenStart: number | null = null;
    for (let start = minRank; start <= maxRank - len + 1; start++) {
      const end = start + len - 1;
      if (min < start || max > end) continue;

      // Non-joker indices must be inside window, distinct already ensured
      const missing = len - idxs.length;
      if (missing <= jokers.length) {
        chosenStart = start;
        break;
      }
    }

    if (chosenStart === null) return { ok: false, error: "Run cannot be completed with jokers." };

    const start = chosenStart;
    const end = start + len - 1;
    const present = new Set<number>(idxs);

    const missingIdxs: number[] = [];
    for (let v = start; v <= end; v++) {
      if (!present.has(v)) missingIdxs.push(v);
    }

    const jokerIds = jokers.map((c) => c.id).sort();
    const jokerMap: Record<CardID, JokerRep> = {};

    for (let i = 0; i < jokerIds.length; i++) {
      const target = missingIdxs[i];
      if (target === undefined) {
        // extra jokers: push them to the highest end by convention (end+1, end+2 not allowed in fixed window),
        // so we reject for now to keep rules consistent.
        return { ok: false, error: "Too many jokers for chosen run window." };
      }
      jokerMap[jokerIds[i]] = { suit, rank: indexToRank(target, mode) };
    }

    // Normalize order: run from start..end. Put real cards where they match, jokers where missing.
    const byIndex: Record<number, CardID> = {};
    for (const c of non) byIndex[rankIndex(c.rank, mode)] = c.id;

    const orderedIds: CardID[] = [];
    let jokerCursor = 0;
    for (let v = start; v <= end; v++) {
      const realId = byIndex[v];
      if (realId) orderedIds.push(realId);
      else orderedIds.push(jokerIds[jokerCursor++]);
    }

    return { ok: true, kind: "RUN", aceMode: mode, orderedIds, jokerMap };
  }
}
