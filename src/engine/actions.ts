import type { AceMode, CardID, MeldKind, PlayerID } from "./types";
import type { JokerRep } from "./groupValidator";

export type MeldProposal = {
  cardIds: CardID[];
  kind?: MeldKind;
  aceMode?: AceMode;
  jokerMap?: Record<CardID, JokerRep>;
};

export type MeldInput = CardID[] | MeldProposal;

export type Action =
  | { type: "DRAW_DECK"; player: PlayerID }
  | { type: "DRAW_DISCARD"; player: PlayerID }
  | { type: "OPEN_GROUP"; player: PlayerID; cardIds: CardID[] }
  | { type: "OPEN_MULTI"; player: PlayerID; groups: MeldInput[] }
  | ({ type: "LAY_MELD"; player: PlayerID } & MeldProposal)
  | ({ type: "ADD_TO_MELD"; player: PlayerID; meldId: string } & MeldProposal)
  | { type: "SWAP_JOKER"; player: PlayerID; meldId: string; jokerId: CardID; replaceWithId: CardID }
  | { type: "DISCARD"; player: PlayerID; cardId: CardID[] } // keep array to make UI wiring easier
  | { type: "PASS_ACTION"; player: PlayerID };
