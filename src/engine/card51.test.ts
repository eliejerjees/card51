import { describe, expect, it } from "vitest";
import { Rank, Suit } from "./card";
import { GroupValidator } from "./groupValidator";
import { validateStateInvariants } from "./invariants";
import { botStep } from "./bot";
import { findMeldCandidates } from "./meldFinder";
import { createPlayerView } from "./playerView";
import { AuthoritativeGame } from "./authority";
import { LobbyService } from "../online/lobbyService";
import { applyAction, initGame } from "./state";
import type { CardDTO, CardID, GameState, Meld } from "./types";

const c = (id: string, rank: CardDTO["rank"], suit: CardDTO["suit"]): CardDTO => ({ id, rank, suit });
const joker = (id = "joker"): CardDTO => c(id, Rank.JOKER, Suit.JOKER);

function testState(
  cards: CardDTO[],
  options: {
    hand?: CardID[];
    otherHand?: CardID[];
    discard?: CardID[];
    drawPile?: CardID[];
    opened?: boolean;
    phase?: GameState["phase"];
    melds?: Meld[];
  } = {},
): GameState {
  const hand = options.hand ?? [];
  const otherHand = options.otherHand ?? [];
  const discard = options.discard ?? [];
  const melds = options.melds ?? [];
  const assigned = new Set([...hand, ...otherHand, ...discard, ...melds.flatMap((meld) => meld.cardIds)]);
  const drawPile = options.drawPile ?? cards.map((card) => card.id).filter((id) => !assigned.has(id));
  const phase = options.phase ?? "ACTION";
  const turnCard = phase === "ACTION" || phase === "DISCARD" ? hand[0] ?? null : null;
  return {
    numPlayers: 2,
    currentTurn: 0,
    phase,
    winner: null,
    drawPile,
    deckCount: drawPile.length,
    discard,
    lastDrawnCardId: turnCard,
    lastDrawSource: turnCard ? "DECK" : null,
    cardsById: Object.fromEntries(cards.map((card) => [card.id, card])),
    playersPublic: {
      0: { id: 0, opened: options.opened ?? false, handCount: hand.length },
      1: { id: 1, opened: false, handCount: otherHand.length },
    },
    playersPrivate: { 0: { hand }, 1: { hand: otherHand } },
    tableMelds: melds,
    events: [],
    turnNumber: 1,
    turnTimeLimitMs: null,
    lastBurnedMeld: null,
  };
}

describe("sets", () => {
  it("accepts a valid three-card set", () => {
    const result = GroupValidator.validateMeld([
      c("7c", Rank.SEVEN, Suit.CLUBS),
      c("7d", Rank.SEVEN, Suit.DIAMONDS),
      c("7h", Rank.SEVEN, Suit.HEARTS),
    ]);
    expect(result).toMatchObject({ ok: true, kind: "SET", complete: false, points: 21 });
  });

  it("marks a four-suit set complete", () => {
    const result = GroupValidator.validateMeld([
      c("7c", Rank.SEVEN, Suit.CLUBS), c("7d", Rank.SEVEN, Suit.DIAMONDS),
      c("7h", Rank.SEVEN, Suit.HEARTS), c("7s", Rank.SEVEN, Suit.SPADES),
    ]);
    expect(result).toMatchObject({ ok: true, kind: "SET", complete: true });
  });

  it("rejects duplicate suits even from different decks", () => {
    const result = GroupValidator.validateMeld([
      c("deck1-8c", Rank.EIGHT, Suit.CLUBS),
      c("deck2-8c", Rank.EIGHT, Suit.CLUBS),
      c("8d", Rank.EIGHT, Suit.DIAMONDS),
    ]);
    expect(result).toMatchObject({ ok: false });
  });

  it("allows two independent melds of the same rank", () => {
    const first = GroupValidator.validateMeld([
      c("a-c", Rank.NINE, Suit.CLUBS), c("a-d", Rank.NINE, Suit.DIAMONDS), c("a-h", Rank.NINE, Suit.HEARTS),
    ]);
    const second = GroupValidator.validateMeld([
      c("b-c", Rank.NINE, Suit.CLUBS), c("b-d", Rank.NINE, Suit.DIAMONDS), c("b-s", Rank.NINE, Suit.SPADES),
    ]);
    expect(first.ok && second.ok).toBe(true);
  });

  it("orders displayed sets by alternating red and black cards", () => {
    const result = GroupValidator.validateMeld([
      c("ah", Rank.ACE, Suit.HEARTS), c("ad", Rank.ACE, Suit.DIAMONDS), c("as", Rank.ACE, Suit.SPADES),
    ]);
    expect(result.ok && result.orderedIds).toEqual(["ad", "as", "ah"]);
  });
});

