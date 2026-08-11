import { GameTable } from "./GameTable";
import { dispatchFriendAction, resetFriendTurn, returnFriendLobby } from "./online/friendsClient";
import type { LobbySnapshot } from "./online/lobbyService";

export function FriendsGame({ lobby, userId, onLobby, onLeave, onSettings }: { lobby: LobbySnapshot; userId: string; onLobby: (lobby: LobbySnapshot) => void; onLeave: () => void; onSettings: () => void }) {
  if (!lobby.game) throw new Error("A started friend room must include a player-safe game view.");

  return <GameTable
    game={lobby.game}
    players={lobby.seats.map((seat, id) => ({ id, name: seat.displayName, avatar: seat.isBot ? "B" : undefined, statusNote: seat.isBot ? "Bot" : seat.consecutiveTimeouts > 0 ? `Timeout ${seat.consecutiveTimeouts}/3` : undefined, scoreLabel: lobby.settings.scoringMode === "VALUES" ? `${seat.score} pts` : `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` }))}
    modeLabel={`Friends · ${lobby.inviteCode}`}
    turnDeadlineAt={lobby.turnDeadlineAt}
    onAction={async (request) => {
      const updated = await dispatchFriendAction(lobby.id, userId, request);
      if (!updated.game) throw new Error("The room did not return an updated game.");
      onLobby(updated);
      return updated.game;
    }}
    onResetTurn={async () => {
      const updated = await resetFriendTurn(lobby.id, userId);
      if (!updated.game) throw new Error("The room did not return an updated game.");
      onLobby(updated);
      return updated.game;
    }}
    onLeave={onLeave}
    onSettings={onSettings}
    onPlayAgain={async () => onLobby(await returnFriendLobby(lobby.id, userId))}
    playAgainLabel="Return to lobby"
  />;
}
