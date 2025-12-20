import { CardID, PlayerID } from "./types";

export type Action =
  | { type: "DRAW_DECK"; player: PlayerID }
  | { type: "DRAW_DISCARD"; player: PlayerID }
  | { type: "OPEN_GROUP"; player: PlayerID; cardIds: CardID[] }
  | { type: "LAY_MELD"; player: PlayerID; cardIds: CardID[] }
  | { type: "DISCARD"; player: PlayerID; cardId: CardID[] } // keep array to make UI wiring easier
  | { type: "PASS_ACTION"; player: PlayerID };