describe("runs", () => {
  it("accepts basic and longer same-suit sequences", () => {
    expect(GroupValidator.validateMeld([
      c("5d", Rank.FIVE, Suit.DIAMONDS), c("6d", Rank.SIX, Suit.DIAMONDS), c("7d", Rank.SEVEN, Suit.DIAMONDS),
    ])).toMatchObject({ ok: true, kind: "RUN" });
    expect(GroupValidator.validateMeld([
      c("5h", Rank.FIVE, Suit.HEARTS), c("6h", Rank.SIX, Suit.HEARTS),
      c("7h", Rank.SEVEN, Suit.HEARTS), c("8h", Rank.EIGHT, Suit.HEARTS),
    ])).toMatchObject({ ok: true, kind: "RUN" });
  });

  it("rejects mixed suits and gaps", () => {
    expect(GroupValidator.validateMeld([
      c("5d", Rank.FIVE, Suit.DIAMONDS), c("6c", Rank.SIX, Suit.CLUBS), c("7d", Rank.SEVEN, Suit.DIAMONDS),
    ]).ok).toBe(false);
    expect(GroupValidator.validateMeld([
      c("5s", Rank.FIVE, Suit.SPADES), c("7s", Rank.SEVEN, Suit.SPADES), c("8s", Rank.EIGHT, Suit.SPADES),
    ]).ok).toBe(false);
  });

  it("accepts A-2-3 and Q-K-A but rejects wrapping", () => {
    expect(GroupValidator.validateMeld([
      c("ah", Rank.ACE, Suit.HEARTS), c("2h", Rank.TWO, Suit.HEARTS), c("3h", Rank.THREE, Suit.HEARTS),
    ])).toMatchObject({ ok: true, aceMode: "LOW" });
    expect(GroupValidator.validateMeld([
      c("qs", Rank.QUEEN, Suit.SPADES), c("ks", Rank.KING, Suit.SPADES), c("as", Rank.ACE, Suit.SPADES),
    ])).toMatchObject({ ok: true, aceMode: "HIGH" });
    expect(GroupValidator.validateMeld([
      c("qc", Rank.QUEEN, Suit.CLUBS), c("kc", Rank.KING, Suit.CLUBS),
      c("ac", Rank.ACE, Suit.CLUBS), c("2c", Rank.TWO, Suit.CLUBS),
    ]).ok).toBe(false);
  });

  it("marks both full Ace sequences complete", () => {
    const ranks = [Rank.ACE, Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN,
      Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING];
    const low = ranks.map((rank, index) => c(`l${index}`, rank, Suit.CLUBS));
    const high = [...ranks.slice(1), Rank.ACE].map((rank, index) => c(`h${index}`, rank, Suit.HEARTS));
    expect(GroupValidator.validateMeld(low)).toMatchObject({ ok: true, complete: true, aceMode: "LOW" });
    expect(GroupValidator.validateMeld(high, { kind: "RUN", aceMode: "HIGH" })).toMatchObject({ ok: true, complete: true, aceMode: "HIGH" });
  });

  it("derives the Ace end again whenever an existing run is extended", () => {
    const cards = [
      c("10h", Rank.TEN, Suit.HEARTS), c("jh", Rank.JACK, Suit.HEARTS),
      c("qh", Rank.QUEEN, Suit.HEARTS), c("kh", Rank.KING, Suit.HEARTS),
      c("ah", Rank.ACE, Suit.HEARTS), c("f", Rank.THREE, Suit.CLUBS),
    ];
    const meld: Meld = {
      id: "high-run", owner: 1, kind: "RUN", aceMode: "LOW",
      cardIds: ["10h", "jh", "qh", "kh"], jokerMap: {},
    };
    expect(GroupValidator.validateMeld(cards.slice(0, 4))).toMatchObject({ ok: true, kind: "RUN", aceMode: undefined });
    const state = testState(cards, { hand: ["ah", "f"], opened: true, melds: [meld] });
    expect(applyAction(state, { type: "ADD_TO_MELD", player: 0, meldId: meld.id, cardIds: ["ah"] })).toEqual({ ok: true });
    expect(state.tableMelds[0].cardIds).toEqual(["10h", "jh", "qh", "kh", "ah"]);
    expect(state.tableMelds[0].aceMode).toBe("HIGH");
  });
});

