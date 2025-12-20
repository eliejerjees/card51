import React, { useState, useEffect } from 'react';
import './app.css';
import type { GameState, PlayerID, CardID, CardDTO, Meld } from "./engine/types";
import type { Action } from "./engine/actions";
import { initGame, applyAction } from "./engine/state";
import { botStep } from "./engine/bot";


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function cardLabel(card: CardDTO): string {
  if (card.rank === 'JOKER') return 'JOKER';
  const suitSymbols: Record<string, string> = {
    SPADES: '♠', HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣'
  };
  const rankLabels: Record<string, string> = {
    ACE: 'A', JACK: 'J', QUEEN: 'Q', KING: 'K'
  };
  const rankLabel = rankLabels[card.rank] || card.rank;
  return `${rankLabel}${suitSymbols[card.suit] || ''}`;
}

function cardValue(card: CardDTO): number {
  if (card.rank === 'JOKER') return 0;
  if (['ACE', 'JACK', 'QUEEN', 'KING'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

function selectionPoints(selectedIds: CardID[], state: GameState): number {
  return selectedIds.reduce((sum, id) => sum + cardValue(state.cardsById[id]), 0);
}

function isValidSet(cardIds: CardID[], state: GameState): boolean {
  if (cardIds.length < 3 || cardIds.length > 4) return false;
  const cards = cardIds.map(id => state.cardsById[id]);
  const nonJokers = cards.filter(c => c.rank !== 'JOKER');
  if (nonJokers.length === 0) return false;
  const rank = nonJokers[0].rank;
  if (!nonJokers.every(c => c.rank === rank)) return false;
  const suits = nonJokers.map(c => c.suit);
  return new Set(suits).size === suits.length;
}

function isValidRun(cardIds: CardID[], state: GameState): boolean {
  if (cardIds.length < 3) return false;
  const cards = cardIds.map(id => state.cardsById[id]);
  const nonJokers = cards.filter(c => c.rank !== 'JOKER');
  if (nonJokers.length === 0) return false;
  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return false;
  // Simplified run check - engine does full validation
  return true;
}

function isValidMeld(cardIds: CardID[], state: GameState): boolean {
  return isValidSet(cardIds, state) || isValidRun(cardIds, state);
}

// ============================================================================
// COMPONENTS
// ============================================================================

interface CardViewProps {
  card?: CardDTO;              // was CardDTO
  selected?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  size?: "small" | "normal";
}

function CardView({ card, selected, onClick, faceDown, size = "normal" }: CardViewProps) {
  // when faceDown, we do not need a real card
  if (faceDown) {
    return (
      <div className={`card ${selected ? "selected" : ""} face-down ${size}`} onClick={onClick}>
        <div className="card-back">🂠</div>
      </div>
    );
  }

  if (!card) return null; // safety
  const isRed = card.suit === "HEARTS" || card.suit === "DIAMONDS";
  const isJoker = card.rank === "JOKER";

  return (
    <div className={`card ${selected ? "selected" : ""} ${size}`} onClick={onClick}>
      <div className={`card-face ${isRed ? "red" : "black"} ${isJoker ? "joker" : ""}`}>
        {isJoker ? (
          <div className="joker-badge">JOKER</div>
        ) : (
          <>
            <div className="card-corner top-left">{cardLabel(card)}</div>
            <div className="card-center">{cardLabel(card)}</div>
            <div className="card-corner bottom-right">{cardLabel(card)}</div>
          </>
        )}
      </div>
    </div>
  );
}

interface HandProps {
  cardIds: CardID[];
  state: GameState;
  selectedIds: Set<CardID>;
  onToggleCard: (id: CardID) => void;
}

function Hand({ cardIds, state, selectedIds, onToggleCard }: HandProps) {
  return (
    <div className="hand">
      <div className="hand-cards">
        {cardIds.map(id => (
          <CardView
            key={id}
            card={state.cardsById[id]}
            selected={selectedIds.has(id)}
            onClick={() => onToggleCard(id)}
          />
        ))}
      </div>
    </div>
  );
}

interface PileViewProps {
  type: 'deck' | 'discard';
  count?: number;
  topCardId?: CardID;
  state: GameState;
  onDraw?: () => void;
}

function PileView({ type, count = 0, topCardId, state, onDraw }: PileViewProps) {
  return (
    <div className={`pile ${type}`} onClick={onDraw}>
      <div className="pile-label">{type === 'deck' ? 'Draw Pile' : 'Discard'}</div>
      {type === 'deck' ? (
        <div className="pile-cards">
          <CardView faceDown />
          <div className="pile-count">{count}</div>
        </div>
      ) : topCardId ? (
        <CardView card={state.cardsById[topCardId]} />
      ) : (
        <div className="empty-pile">Empty</div>
      )}
    </div>
  );
}

interface MeldZoneProps {
  melds: Meld[];
  state: GameState;
  owner: PlayerID;
}

function MeldZone({ melds, state, owner }: MeldZoneProps) {
  const playerMelds = melds.filter(m => m.owner === owner);
  
  if (playerMelds.length === 0) return null;
  
  return (
    <div className="meld-zone">
      {playerMelds.map(meld => {
        const points = meld.cardIds.reduce((sum, id) => sum + cardValue(state.cardsById[id]), 0);
        return (
          <div key={meld.id} className="meld">
            <div className="meld-cards">
              {meld.cardIds.map(id => (
                <CardView key={id} card={state.cardsById[id]} size="small" />
              ))}
            </div>
            <div className="meld-points">{points} pts</div>
          </div>
        );
      })}
    </div>
  );
}

interface PlayerSeatProps {
  position: 'bottom' | 'left' | 'top' | 'right';
  playerId: PlayerID;
  state: GameState;
  isCurrent: boolean;
  isHuman?: boolean;
}

function PlayerSeat({ position, playerId, state, isCurrent, isHuman }: PlayerSeatProps) {
  const player = state.playersPublic[playerId];
  const opened = player.opened;
  
  return (
    <div className={`player-seat ${position} ${isCurrent ? 'current' : ''}`}>
      <div className="seat-info">
        <div className="player-label">
          {isHuman ? 'You' : `Player ${playerId + 1}`}
          {opened && <span className="opened-badge">✓ Opened</span>}
        </div>
        {!isHuman && (
          <div className="opponent-hand">
            <CardView faceDown size="small" />
            <span className="hand-count">×{player.handCount}</span>
          </div>
        )}
      </div>
      <MeldZone melds={state.tableMelds} state={state} owner={playerId} />
    </div>
  );
}

interface ControlsProps {
  state: GameState;
  selectedIds: Set<CardID>;
  onDrawDeck: () => void;
  onDrawDiscard: () => void;
  onOpen: () => void;
  onLayMeld: () => void;
  onPass: () => void;
  onDiscard: () => void;
}

function Controls({
  state,
  selectedIds,
  onDrawDeck,
  onDrawDiscard,
  onOpen,
  onLayMeld,
  onPass,
  onDiscard
}: ControlsProps) {
  const phase = state.phase;
  const humanId: PlayerID = 0;
  const isHumanTurn = state.currentTurn === humanId;
  const humanOpened = state.playersPublic[humanId].opened;
  const selection = Array.from(selectedIds);
  const points = selectionPoints(selection, state);
  const includesDrawn = state.lastDrawnCardId && selectedIds.has(state.lastDrawnCardId);
  const validMeld = selection.length >= 3 && isValidMeld(selection, state);
  
  if (!isHumanTurn || state.phase === 'GAME_OVER') {
    return null;
  }
  
  return (
    <div className="controls">
      <div className="phase-indicator">
        Phase: <strong>{phase}</strong>
      </div>
      
      {phase === 'DRAW' && (
        <div className="action-buttons">
          <button onClick={onDrawDeck} className="btn-primary">Draw from Deck</button>
          <button onClick={onDrawDiscard} className="btn-secondary">
            Draw from Discard {!humanOpened && '(must open first)'}
          </button>
        </div>
      )}
      
      {phase === 'ACTION' && (
        <div className="action-buttons">
          {!humanOpened && (
            <button
              onClick={onOpen}
              disabled={!validMeld || points < 51 || !includesDrawn}
              className="btn-primary"
              title={!validMeld ? 'Invalid meld' : points < 51 ? 'Need 51+ points' : !includesDrawn ? 'Must include drawn card' : ''}
            >
              Open ({points} pts)
            </button>
          )}
          {humanOpened && (
            <button
              onClick={onLayMeld}
              disabled={!validMeld}
              className="btn-primary"
              title={!validMeld ? 'Invalid meld' : ''}
            >
              Lay Meld ({points} pts)
            </button>
          )}
          <button onClick={onPass} className="btn-secondary">Pass</button>
        </div>
      )}
      
      {phase === 'DISCARD' && (
        <div className="action-buttons">
          <button
            onClick={onDiscard}
            disabled={selectedIds.size !== 1}
            className="btn-primary"
          >
            Discard {selectedIds.size !== 1 && '(select 1 card)'}
          </button>
        </div>
      )}
    </div>
  );
}

interface LogProps {
  entries: string[];
}

function Log({ entries }: LogProps) {
  return (
    <div className="log">
      <div className="log-title">Game Log</div>
      <div className="log-entries">
        {entries.map((entry, idx) => (
          <div key={idx} className="log-entry">{entry}</div>
        ))}
      </div>
    </div>
  );
}

interface HintsProps {
  state: GameState;
  selectedIds: Set<CardID>;
}

function Hints({ state, selectedIds }: HintsProps) {
  const [expanded, setExpanded] = useState(false);
  const selection = Array.from(selectedIds);
  
  if (selection.length === 0) return null;
  
  const points = selectionPoints(selection, state);
  const validSet = isValidSet(selection, state);
  const validRun = isValidRun(selection, state);
  const includesDrawn = state.lastDrawnCardId && selectedIds.has(state.lastDrawnCardId);
  const canOpen = points >= 51 && includesDrawn && (validSet || validRun);
  
  return (
    <div className="hints">
      <button onClick={() => setExpanded(!expanded)} className="hints-toggle">
        {expanded ? '▼' : '▶'} Show Hints
      </button>
      {expanded && (
        <div className="hints-content">
          <div>Selected: {selection.length} cards</div>
          <div>Total Points: {points}</div>
          <div>Valid Set: {validSet ? '✓' : '✗'}</div>
          <div>Valid Run: {validRun ? '✓' : '✗'}</div>
          <div>Includes Drawn Card: {includesDrawn ? '✓' : '✗'}</div>
          <div>Can Open: {canOpen ? '✓ YES' : '✗ NO'}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

function App() {
  const [numPlayers, setNumPlayers] = useState<2 | 3 | 4>(2);
  const [gameState, setGameState] = useState<GameState>(() => initGame(numPlayers));
  const [selectedIds, setSelectedIds] = useState<Set<CardID>>(new Set());
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [botProcessing, setBotProcessing] = useState(false);
  
  const humanId: PlayerID = 0;
  
  function cloneState(state: GameState): GameState {
    return structuredClone ? structuredClone(state) : JSON.parse(JSON.stringify(state));
  }
  
  function addLog(message: string) {
    setLogEntries(prev => [...prev.slice(-9), message]);
  }
  
  function handleAction(action: Action, description: string) {
    const newState = cloneState(gameState);
    const result = applyAction(newState, action);
    
    if (result.ok) {
      setGameState(newState);
      setSelectedIds(new Set());
      setError('');
      addLog(description);
    } else {
      setError(result.error || 'Action failed');
      addLog(`❌ ${result.error || 'Action failed'}`);
    }
  }
  
  function handleDrawDeck() {
    handleAction({ type: 'DRAW_DECK', player: humanId }, 'You drew from deck');
  }
  
  function handleDrawDiscard() {
    handleAction({ type: 'DRAW_DISCARD', player: humanId }, 'You drew from discard');
  }
  
  function handleOpen() {
    handleAction(
      { type: 'OPEN_GROUP', player: humanId, cardIds: Array.from(selectedIds) },
      'You opened!'
    );
  }
  
  function handleLayMeld() {
    handleAction(
      { type: 'LAY_MELD', player: humanId, cardIds: Array.from(selectedIds) },
      'You laid a meld'
    );
  }
  
  function handlePass() {
    handleAction({ type: 'PASS_ACTION', player: humanId }, 'You passed');
  }
  
  function handleDiscard() {
    if (selectedIds.size !== 1) return;
    handleAction(
      { type: 'DISCARD', player: humanId, cardId: Array.from(selectedIds) },
      'You discarded'
    );
  }
  
  function handleNewGame() {
    setGameState(initGame(numPlayers));
    setSelectedIds(new Set());
    setLogEntries([]);
    setError('');
    addLog(`New game started with ${numPlayers} players`);
  }
  
  function toggleCard(id: CardID) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  
  // Auto-play bots
  useEffect(() => {
    if (gameState.phase === 'GAME_OVER' || botProcessing) return;
    
    const currentPlayer = gameState.currentTurn;
    if (currentPlayer === humanId) return;
    
    setBotProcessing(true);
    
    const processBotTurn = async () => {
      let state = cloneState(gameState);
      
      while (state.currentTurn !== humanId && state.phase !== 'GAME_OVER') {
        await new Promise(resolve => setTimeout(resolve, 400));
        
        const result = botStep(state, state.currentTurn);
        if (!result.ok) {
          addLog(`Bot ${state.currentTurn + 1} error: ${result.error}`);
          break;
        }
        
        state = cloneState(state);
      }
      
      setGameState(state);
      setBotProcessing(false);
    };
    
    processBotTurn();
  }, [gameState.currentTurn, gameState.phase, humanId, botProcessing]);
  
  const humanHand = gameState.playersPrivate[humanId].hand;
  const topDiscardId = gameState.discard[gameState.discard.length - 1];
  
  return (
    <div className="app">
      <div className="board">
        <div className="game-header">
          <div className="game-title">Card 51</div>
          <div className="game-controls">
            <select
              value={numPlayers}
              onChange={e => setNumPlayers(parseInt(e.target.value) as 2 | 3 | 4)}
              disabled={gameState.phase !== 'GAME_OVER' && gameState.currentTurn !== 0}
            >
              <option value={2}>2 Players</option>
              <option value={3}>3 Players</option>
              <option value={4}>4 Players</option>
            </select>
            <button onClick={handleNewGame} className="btn-new-game">New Game</button>
          </div>
        </div>
        
        {gameState.phase === 'GAME_OVER' && (
          <div className="game-over">
            🎉 Player {(gameState.winner || 0) + 1} Wins!
          </div>
        )}
        
        {error && <div className="error-message">{error}</div>}
        
        <div className="board-layout">
          {/* Top player */}
          {numPlayers >= 3 && (
            <div className="seat-container top-seat">
              <PlayerSeat position="top" playerId={2} state={gameState} isCurrent={gameState.currentTurn === 2} />
            </div>
          )}
          
          <div className="middle-row">
            {/* Left player */}
            <div className="seat-container left-seat">
              <PlayerSeat position="left" playerId={1} state={gameState} isCurrent={gameState.currentTurn === 1} />
            </div>
            
            {/* Center piles */}
            <div className="center-area">
              <PileView
                type="deck"
                count={gameState.deckCount}
                state={gameState}
                onDraw={gameState.currentTurn === humanId && gameState.phase === 'DRAW' ? handleDrawDeck : undefined}
              />
              <PileView
                type="discard"
                topCardId={topDiscardId}
                state={gameState}
                onDraw={gameState.currentTurn === humanId && gameState.phase === 'DRAW' ? handleDrawDiscard : undefined}
              />
            </div>
            
            {/* Right player */}
            {numPlayers >= 4 && (
              <div className="seat-container right-seat">
                <PlayerSeat position="right" playerId={3} state={gameState} isCurrent={gameState.currentTurn === 3} />
              </div>
            )}
          </div>
          
          {/* Bottom player (human) */}
          <div className="bottom-area">
            <div className="seat-container bottom-seat">
              <PlayerSeat position="bottom" playerId={0} state={gameState} isCurrent={gameState.currentTurn === 0} isHuman />
            </div>
            
            <Controls
              state={gameState}
              selectedIds={selectedIds}
              onDrawDeck={handleDrawDeck}
              onDrawDiscard={handleDrawDiscard}
              onOpen={handleOpen}
              onLayMeld={handleLayMeld}
              onPass={handlePass}
              onDiscard={handleDiscard}
            />
            
            <Hand
              cardIds={humanHand}
              state={gameState}
              selectedIds={selectedIds}
              onToggleCard={toggleCard}
            />
            
            <Hints state={gameState} selectedIds={selectedIds} />
          </div>
        </div>
        
        <Log entries={logEntries} />
      </div>
    </div>
  );
}

export default App;