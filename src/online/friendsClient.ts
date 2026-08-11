import type { LobbySnapshot } from "./lobbyService";
import type { PlayerActionRequest } from "../engine/authority";

type LobbyResponse = { lobby: LobbySnapshot };

async function requestLobby(path: string, init?: RequestInit): Promise<LobbySnapshot> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as Partial<LobbyResponse> & { error?: string };
  if (!response.ok || !payload.lobby) throw new Error(payload.error || "The lobby request failed.");
  return payload.lobby;
}

export function createFriendLobby(userId: string, displayName: string, maxPlayers: 2 | 3 | 4, turnTimeLimitMs: number | null): Promise<LobbySnapshot> {
  return requestLobby("/api/friends/create", {
    method: "POST",
    body: JSON.stringify({ userId, displayName, maxPlayers, turnTimeLimitMs }),
  });
}

export function joinFriendLobby(userId: string, displayName: string, inviteCode: string): Promise<LobbySnapshot> {
  return requestLobby("/api/friends/join", {
    method: "POST",
    body: JSON.stringify({ userId, displayName, inviteCode }),
  });
}

export function getFriendLobby(lobbyId: string, userId: string): Promise<LobbySnapshot> {
  return requestLobby(`/api/friends/${encodeURIComponent(lobbyId)}?userId=${encodeURIComponent(userId)}`);
}

export function addFriendLobbyBot(lobbyId: string, userId: string): Promise<LobbySnapshot> {
  return requestLobby(`/api/friends/${encodeURIComponent(lobbyId)}/bots`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function startFriendLobby(lobbyId: string, userId: string): Promise<LobbySnapshot> {
  return requestLobby(`/api/friends/${encodeURIComponent(lobbyId)}/start`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function dispatchFriendAction(lobbyId: string, userId: string, action: PlayerActionRequest): Promise<LobbySnapshot> {
  return requestLobby(`/api/friends/${encodeURIComponent(lobbyId)}/action`, {
    method: "POST",
    body: JSON.stringify({ userId, request: action }),
  });
}

export function resetFriendTurn(lobbyId: string, userId: string): Promise<LobbySnapshot> {
  return requestLobby(`/api/friends/${encodeURIComponent(lobbyId)}/reset`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}