describe("opening", () => {
  const openingCards = [
    c("10c", Rank.TEN, Suit.CLUBS), c("10d", Rank.TEN, Suit.DIAMONDS), c("10h", Rank.TEN, Suit.HEARTS),
    c("7c", Rank.SEVEN, Suit.CLUBS), c("7d", Rank.SEVEN, Suit.DIAMONDS), c("7h", Rank.SEVEN, Suit.HEARTS),
    c("filler", Rank.TWO, Suit.SPADES),
  ];

  it("accepts exactly 51 across multiple melds", () => {
    const state = testState(openingCards, { hand: openingCards.map((card) => card.id) });
    expect(applyAction(state, { type: "OPEN_MULTI", player: 0, groups: [["10c", "10d", "10h"], ["7c", "7d", "7h"]] })).toEqual({ ok: true });
    expect(state.playersPublic[0].opened).toBe(true);
  });

  it("accepts more than 51 and rejects 50", () => {
    const moreCards = [
      c("ac", Rank.ACE, Suit.CLUBS), c("ad", Rank.ACE, Suit.DIAMONDS), c("ah", Rank.ACE, Suit.HEARTS),
      c("kc", Rank.KING, Suit.CLUBS), c("kd", Rank.KING, Suit.DIAMONDS), c("kh", Rank.KING, Suit.HEARTS),
      c("f", Rank.TWO, Suit.CLUBS),
    ];
    const more = testState(moreCards, { hand: moreCards.map((card) => card.id) });
    expect(applyAction(more, { type: "OPEN_MULTI", player: 0, groups: [["ac", "ad", "ah"], ["kc", "kd", "kh"]] }).ok).toBe(true);

    const fiftyCards = [
      c("tc", Rank.TEN, Suit.CLUBS), c("td", Rank.TEN, Suit.DIAMONDS), c("th", Rank.TEN, Suit.HEARTS),
      c("2s", Rank.TWO, Suit.SPADES), c("3s", Rank.THREE, Suit.SPADES), c("4s", Rank.FOUR, Suit.SPADES),
      c("5s", Rank.FIVE, Suit.SPADES), c("6s", Rank.SIX, Suit.SPADES), c("f", Rank.ACE, Suit.CLUBS),
    ];
    const fifty = testState(fiftyCards, { hand: fiftyCards.map((card) => card.id) });
    expect(applyAction(fifty, { type: "OPEN_MULTI", player: 0, groups: [["tc", "td", "th"], ["2s", "3s", "4s", "5s", "6s"]] })).toMatchObject({ ok: false });
  });

  it("values a Joker as its represented card", () => {
    const result = GroupValidator.validateMeld([
      c("7c", Rank.SEVEN, Suit.CLUBS), c("7d", Rank.SEVEN, Suit.DIAMONDS), joker(),
    ]);
    expect(result).toMatchObject({ ok: true, points: 21 });
  });
});

