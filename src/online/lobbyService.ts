import { AuthoritativeGame, type DispatchResult, type PlayerActionRequest } from "../engine/authority";
import { chooseBotAction } from "../engine/bot";
import type { PlayerGameView } from "../engine/playerView";

export type LobbyVisibility = "PRIVATE" | "MATCHMAKING";
export type LobbyStatus = "WAITING" | "PLAYING" | "FINISHED";

export type LobbySettings = {
  maxPlayers: 2 | 3 | 4;
  turnTimeLimitMs: number | null;
};

export type LobbySeat = {
  userId: string;
  displayName: string;
  isBot: boolean;
};

export type LobbySnapshot = {
  id: string;
  inviteCode: string;
  invitePath: string;
  visibility: LobbyVisibility;
  status: LobbyStatus;
  hostUserId: string;
  settings: LobbySettings;
  seats: LobbySeat[];
  game: PlayerGameView | null;
};

type LobbyRecord = Omit<LobbySnapshot, "invitePath" | "game"> & {
  game: AuthoritativeGame | null;
};

function assertUser(userId: string, displayName: string): void {
  if (!userId.trim() || !displayName.trim()) throw new Error("A user ID and display name are required.");
}

/**
 * Transport-independent in-memory lobby coordinator. A WebSocket/HTTP adapter can
 * call this service without duplicating game rules or exposing authoritative state.
 */
export class LobbyService {
  readonly #lobbies = new Map<string, LobbyRecord>();
  readonly #random: () => number;
  #nextLobbyId = 1;
  #nextBotId = 1;

  public constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  public createPrivateLobby(
    userId: string,
    displayName: string,
    settings: Partial<LobbySettings> = {},
  ): LobbySnapshot {
    return this.createLobby(userId, displayName, "PRIVATE", settings);
  }

