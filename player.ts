// src/engine/player.ts
//
// Direct port of your Java Player, minus console printing.
// UI should render hand/groups.

import { Card } from "./card";

export class Player {
  private hand: Card[] = [];
  private opened = false;
  private openGroups: Card[][] = [];

  public addCard(c: Card): void {
    this.hand.push(c);
  }

  public removeCard(c: Card): void {
    const idx = this.hand.indexOf(c);
    if (idx >= 0) this.hand.splice(idx, 1);
  }

  public getHand(): Card[] {
    // return a copy to avoid UI mutating engine state accidentally
    return [...this.hand];
  }

  public hasOpened(): boolean {
    return this.opened;
  }

  public open(): void {
    this.opened = true;
  }

  public addGroup(g: ReadonlyArray<Card>): void {
    this.openGroups.push([...g]);
  }

  public getGroups(): Card[][] {
    // shallow copy of groups
    return this.openGroups.map((g) => [...g]);
  }
}