describe("trash draws", () => {
  const cards = [
    c("10c", Rank.TEN, Suit.CLUBS), c("10d", Rank.TEN, Suit.DIAMONDS), c("10h", Rank.TEN, Suit.HEARTS),
    c("7c", Rank.SEVEN, Suit.CLUBS), c("7d", Rank.SEVEN, Suit.DIAMONDS), c("7h", Rank.SEVEN, Suit.HEARTS),
    c("8c-top", Rank.EIGHT, Suit.CLUBS), c("8d", Rank.EIGHT, Suit.DIAMONDS), c("8h", Rank.EIGHT, Suit.HEARTS),
    c("8c-copy", Rank.EIGHT, Suit.CLUBS), c("f", Rank.TWO, Suit.SPADES),
  ];

  it("lets a closed player take trash only for an opening that uses it", () => {
    const hand = ["10c", "10d", "10h", "7c", "7d", "7h", "8d", "8h", "f"];
    const state = testState(cards, { hand, discard: ["8c-top"], phase: "DRAW" });
    expect(applyAction(state, { type: "DRAW_DISCARD", player: 0 }).ok).toBe(true);
    expect(applyAction(state, {
      type: "OPEN_MULTI", player: 0,
      groups: [["10c", "10d", "10h"], ["7c", "7d", "7h"]],
    })).toMatchObject({ ok: false, error: expect.stringContaining("exact trash card") });
    expect(applyAction(state, { type: "PASS_ACTION", player: 0 })).toMatchObject({ ok: false });
    expect(applyAction(state, {
      type: "OPEN_MULTI", player: 0,
      groups: [["10c", "10d", "10h"], ["8c-top", "8d", "8h"]],
    }).ok).toBe(true);
  });

  it("allows an opened player to keep trash but blocks the same physical card from immediate re-discard", () => {
    const state = testState(cards, {
      hand: ["8c-copy", "f"], discard: ["8c-top"], phase: "DRAW", opened: true,
    });
    expect(applyAction(state, { type: "DRAW_DISCARD", player: 0 }).ok).toBe(true);
    expect(applyAction(state, { type: "PASS_ACTION", player: 0 }).ok).toBe(true);
    expect(applyAction(state, { type: "DISCARD", player: 0, cardId: ["8c-top"] })).toMatchObject({ ok: false });
    expect(applyAction(state, { type: "DISCARD", player: 0, cardId: ["8c-copy"] }).ok).toBe(true);
  });

  it("prevents a closed player from taking trash when no qualifying opening exists", () => {
    const small = [
      c("2c", Rank.TWO, Suit.CLUBS), c("3d", Rank.THREE, Suit.DIAMONDS),
      c("4h", Rank.FOUR, Suit.HEARTS), c("top", Rank.FIVE, Suit.SPADES),
    ];
    const state = testState(small, { hand: ["2c", "3d", "4h"], discard: ["top"], phase: "DRAW" });
    const before = structuredClone(state);
    expect(applyAction(state, { type: "DRAW_DISCARD", player: 0 })).toMatchObject({ ok: false });
    expect(state).toEqual(before);
  });
});

