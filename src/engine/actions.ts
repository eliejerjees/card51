import type { CardID, PlayerID } from "./types";

export type Action =
  | { type: "DRAW_DECK"; player: PlayerID }
  | { type: "DRAW_DISCARD"; player: PlayerID }
  | { type: "OPEN_GROUP"; player: PlayerID; cardIds: CardID[] }
  | { type: "OPEN_MULTI"; player: PlayerID; groups: CardID[][] }
  | { type: "LAY_MELD"; player: PlayerID; cardIds: CardID[] }
  | { type: "ADD_TO_MELD"; player: PlayerID; meldId: string; cardIds: CardID[] }
  | { type: "SWAP_JOKER"; player: PlayerID; meldId: string; jokerId: CardID; replaceWithId: CardID }
  | { type: "DISCARD"; player: PlayerID; cardId: CardID[] } // keep array to make UI wiring easier
  | { type: "PASS_ACTION"; player: PlayerID };
