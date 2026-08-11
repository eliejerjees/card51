import type { PlayerActionRequest } from "../engine/authority";
import type { PlayerGameView } from "../engine/playerView";
import type { LobbySettings, LobbySnapshot } from "./lobbyService";

/** Messages accepted by a future HTTP/WebSocket adapter. Identity comes from its authenticated session. */
export type ClientMessage =
  | { type: "CREATE_PRIVATE"; displayName: string; settings?: Partial<LobbySettings> }
  | { type: "JOIN_PRIVATE"; inviteCode: string; displayName: string }
  | { type: "JOIN_MATCHMAKING"; displayName: string; maxPlayers?: 2 | 3 | 4 }
  | { type: "ADD_BOT"; lobbyId: string; displayName?: string }
  | { type: "START_GAME"; lobbyId: string }
  | { type: "GAME_ACTION"; lobbyId: string; request: PlayerActionRequest }
  | { type: "RESET_TURN"; lobbyId: string }
  | { type: "GET_LOBBY"; lobbyId: string };

/** Only player-safe projections are sent; authoritative GameState never crosses the boundary. */
export type ServerMessage =
  | { type: "LOBBY_STATE"; lobby: LobbySnapshot }
  | { type: "GAME_STATE"; lobbyId: string; game: PlayerGameView }
  | { type: "ACTION_REJECTED"; lobbyId: string; error: string; game: PlayerGameView }
  | { type: "ERROR"; error: string };