describe("Jokers", () => {
  it("completes a set, fills a run gap, and carries represented value", () => {
    expect(GroupValidator.validateMeld([
      c("5c", Rank.FIVE, Suit.CLUBS), c("5d", Rank.FIVE, Suit.DIAMONDS), joker(),
    ])).toMatchObject({ ok: true, kind: "SET", points: 15 });
    expect(GroupValidator.validateMeld([
      c("jd", Rank.JACK, Suit.DIAMONDS), c("qd", Rank.QUEEN, Suit.DIAMONDS), joker(), c("ad", Rank.ACE, Suit.DIAMONDS),
    ])).toMatchObject({ ok: true, kind: "RUN", points: 40, jokerMap: { joker: { rank: Rank.KING, suit: Suit.DIAMONDS } } });
  });

  it("allows exact replacement and frees the Joker for reuse", () => {
    const cards = [
      c("jd", Rank.JACK, Suit.DIAMONDS), c("qd", Rank.QUEEN, Suit.DIAMONDS), joker(), c("ad", Rank.ACE, Suit.DIAMONDS),
      c("kd", Rank.KING, Suit.DIAMONDS), c("7c", Rank.SEVEN, Suit.CLUBS), c("7d", Rank.SEVEN, Suit.DIAMONDS),
      c("f", Rank.TWO, Suit.SPADES),
    ];
    const meld: Meld = {
      id: "run", owner: 1, kind: "RUN", aceMode: "HIGH",
      cardIds: ["jd", "qd", "joker", "ad"],
      jokerMap: { joker: { rank: Rank.KING, suit: Suit.DIAMONDS } },
    };
    const state = testState(cards, { hand: ["kd", "7c", "7d", "f"], opened: true, melds: [meld] });
    expect(applyAction(state, { type: "SWAP_JOKER", player: 0, meldId: "run", jokerId: "joker", replaceWithId: "kd" }).ok).toBe(true);
    expect(state.playersPrivate[0].hand).toContain("joker");
    expect(applyAction(state, { type: "LAY_MELD", player: 0, cardIds: ["7c", "7d", "joker"] }).ok).toBe(true);
  });

  it("enumerates ambiguous legal identities and revalidates the chosen identity", () => {
    const cards = [joker(), c("2s", Rank.TWO, Suit.SPADES), c("3s", Rank.THREE, Suit.SPADES), c("f", Rank.FIVE, Suit.CLUBS)];
    const options = findMeldCandidates(["joker", "2s", "3s"], Object.fromEntries(cards.map((card) => [card.id, card])))
      .filter((candidate) => candidate.cardIds.length === 3 && candidate.validation.kind === "RUN");
    const representedRanks = options.map((candidate) => candidate.validation.jokerMap.joker.rank);
    expect(representedRanks).toContain(Rank.ACE);
    expect(representedRanks).toContain(Rank.FOUR);

    const state = testState(cards, { hand: cards.map((card) => card.id), opened: true });
    expect(applyAction(state, {
      type: "LAY_MELD",
      player: 0,
      cardIds: ["joker", "2s", "3s"],
      kind: "RUN",
      aceMode: "LOW",
      jokerMap: { joker: { rank: Rank.FOUR, suit: Suit.SPADES } },
    }).ok).toBe(true);
    expect(state.tableMelds[0].jokerMap.joker.rank).toBe(Rank.FOUR);
  });

  it("rejects a forged Joker identity without mutating state", () => {
    const cards = [joker(), c("2s", Rank.TWO, Suit.SPADES), c("3s", Rank.THREE, Suit.SPADES), c("f", Rank.FIVE, Suit.CLUBS)];
    const state = testState(cards, { hand: cards.map((card) => card.id), opened: true });
    const before = structuredClone(state);
    expect(applyAction(state, {
      type: "LAY_MELD",
      player: 0,
      cardIds: ["joker", "2s", "3s"],
      kind: "RUN",
      aceMode: "LOW",
      jokerMap: { joker: { rank: Rank.KING, suit: Suit.SPADES } },
    })).toMatchObject({ ok: false });
    expect(state).toEqual(before);
  });
});

