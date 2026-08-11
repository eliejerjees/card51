import type { IncomingMessage, ServerResponse } from "node:http";
import type { PlayerActionRequest } from "../src/engine/authority.js";
import { LobbyService } from "../src/online/lobbyService.js";

const friendsLobbies = new LobbyService();

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  if (!body) return {};
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request body.");
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

/** Handles a single `/api/friends/*` request. Shared by the Vite dev middleware and the Vercel function. */
export async function handleFriendsRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://card51.local");
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "POST" && url.pathname === "/api/friends/create") {
      const body = await readJson(request);
      const maxPlayers = Number(body.maxPlayers ?? 4);
      if (![2, 3, 4].includes(maxPlayers)) throw new Error("Choose between two and four players.");
      const turnTimeLimitMs = body.turnTimeLimitMs === null ? null : Number(body.turnTimeLimitMs ?? 60_000);
      if (turnTimeLimitMs !== null && ![30_000, 60_000, 90_000, 120_000].includes(turnTimeLimitMs)) throw new Error("Choose a supported turn time limit.");
      const scoringMode = body.scoringMode === "VALUES" ? "VALUES" : "ROUNDS";
      const lobby = friendsLobbies.createPrivateLobby(
        requireString(body.userId, "User ID"),
        requireString(body.displayName, "Display name"),
        { maxPlayers: maxPlayers as 2 | 3 | 4, turnTimeLimitMs, scoringMode },
      );
      return sendJson(response, 201, { lobby });
    }

    if (request.method === "POST" && url.pathname === "/api/friends/join") {
      const body = await readJson(request);
      const lobby = friendsLobbies.joinPrivateLobby(
        requireString(body.inviteCode, "Invite code"),
        requireString(body.userId, "User ID"),
        requireString(body.displayName, "Display name"),
      );
      return sendJson(response, 200, { lobby });
    }

    const lobbyId = parts[2];
    const operation = parts[3];
    if (!lobbyId) throw new Error("Lobby ID is required.");

    if (request.method === "GET" && !operation) {
      const userId = requireString(url.searchParams.get("userId"), "User ID");
      return sendJson(response, 200, { lobby: friendsLobbies.getLobby(lobbyId, userId) });
    }

    if (request.method === "POST" && operation === "bots") {
      const body = await readJson(request);
      const lobby = friendsLobbies.addBot(lobbyId, requireString(body.userId, "User ID"));
      return sendJson(response, 200, { lobby });
    }

    if (request.method === "POST" && operation === "remove") {
      const body = await readJson(request);
      const lobby = friendsLobbies.removeSeat(
        lobbyId,
        requireString(body.userId, "User ID"),
        requireString(body.targetUserId, "Target user ID"),
      );
      return sendJson(response, 200, { lobby });
    }

    if (request.method === "POST" && operation === "settings") {
      const body = await readJson(request);
      const turnTimeLimitMs = body.turnTimeLimitMs === null ? null : Number(body.turnTimeLimitMs);
      if (turnTimeLimitMs !== null && ![30_000, 60_000, 90_000, 120_000].includes(turnTimeLimitMs)) throw new Error("Choose a supported turn time limit.");
      const scoringMode = body.scoringMode === "VALUES" ? "VALUES" : "ROUNDS";
      const lobby = friendsLobbies.updateSettings(
        lobbyId,
        requireString(body.userId, "User ID"),
        { turnTimeLimitMs, scoringMode },
      );
      return sendJson(response, 200, { lobby });
    }

    if (request.method === "POST" && operation === "start") {
      const body = await readJson(request);
      const lobby = friendsLobbies.start(lobbyId, requireString(body.userId, "User ID"));
      return sendJson(response, 200, { lobby });
    }

    if (request.method === "POST" && operation === "return") {
      const body = await readJson(request);
      const lobby = friendsLobbies.returnToLobby(lobbyId, requireString(body.userId, "User ID"));
      return sendJson(response, 200, { lobby });
    }

    if (request.method === "POST" && operation === "leave") {
      const body = await readJson(request);
      friendsLobbies.leave(lobbyId, requireString(body.userId, "User ID"));
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && operation === "action") {
      const body = await readJson(request);
      const userId = requireString(body.userId, "User ID");
      if (!body.request || typeof body.request !== "object" || Array.isArray(body.request)) throw new Error("Game action is required.");
      const dispatch = friendsLobbies.dispatch(lobbyId, userId, body.request as PlayerActionRequest);
      if (!dispatch.result.ok) throw new Error(dispatch.result.error);
      return sendJson(response, 200, { lobby: friendsLobbies.getLobby(lobbyId, userId) });
    }

    if (request.method === "POST" && operation === "reset") {
      const body = await readJson(request);
      const userId = requireString(body.userId, "User ID");
      friendsLobbies.resetTurnActions(lobbyId, userId);
      return sendJson(response, 200, { lobby: friendsLobbies.getLobby(lobbyId, userId) });
    }

    return sendJson(response, 404, { error: "Friends endpoint not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The friends request failed.";
    return sendJson(response, 400, { error: message });
  }
}
