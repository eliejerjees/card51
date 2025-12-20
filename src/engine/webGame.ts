import { Deck } from "./deck";
import { Card } from "./card";
import { Player } from "./player";
import { GameUtils } from "./gameUtils";
import { GroupValidator, AceMode } from "./groupValidator";

export type DrawSource = "DECK" | "DISCARD";
export type Phase = "DRAW" | "OPEN_OR_MELD" | "POST_OPEN_MELD" | "DISCARD" | "GAME_OVER";

export type CandidateGroup = {
  cards: Card[];
  points: number;
  mode?: AceMode; // only meaningful for runs (LOW/HIGH)
  kind: "SET" | "RUN";
};

export class WebGame {
  public readonly deck: Deck;
  public readonly players: Player[];
  public turn = 0;
  public phase: Phase = "DRAW";
  public lastDrawn: Card | null = null;
  public winner: number | null = null;

  constructor(numPlayers: number) {
    this.deck = new Deck();
    this.players = Array.from({ length: numPlayers }, () => new Player());
    this.deal();
  }

  private deal(): void {
    for (const p of this.players) {
      for (let j = 0; j < 14; j++) p.addCard(this.deck.draw());
    }
  }

  public currentPlayer(): Player {
    return this.players[this.turn];
  }

  public canDrawDiscard(): boolean {
    const p = this.currentPlayer();
    return p.hasOpened() && !this.deck.isDiscardEmpty();
  }

  public discardTop(): Card | undefined {
    return this.deck.peekDiscard();
  }

  public draw(source: DrawSource): { ok: boolean; message?: string } {
    if (this.phase !== "DRAW") return { ok: false, message: "Not in DRAW phase." };

    const p = this.currentPlayer();
    let drawn: Card;

    if (source === "DISCARD") {
      if (p.hasOpened() && !this.deck.isDiscardEmpty()) {
        drawn = this.deck.pullDiscard();
      } else {
        drawn = this.deck.draw();
        const msg = !p.hasOpened()
          ? "You have not yet opened. Drew from deck instead."
          : "Discard empty. Drew from deck instead.";
        this.lastDrawn = drawn;
        p.addCard(drawn);
        this.phase = p.hasOpened() ? "POST_OPEN_MELD" : "OPEN_OR_MELD";
        return { ok: true, message: msg };
      }
    } else {
      drawn = this.deck.draw();
    }

    this.lastDrawn = drawn;
    p.addCard(drawn);
    this.phase = p.hasOpened() ? "POST_OPEN_MELD" : "OPEN_OR_MELD";
    return { ok: true };
  }

  /** Opening candidates must contain lastDrawn and have points >= 51 (matches your Java). */
  public getOpenCandidates(): CandidateGroup[] {
    const p = this.currentPlayer();
    if (p.hasOpened() || !this.lastDrawn) return [];

    const hand = p.getHand();
    const drawn = this.lastDrawn;

    const out: CandidateGroup[] = [];

    for (const g of GameUtils.findSets(hand)) {
      if (g.includes(drawn)) {
        const pts = GroupValidator.getGroupPoints(g);
        if (pts >= 51) out.push({ cards: g, points: pts, kind: "SET" });
      }
    }

    for (const mode of [AceMode.LOW, AceMode.HIGH] as const) {
      for (const g of GameUtils.findRuns(hand, mode)) {
        if (g.includes(drawn)) {
          const pts = GroupValidator.getGroupPoints(g);
          if (pts >= 51) out.push({ cards: g, points: pts, kind: "RUN", mode });
        }
      }
    }

    return out;
  }

  /** Post-open meld candidates (any set/run). */
  public getPostOpenCandidates(): CandidateGroup[] {
    const p = this.currentPlayer();
    if (!p.hasOpened()) return [];

    const hand = p.getHand();
    const out: CandidateGroup[] = [];

    for (const g of GameUtils.findSets(hand)) {
      out.push({ cards: g, points: GroupValidator.getGroupPoints(g), kind: "SET" });
    }
    for (const mode of [AceMode.LOW, AceMode.HIGH] as const) {
      for (const g of GameUtils.findRuns(hand, mode)) {
        out.push({ cards: g, points: GroupValidator.getGroupPoints(g), kind: "RUN", mode });
      }
    }
    return out;
  }

  public openWith(group: Card[]): { ok: boolean; message?: string } {
    const p = this.currentPlayer();
    if (p.hasOpened()) return { ok: false, message: "Already opened." };
    if (this.phase !== "OPEN_OR_MELD") return { ok: false, message: "Not in OPEN phase." };
    if (!this.lastDrawn || !group.includes(this.lastDrawn))
      return { ok: false, message: "Opening group must include the drawn card." };

    const pts = GroupValidator.getGroupPoints(group);
    if (pts < 51) return { ok: false, message: "Needs 51+ points to open." };

    if (p.getHand().length - group.length < 1)
      return { ok: false, message: "Must keep one card to discard. Opening canceled." };

    for (const c of group) p.removeCard(c);
    p.addGroup(group);
    p.open();

    this.phase = "DISCARD";
    return { ok: true };
  }

  public layMeld(group: Card[]): { ok: boolean; message?: string } {
    const p = this.currentPlayer();
    if (!p.hasOpened()) return { ok: false, message: "You must open first." };
    if (this.phase !== "POST_OPEN_MELD") return { ok: false, message: "Not in meld phase." };

    if (p.getHand().length - group.length < 1)
      return { ok: false, message: "Must leave one card to discard." };

    // Validate it is actually a valid set OR a valid run (either ace mode)
    const isSet = GroupValidator.isValidSet(group);
    const isRun =
      GroupValidator.isValidRun(group, AceMode.LOW) || GroupValidator.isValidRun(group, AceMode.HIGH);

    if (!isSet && !isRun) return { ok: false, message: "Selected cards are not a valid meld." };

    for (const c of group) p.removeCard(c);
    p.addGroup(group);

    // After optional meld, you still discard
    this.phase = "DISCARD";
    return { ok: true };
  }

  public skipMeld(): void {
    if (this.phase === "OPEN_OR_MELD" || this.phase === "POST_OPEN_MELD") {
      this.phase = "DISCARD";
    }
  }

  public discard(card: Card): { ok: boolean; message?: string } {
    if (this.phase !== "DISCARD") return { ok: false, message: "Not in DISCARD phase." };

    const p = this.currentPlayer();
    p.removeCard(card);
    this.deck.discard(card);

    if (p.getHand().length === 0) {
      this.winner = this.turn;
      this.phase = "GAME_OVER";
      return { ok: true };
    }

    // next turn
    this.turn = (this.turn + 1) % this.players.length;
    this.phase = "DRAW";
    this.lastDrawn = null;
    return { ok: true };
  }
}