describe("burning", () => {
  it("keeps a three-card set active, then burns it when the fourth suit is added", () => {
    const cards = [
      c("qc", Rank.QUEEN, Suit.CLUBS), c("qd", Rank.QUEEN, Suit.DIAMONDS),
      c("qh", Rank.QUEEN, Suit.HEARTS), c("qs", Rank.QUEEN, Suit.SPADES), c("f", Rank.TWO, Suit.CLUBS),
    ];
    const active: Meld = { id: "set", owner: 1, kind: "SET", cardIds: ["qc", "qd", "qh"], jokerMap: {} };
    const state = testState(cards, { hand: ["qs", "f"], opened: true, melds: [active] });
    expect(state.tableMelds).toHaveLength(1);
    expect(applyAction(state, { type: "ADD_TO_MELD", player: 0, meldId: "set", cardIds: ["qs"] }).ok).toBe(true);
    expect(state.tableMelds).toHaveLength(0);
    expect(state.discard).toEqual(expect.arrayContaining(["qc", "qd", "qh", "qs"]));
    expect(state.phase).toBe("ACTION");
  });

  it("burns a four-card set immediately and burns a contained Joker", () => {
    const cards = [
      c("5c", Rank.FIVE, Suit.CLUBS), c("5d", Rank.FIVE, Suit.DIAMONDS),
      joker(), c("5s", Rank.FIVE, Suit.SPADES), c("f", Rank.TWO, Suit.CLUBS),
    ];
    const state = testState(cards, { hand: cards.map((card) => card.id), opened: true });
    expect(applyAction(state, { type: "LAY_MELD", player: 0, cardIds: ["5c", "5d", "joker", "5s"] }).ok).toBe(true);
    expect(state.tableMelds).toHaveLength(0);
    expect(state.discard).toContain("joker");
    expect(state.playersPrivate[0].hand).toEqual(["f"]);
  });

  it("burns a complete thirteen-card run and still requires a normal discard", () => {
    const runRanks = [Rank.ACE, Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN,
      Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING];
    const run = runRanks.map((rank, index) => c(`run-${index}`, rank, Suit.HEARTS));
    const filler = c("filler", Rank.TWO, Suit.CLUBS);
    const state = testState([...run, filler], { hand: [...run.map((card) => card.id), filler.id], opened: true });
    expect(applyAction(state, { type: "LAY_MELD", player: 0, cardIds: run.map((card) => card.id), kind: "RUN", aceMode: "LOW" }).ok).toBe(true);
    expect(state.tableMelds).toHaveLength(0);
    expect(state.discard).toEqual(expect.arrayContaining(run.map((card) => card.id)));
    expect(state.phase).toBe("ACTION");
    expect(applyAction(state, { type: "PASS_ACTION", player: 0 }).ok).toBe(true);
    expect(state.phase).toBe("DISCARD");
    expect(applyAction(state, { type: "DISCARD", player: 0, cardId: [filler.id] }).ok).toBe(true);
    expect(state.winner).toBe(0);
  });

  it("burns a 2-through-K run when an Ace is added without a stored Ace-end choice", () => {
    const ranks = [Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN,
      Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING];
    const run = ranks.map((rank, index) => c(`high-${index}`, rank, Suit.SPADES));
    const ace = c("high-ace", Rank.ACE, Suit.SPADES);
    const filler = c("high-filler", Rank.THREE, Suit.CLUBS);
    const meld: Meld = { id: "almost-complete", owner: 1, kind: "RUN", cardIds: run.map((card) => card.id), jokerMap: {} };
    const state = testState([...run, ace, filler], { hand: [ace.id, filler.id], opened: true, melds: [meld] });
    expect(applyAction(state, { type: "ADD_TO_MELD", player: 0, meldId: meld.id, cardIds: [ace.id] })).toEqual({ ok: true });
    expect(state.tableMelds).toHaveLength(0);
    expect(state.discard).toEqual(expect.arrayContaining([...run.map((card) => card.id), ace.id]));
  });
});

