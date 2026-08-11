import { AuthoritativeGame, type DispatchResult, type PlayerActionRequest } from "../engine/authority.js";
import { BOT_ACTION_DELAY_MS, chooseBotAction } from "../engine/bot.js";
import { secureRandom } from "../engine/deckFactory.js";
import type { PlayerGameView } from "../engine/playerView.js";

export type LobbyVisibility = "PRIVATE" | "MATCHMAKING";
export type LobbyStatus = "WAITING" | "PLAYING" | "FINISHED";

export type LobbySettings = {
  maxPlayers: 2 | 3 | 4;
  turnTimeLimitMs: number | null;
  scoringMode: "ROUNDS" | "VALUES";
};

export type LobbySeat = {
  userId: string;
  displayName: string;
  isBot: boolean;
  replacedHuman: boolean;
  consecutiveTimeouts: number;
  wins: number;
  score: number;
};

export type LobbySnapshot = {
  id: string;
  inviteCode: string;
  invitePath: string;
  visibility: LobbyVisibility;
  status: LobbyStatus;
  hostUserId: string;
  settings: LobbySettings;
  turnDeadlineAt: number | null;
  roundNumber: number;
  seats: LobbySeat[];
  game: PlayerGameView | null;
};

type LobbyRecord = Omit<LobbySnapshot, "invitePath" | "game"> & {
  game: AuthoritativeGame | null;
  nextBotActionAt: number | null;
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

  public constructor(random: () => number = secureRandom) {
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
    if (lobby.roundNumber > 0) throw new Error("Seats cannot change after a match has started.");
    if (lobby.seats.length >= lobby.settings.maxPlayers) throw new Error("The lobby is full.");
    lobby.seats.push({
      userId: `bot-${this.#nextBotId++}`,
      displayName: displayName?.trim() || `Bot ${lobby.seats.filter((seat) => seat.isBot).length + 1}`,
      isBot: true,
      replacedHuman: false,
      consecutiveTimeouts: 0,
      wins: 0,
      score: 0,
    });
    return this.snapshot(lobby, requestingUserId);
  }

  public removeSeat(lobbyId: string, requestingUserId: string, targetUserId: string): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.hostUserId !== requestingUserId) throw new Error("Only the lobby host may remove players.");
    if (lobby.status !== "WAITING" || lobby.roundNumber > 0) throw new Error("Seats can only be removed before the first round.");
    if (targetUserId === lobby.hostUserId) throw new Error("The host cannot remove their own seat.");
    const target = lobby.seats.findIndex((seat) => seat.userId === targetUserId);
    if (target < 0) throw new Error("That player is not in the lobby.");
    lobby.seats.splice(target, 1);
    return this.snapshot(lobby, requestingUserId);
  }

  public updateSettings(
    lobbyId: string,
    requestingUserId: string,
    settings: Pick<LobbySettings, "turnTimeLimitMs" | "scoringMode">,
  ): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.hostUserId !== requestingUserId) throw new Error("Only the lobby host may change table rules.");
    if (lobby.status !== "WAITING" || lobby.roundNumber > 0) throw new Error("Table rules can only be changed before the first round.");
    lobby.settings.turnTimeLimitMs = settings.turnTimeLimitMs;
    lobby.settings.scoringMode = settings.scoringMode;
    return this.snapshot(lobby, requestingUserId);
  }

  public start(lobbyId: string, requestingUserId: string): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.hostUserId !== requestingUserId) throw new Error("Only the lobby host may start the game.");
    this.startRecord(lobby);
    return this.snapshot(lobby, requestingUserId);
  }

  public leave(lobbyId: string, userId: string): void {
    const lobby = this.requireLobby(lobbyId);
    const player = lobby.seats.findIndex((seat) => seat.userId === userId);
    if (player < 0) return;

    if (lobby.status === "WAITING") {
      lobby.seats.splice(player, 1);
      if (lobby.seats.length === 0) {
        this.#lobbies.delete(lobbyId);
        return;
      }
      if (lobby.hostUserId === userId) lobby.hostUserId = lobby.seats.find((seat) => !seat.isBot)?.userId ?? lobby.seats[0].userId;
      return;
    }

    if (lobby.status !== "PLAYING" || !lobby.game || lobby.seats[player].isBot) return;
    lobby.seats[player].isBot = true;
    lobby.seats[player].replacedHuman = true;
    lobby.seats[player].consecutiveTimeouts = 3;
    if (this.finishIfLastHuman(lobby)) return;
    if (lobby.game.viewFor(0).currentTurn === player) {
      lobby.game.completeTimedOutTurn(player, `${lobby.seats[player].displayName} left the game; their turn was completed automatically.`);
    } else {
      lobby.game.noteEvent("TIMEOUT", `${lobby.seats[player].displayName} left the game.`, player);
    }
    this.scheduleBotAction(lobby);
    this.resetTurnDeadline(lobby);
  }

  public returnToLobby(lobbyId: string, userId: string): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (!lobby.seats.some((seat) => seat.userId === userId)) throw new Error("This user is not in the lobby.");
    if (lobby.status !== "FINISHED") throw new Error("The current round has not finished.");
    lobby.status = "WAITING";
    lobby.game = null;
    lobby.turnDeadlineAt = null;
    lobby.nextBotActionAt = null;
    return this.snapshot(lobby, userId);
  }

  public resetTurnActions(lobbyId: string, userId: string): LobbySnapshot {
    const lobby = this.requireActiveLobby(lobbyId);
    const player = this.requireHumanPlayer(lobby, userId);
    lobby.game.resetTurnActions(player);
    return this.snapshot(lobby, userId);
  }

  public dispatch(lobbyId: string, userId: string, request: PlayerActionRequest): DispatchResult {
    const lobby = this.requireActiveLobby(lobbyId);
    this.advanceExpiredTurn(lobby);
    const player = this.requireHumanPlayer(lobby, userId);
    const turnBefore = lobby.game.viewFor(player).turnNumber;
    const response = lobby.game.dispatch(player, request);
    if (response.result.ok && lobby.status === "PLAYING" && lobby.game.viewFor(player).turnNumber !== turnBefore) {
      lobby.seats[player].consecutiveTimeouts = 0;
      this.resetTurnDeadline(lobby);
    }
    if (lobby.game.viewFor(player).phase === "GAME_OVER") this.finishRound(lobby);
    else if (response.result.ok) this.scheduleBotAction(lobby);
    return { result: response.result, view: lobby.game.viewFor(player) };
  }

  public getLobby(lobbyId: string, userId: string): LobbySnapshot {
    const lobby = this.requireLobby(lobbyId);
    if (lobby.status === "PLAYING" && lobby.game) {
      const activeLobby = lobby as LobbyRecord & { game: AuthoritativeGame };
      this.advanceExpiredTurn(activeLobby);
      if (lobby.status === "PLAYING") this.advanceDueBot(activeLobby);
    }
    return this.snapshot(lobby, userId);
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
      settings: { maxPlayers, turnTimeLimitMs: settings.turnTimeLimitMs === undefined ? 60_000 : settings.turnTimeLimitMs, scoringMode: settings.scoringMode ?? "ROUNDS" },
      turnDeadlineAt: null,
      roundNumber: 0,
      seats: [{ userId, displayName, isBot: false, replacedHuman: false, consecutiveTimeouts: 0, wins: 0, score: 0 }],
      game: null,
      nextBotActionAt: null,
    };
    this.#lobbies.set(id, lobby);
    return lobby;
  }

  private joinLobby(lobby: LobbyRecord, userId: string, displayName: string): void {
    assertUser(userId, displayName);
    if (lobby.status !== "WAITING") throw new Error("The lobby has already started.");
    if (lobby.roundNumber > 0) throw new Error("Seats cannot change after a match has started.");
    if (lobby.seats.some((seat) => seat.userId === userId)) throw new Error("This user is already in the lobby.");
    if (lobby.seats.length >= lobby.settings.maxPlayers) throw new Error("The lobby is full.");
    lobby.seats.push({ userId, displayName, isBot: false, replacedHuman: false, consecutiveTimeouts: 0, wins: 0, score: 0 });
  }

  private startRecord(lobby: LobbyRecord): void {
    if (lobby.status !== "WAITING") throw new Error("The lobby has already started.");
    if (lobby.seats.length < 2) throw new Error("At least two players are required.");
    lobby.roundNumber += 1;
    lobby.game = new AuthoritativeGame(lobby.seats.length, {
      random: this.#random,
      turnTimeLimitMs: lobby.settings.turnTimeLimitMs,
    });
    lobby.status = "PLAYING";
    this.scheduleBotAction(lobby);
    this.resetTurnDeadline(lobby);
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

  private scheduleBotAction(lobby: LobbyRecord): void {
    const game = lobby.game;
    if (!game || lobby.status !== "PLAYING") {
      lobby.nextBotActionAt = null;
      return;
    }
    const observer = game.viewFor(0);
    lobby.nextBotActionAt = observer.phase !== "GAME_OVER" && lobby.seats[observer.currentTurn]?.isBot
      ? Date.now() + BOT_ACTION_DELAY_MS
      : null;
  }

  private advanceDueBot(lobby: LobbyRecord & { game: AuthoritativeGame }): void {
    const observer = lobby.game.viewFor(0);
    if (observer.phase === "GAME_OVER") {
      this.finishRound(lobby);
      return;
    }
    if (!lobby.seats[observer.currentTurn]?.isBot) {
      lobby.nextBotActionAt = null;
      return;
    }
    if (lobby.nextBotActionAt === null) {
      this.scheduleBotAction(lobby);
      return;
    }
    if (Date.now() < lobby.nextBotActionAt) return;

    const action = chooseBotAction(lobby.game.viewFor(observer.currentTurn));
    if (!action) throw new Error("The bot could not choose a legal action.");
    const request = Object.fromEntries(
      Object.entries(action).filter(([key]) => key !== "player"),
    ) as PlayerActionRequest;
    const response = lobby.game.dispatch(observer.currentTurn, request);
    if (!response.result.ok) throw new Error(`Bot action failed: ${response.result.error}`);

    if (lobby.game.viewFor(0).phase === "GAME_OVER") this.finishRound(lobby);
    else {
      this.scheduleBotAction(lobby);
      this.resetTurnDeadline(lobby);
    }
  }

  private finishRound(lobby: LobbyRecord): void {
    if (lobby.status === "FINISHED" || !lobby.game) return;
    const view = lobby.game.viewFor(0);
    if (view.phase !== "GAME_OVER" || view.winner === null) return;
    lobby.seats[view.winner].wins += 1;
    if (lobby.settings.scoringMode === "VALUES") {
      const penalties = lobby.game.roundPenalties();
      lobby.seats.forEach((seat, player) => { seat.score += penalties[player] ?? 0; });
    }
    lobby.status = "FINISHED";
    lobby.turnDeadlineAt = null;
    lobby.nextBotActionAt = null;
  }

  private finishIfLastHuman(lobby: LobbyRecord): boolean {
    if (lobby.status !== "PLAYING" || !lobby.game) return false;
    const activeHumans = lobby.seats
      .map((seat, player) => ({ seat, player }))
      .filter(({ seat }) => !seat.isBot);
    if (activeHumans.length !== 1 || !lobby.seats.some((seat) => seat.replacedHuman)) return false;
    const survivor = activeHumans[0];
    lobby.game.completeByForfeit(
      survivor.player,
      `${survivor.seat.displayName} won as the last active player.`,
    );
    this.finishRound(lobby);
    return true;
  }

  private advanceExpiredTurn(lobby: LobbyRecord & { game: AuthoritativeGame }): void {
    if (lobby.turnDeadlineAt === null || Date.now() < lobby.turnDeadlineAt) return;
    const expiredPlayer = lobby.game.viewFor(0).currentTurn;
    const seat = lobby.seats[expiredPlayer];
    seat.consecutiveTimeouts += 1;
    const replaced = !seat.isBot && seat.consecutiveTimeouts >= 3;
    const message = replaced
      ? `${seat.displayName} timed out for the third consecutive turn and was replaced by a bot.`
      : `${seat.displayName} timed out (${seat.consecutiveTimeouts}/3); their turn was skipped.`;
    lobby.game.completeTimedOutTurn(expiredPlayer, message);
    if (replaced) {
      seat.isBot = true;
      seat.replacedHuman = true;
      if (this.finishIfLastHuman(lobby)) return;
    }
    if (lobby.game.viewFor(0).phase === "GAME_OVER") this.finishRound(lobby);
    else this.scheduleBotAction(lobby);
    this.resetTurnDeadline(lobby);
  }

  private resetTurnDeadline(lobby: LobbyRecord): void {
    const view = lobby.game?.viewFor(0);
    const isHumanTurn = view && !lobby.seats[view.currentTurn]?.isBot;
    lobby.turnDeadlineAt = lobby.status === "PLAYING" && lobby.settings.turnTimeLimitMs !== null && isHumanTurn
      ? Date.now() + lobby.settings.turnTimeLimitMs
      : null;
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
      turnDeadlineAt: lobby.turnDeadlineAt,
      roundNumber: lobby.roundNumber,
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