  public joinPrivateLobby(inviteCode: string, userId: string, displayName: string): LobbySnapshot {
    const lobby = [...this.#lobbies.values()].find((candidate) => candidate.inviteCode === inviteCode.toUpperCase());
    if (!lobby || lobby.visibility !== "PRIVATE") throw new Error("Lobby not found.");
    this.joinLobby(lobby, userId, displayName);
    return this.snapshot(lobby, userId);
  }

  public joinMatchmaking(
    userId: string,
    displayName: string,
    maxPlayers: 2 | 3 | 4 = 2,
  ): LobbySnapshot {
    assertUser(userId, displayName);
    let lobby = [...this.#lobbies.values()].find((candidate) =>
      candidate.visibility === "MATCHMAKING"
      && candidate.status === "WAITING"
      && candidate.settings.maxPlayers === maxPlayers
      && candidate.seats.length < candidate.settings.maxPlayers,
    );
    if (!lobby) lobby = this.createLobbyRecord(userId, displayName, "MATCHMAKING", { maxPlayers });
    else this.joinLobby(lobby, userId, displayName);
    if (lobby.seats.length === lobby.settings.maxPlayers) this.startRecord(lobby);
    return this.snapshot(lobby, userId);
  }

  public addBot(lobbyId: string, requestingUserId: string, displayName?: string): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.hostUserId !== requestingUserId) throw new Error("Only the lobby host may add bots.");
    if (lobby.status !== "WAITING") throw new Error("Bots can only be added before the game starts.");
    if (lobby.seats.length >= lobby.settings.maxPlayers) throw new Error("The lobby is full.");
    lobby.seats.push({
      userId: `bot-${this.#nextBotId++}`,
      displayName: displayName?.trim() || `Bot ${lobby.seats.filter((seat) => seat.isBot).length + 1}`,
      isBot: true,
    });
    return this.snapshot(lobby, requestingUserId);
  }

  public start(lobbyId: string, requestingUserId: string): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.hostUserId !== requestingUserId) throw new Error("Only the lobby host may start the game.");
    this.startRecord(lobby);
    return this.snapshot(lobby, requestingUserId);
  }

  public resetTurnActions(lobbyId: string, userId: string): LobbySnapshot {
    const lobby = this.requireActiveLobby(lobbyId);
    const player = this.requireHumanPlayer(lobby, userId);
    lobby.game.resetTurnActions(player);
    return this.snapshot(lobby, userId);
  }

  public dispatch(lobbyId: string, userId: string, request: PlayerActionRequest): DispatchResult {
    const lobby = this.requireActiveLobby(lobbyId);
    const player = this.requireHumanPlayer(lobby, userId);
    const response = lobby.game.dispatch(player, request);
    if (response.result.ok) this.advanceBots(lobby);
    if (lobby.game.viewFor(player).phase === "GAME_OVER") lobby.status = "FINISHED";
    return { result: response.result, view: lobby.game.viewFor(player) };
  }

  public getLobby(lobbyId: string, userId: string): LobbySnapshot {
    return this.snapshot(this.requireLobby(lobbyId), userId);
  }

  private createLobby(
    userId: string,
    displayName: string,
    visibility: LobbyVisibility,
    settings: Partial<LobbySettings>,
  ): LobbySnapshot {
    const lobby = this.createLobbyRecord(userId, displayName, visibility, settings);
    return this.snapshot(lobby, userId);
  }

  private createLobbyRecord(
    userId: string,
    displayName: string,
    visibility: LobbyVisibility,
    settings: Partial<LobbySettings>,
  ): LobbyRecord {
    assertUser(userId, displayName);
    const maxPlayers = settings.maxPlayers ?? 4;
    if (![2, 3, 4].includes(maxPlayers)) throw new Error("Lobbies currently support two to four players.");
    const id = `lobby-${this.#nextLobbyId++}`;
    const inviteCode = this.uniqueInviteCode();
    const lobby: LobbyRecord = {
      id,
      inviteCode,
      visibility,
      status: "WAITING",
      hostUserId: userId,
      settings: { maxPlayers, turnTimeLimitMs: settings.turnTimeLimitMs ?? 60_000 },
      seats: [{ userId, displayName, isBot: false }],
      game: null,
    };
    this.#lobbies.set(id, lobby);
    return lobby;
  }

  private joinLobby(lobby: LobbyRecord, userId: string, displayName: string): void {
    assertUser(userId, displayName);
    if (lobby.status !== "WAITING") throw new Error("The lobby has already started.");
    if (lobby.seats.some((seat) => seat.userId === userId)) throw new Error("This user is already in the lobby.");
    if (lobby.seats.length >= lobby.settings.maxPlayers) throw new Error("The lobby is full.");
    lobby.seats.push({ userId, displayName, isBot: false });
  }

  private startRecord(lobby: LobbyRecord): void {
    if (lobby.status !== "WAITING") throw new Error("The lobby has already started.");
    if (lobby.seats.length < 2) throw new Error("At least two players are required.");
    lobby.game = new AuthoritativeGame(lobby.seats.length, {
      random: this.#random,
      turnTimeLimitMs: lobby.settings.turnTimeLimitMs,
    });
    lobby.status = "PLAYING";
    this.advanceBots(lobby);
  }

  private requireLobby(lobbyId: string): LobbyRecord {
    const lobby = this.#lobbies.get(lobbyId);
    if (!lobby) throw new Error("Lobby not found.");
    return lobby;
  }

  private requireActiveLobby(lobbyId: string): LobbyRecord & { game: AuthoritativeGame } {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.status !== "PLAYING" || !lobby.game) throw new Error("This lobby does not have an active game.");
    return lobby as LobbyRecord & { game: AuthoritativeGame };
  }

  private requireHumanPlayer(lobby: LobbyRecord, userId: string): number {
    const player = lobby.seats.findIndex((seat) => seat.userId === userId && !seat.isBot);
    if (player < 0) throw new Error("This user is not a human player in the lobby.");
    return player;
  }

  private advanceBots(lobby: LobbyRecord): void {
    const game = lobby.game;
    if (!game) throw new Error("Cannot advance bots before a game exists.");
    for (let step = 0; step < 500; step++) {
      const observer = game.viewFor(0);
      if (observer.phase === "GAME_OVER") {
        lobby.status = "FINISHED";
        return;
      }
      const botSeat = lobby.seats[observer.currentTurn];
      if (!botSeat?.isBot) return;
      const action = chooseBotAction(game.viewFor(observer.currentTurn));
      if (!action) throw new Error("The bot could not choose a legal action.");
      const request = Object.fromEntries(
        Object.entries(action).filter(([key]) => key !== "player"),
      ) as PlayerActionRequest;
      const response = game.dispatch(observer.currentTurn, request);
      if (!response.result.ok) throw new Error(`Bot action failed: ${response.result.error}`);
    }
    throw new Error("Bot advancement exceeded its safety limit.");
  }

  private snapshot(lobby: LobbyRecord, userId: string): LobbySnapshot {
    const player = lobby.seats.findIndex((seat) => seat.userId === userId);
    if (player < 0) throw new Error("This user is not in the lobby.");
    return {
      id: lobby.id,
      inviteCode: lobby.inviteCode,
      invitePath: `/?lobby=${encodeURIComponent(lobby.inviteCode)}`,
      visibility: lobby.visibility,
      status: lobby.status,
      hostUserId: lobby.hostUserId,
      settings: { ...lobby.settings },
      seats: structuredClone(lobby.seats),
      game: lobby.game ? lobby.game.viewFor(player) : null,
    };
  }

  private uniqueInviteCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let index = 0; index < 6; index++) code += alphabet[Math.floor(this.#random() * alphabet.length)];
      if (![...this.#lobbies.values()].some((lobby) => lobby.inviteCode === code)) return code;
    }
    throw new Error("Could not allocate a unique invite code.");
  }
}