describe("winning and mandatory discard", () => {
  it("wins only after discarding the final card", () => {
    const card = c("last", Rank.TWO, Suit.CLUBS);
    const state = testState([card], { hand: [card.id], opened: true, phase: "DISCARD" });
    expect(applyAction(state, { type: "DISCARD", player: 0, cardId: [card.id] }).ok).toBe(true);
    expect(state.phase).toBe("GAME_OVER");
    expect(state.winner).toBe(0);
  });

  it("rejects melding the entire hand", () => {
    const cards = [c("3c", Rank.THREE, Suit.CLUBS), c("3d", Rank.THREE, Suit.DIAMONDS), c("3h", Rank.THREE, Suit.HEARTS)];
    const state = testState(cards, { hand: cards.map((card) => card.id), opened: true });
    expect(applyAction(state, { type: "LAY_MELD", player: 0, cardIds: cards.map((card) => card.id) })).toMatchObject({ ok: false });
  });

  it("supports multiple actions before a legal winning discard", () => {
    const cards = [
      c("3c", Rank.THREE, Suit.CLUBS), c("3d", Rank.THREE, Suit.DIAMONDS), c("3h", Rank.THREE, Suit.HEARTS),
      c("4c", Rank.FOUR, Suit.CLUBS), c("4d", Rank.FOUR, Suit.DIAMONDS), c("4h", Rank.FOUR, Suit.HEARTS),
      c("last", Rank.ACE, Suit.SPADES),
    ];
    const state = testState(cards, { hand: cards.map((card) => card.id), opened: true });
    expect(applyAction(state, { type: "LAY_MELD", player: 0, cardIds: ["3c", "3d", "3h"] }).ok).toBe(true);
    expect(state.phase).toBe("ACTION");
    expect(applyAction(state, { type: "LAY_MELD", player: 0, cardIds: ["4c", "4d", "4h"] }).ok).toBe(true);
    expect(applyAction(state, { type: "PASS_ACTION", player: 0 }).ok).toBe(true);
    expect(applyAction(state, { type: "DISCARD", player: 0, cardId: ["last"] }).ok).toBe(true);
    expect(state.winner).toBe(0);
  });
});

describe("draw-pile recycling and card identity", () => {
  it("builds 106 uniquely identified physical cards", () => {
    const state = initGame(2, { random: () => 0.5 });
    expect(Object.keys(state.cardsById)).toHaveLength(106);
    expect(new Set(Object.keys(state.cardsById)).size).toBe(106);
  });

  it("recycles trash while preserving its top card without loss or duplication", () => {
    const cards = [
      c("top", Rank.ACE, Suit.SPADES), c("old1", Rank.TWO, Suit.CLUBS),
      c("old2", Rank.THREE, Suit.CLUBS), c("h", Rank.FOUR, Suit.CLUBS),
    ];
    const state = testState(cards, { hand: ["h"], discard: ["old1", "old2", "top"], drawPile: [], phase: "DRAW" });
    const before = new Set([...state.playersPrivate[0].hand, ...state.discard, ...state.drawPile]);
    expect(applyAction(state, { type: "DRAW_DECK", player: 0 }).ok).toBe(true);
    expect(state.discard).toEqual(["top"]);
    const afterLocations = [...state.playersPrivate[0].hand, ...state.discard, ...state.drawPile];
    expect(new Set(afterLocations)).toEqual(before);
    expect(afterLocations).toHaveLength(before.size);
  });
});

describe("whole-game invariants", () => {
  it.each([2, 3, 4])("keeps every physical card valid during deterministic %i-player bot play", (players) => {
    let seed = 0x51cafe + players;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const state = initGame(players, { random });
    let steps = 0;
    while (state.phase !== "GAME_OVER" && steps < 300) {
      const result = botStep(state, state.currentTurn);
      expect(result).toEqual({ ok: true });
      expect(validateStateInvariants(state)).toEqual([]);
      steps++;
    }
    expect(steps).toBeGreaterThan(20);
  }, 15_000);
});

