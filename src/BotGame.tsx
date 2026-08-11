import { useCallback, useEffect, useRef, useState } from "react";
import { BOT_ACTION_DELAY_MS, chooseBotAction } from "./engine/bot";
import { AuthoritativeGame, type PlayerActionRequest } from "./engine/authority";
import type { PlayerGameView } from "./engine/playerView";
import { GameTable } from "./GameTable";

const HUMAN_ID = 0;
export type BotGameSession = { authority: AuthoritativeGame };

export function BotGame({ numPlayers, session, onSessionChange, onLeave, onSettings }: { numPlayers: number; session: BotGameSession; onSessionChange: (authority: AuthoritativeGame) => void; onLeave: () => void; onSettings: () => void }) {
  const authorityRef = useRef(session.authority);
  const [game, setGame] = useState<PlayerGameView>(() => session.authority.viewFor(HUMAN_ID));

  const dispatch = useCallback(async (request: PlayerActionRequest): Promise<PlayerGameView> => {
    const { result } = authorityRef.current.dispatch(HUMAN_ID, request);
    if (!result.ok) throw new Error(result.error);
    const view = authorityRef.current.viewFor(HUMAN_ID);
    setGame(view);
    return view;
  }, []);

  const reset = useCallback(async (): Promise<PlayerGameView> => {
    const view = authorityRef.current.resetTurnActions(HUMAN_ID);
    setGame(view);
    return view;
  }, []);

  useEffect(() => {
    if (game.phase === "GAME_OVER" || game.currentTurn === HUMAN_ID) return;
    const timer = window.setTimeout(() => {
      const player = game.currentTurn;
      const action = chooseBotAction(authorityRef.current.viewFor(player));
      if (!action) return;
      const { result } = authorityRef.current.dispatch(player, action as PlayerActionRequest);
      if (result.ok) setGame(authorityRef.current.viewFor(HUMAN_ID));
    }, BOT_ACTION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [game]);

  const newGame = () => {
    authorityRef.current = new AuthoritativeGame(numPlayers);
    onSessionChange(authorityRef.current);
    setGame(authorityRef.current.viewFor(HUMAN_ID));
  };

  return <GameTable
    game={game}
    players={Array.from({ length: numPlayers }, (_, id) => ({ id, name: id === HUMAN_ID ? "You" : `Player ${id + 1}`, avatar: id === HUMAN_ID ? "YOU" : `P${id + 1}` }))}
    modeLabel={`You vs ${numPlayers - 1} ${numPlayers === 2 ? "bot" : "bots"}`}
    onAction={dispatch}
    onResetTurn={reset}
    onLeave={onLeave}
    onSettings={onSettings}
    onNewGame={newGame}
    onPlayAgain={newGame}
  />;
}