describe("multiplayer authority and hidden information", () => {
  it("projects only the viewer's hand and publicly known cards", () => {
    const state = initGame(3, { random: () => 0 });
    const view = createPlayerView(state, 0);
    expect(view.ownHand).toEqual(state.playersPrivate[0].hand);
    for (const hiddenId of state.playersPrivate[1].hand) expect(view.cardsById[hiddenId]).toBeUndefined();
    for (const hiddenId of state.drawPile) expect(view.cardsById[hiddenId]).toBeUndefined();
    expect("playersPrivate" in view).toBe(false);
    expect("drawPile" in view).toBe(false);
  });

  it("derives action ownership from the authenticated player", () => {
    const game = new AuthoritativeGame(2, { random: () => 0 });
    expect(game.viewFor(0).currentTurn).toBe(0);
    const wrongPlayer = game.dispatch(1, { type: "DRAW_DECK" });
    expect(wrongPlayer.result).toMatchObject({ ok: false });
    expect(wrongPlayer.view.ownHand).toHaveLength(14);
    const currentPlayer = game.dispatch(0, { type: "DRAW_DECK" });
    expect(currentPlayer.result).toEqual({ ok: true });
    expect(currentPlayer.view.ownHand).toHaveLength(15);
  });

  it("keeps action-phase changes private and rollbackable until the final discard", () => {
    const game = new AuthoritativeGame(2, { random: () => 0 });
    expect(game.dispatch(0, { type: "DRAW_DECK" }).result).toEqual({ ok: true });
    expect(game.dispatch(0, { type: "PASS_ACTION" }).result).toEqual({ ok: true });
    expect(game.viewFor(0).phase).toBe("DISCARD");
    expect(game.viewFor(1).phase).toBe("ACTION");

    expect(game.resetTurnActions(0).phase).toBe("ACTION");
    expect(game.dispatch(0, { type: "PASS_ACTION" }).result).toEqual({ ok: true });
    const discardId = game.viewFor(0).ownHand[0];
    expect(game.dispatch(0, { type: "DISCARD", cardId: [discardId] }).result).toEqual({ ok: true });
    expect(game.viewFor(1).phase).toBe("DRAW");
    expect(game.viewFor(1).currentTurn).toBe(1);
  });

  it("coordinates private invites and matchmaking without exposing server state", () => {
    let value = 0.123;
    const service = new LobbyService(() => (value = (value + 0.173) % 1));
    const created = service.createPrivateLobby("host", "Host", { maxPlayers: 3 });
    expect(created.invitePath).toContain(created.inviteCode);
    const joined = service.joinPrivateLobby(created.inviteCode, "friend", "Friend");
    expect(joined.seats).toHaveLength(2);
    expect(() => service.start(created.id, "friend")).toThrow(/host/i);
    const withBot = service.addBot(created.id, "host");
    expect(withBot.seats).toHaveLength(3);
    const started = service.start(created.id, "host");
    expect(started.status).toBe("PLAYING");
    expect(started.game).not.toBeNull();

    const first = service.joinMatchmaking("a", "A", 2);
    expect(first.status).toBe("WAITING");
    const second = service.joinMatchmaking("b", "B", 2);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("PLAYING");
  });

  it("advances bot seats and exposes transactional reset through the lobby", () => {
    const service = new LobbyService(() => 0.99);
    const created = service.createPrivateLobby("host", "Host", { maxPlayers: 2 });
    service.addBot(created.id, "host");
    const started = service.start(created.id, "host");
    expect(started.game?.currentTurn).toBe(0);
    expect(started.game?.turnNumber).toBe(2);

    expect(service.dispatch(created.id, "host", { type: "DRAW_DECK" }).result).toEqual({ ok: true });
    expect(service.dispatch(created.id, "host", { type: "PASS_ACTION" }).result).toEqual({ ok: true });
    expect(service.getLobby(created.id, "host").game?.phase).toBe("DISCARD");
    expect(service.resetTurnActions(created.id, "host").game?.phase).toBe("ACTION");
  });
});
