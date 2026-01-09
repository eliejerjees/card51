import React, { useState, useEffect, useMemo } from 'react';
import './app.css';
import type { GameState, PlayerID, CardID, CardDTO, Meld } from "./engine/types";
import type { Action } from "./engine/actions";
import { initGame, applyAction } from "./engine/state";
import { botStep } from "./engine/bot";
import { cardAssetPath, cardBackAssetPath } from "./ui/cardAssets";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";

import {
  SortableContext,
  useSortable,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";


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

function valueFromRank(rank: CardDTO["rank"]): number {
  if (rank === "JOKER") return 0;

  switch (rank) {
    case "ACE":
    case "KING":
    case "QUEEN":
    case "JACK":
    case "TEN":
      return 10;
    case "TWO": return 2;
    case "THREE": return 3;
    case "FOUR": return 4;
    case "FIVE": return 5;
    case "SIX": return 6;
    case "SEVEN": return 7;
    case "EIGHT": return 8;
    case "NINE": return 9;
    default:
      return 0;
  }
}

function cardValue(card: CardDTO): number {
  if (card.rank === "JOKER") return 0;

  switch (card.rank) {
    case "ACE":
    case "KING":
    case "QUEEN":
    case "JACK":
    case "TEN":
      return 10;
    case "TWO": return 2;
    case "THREE": return 3;
    case "FOUR": return 4;
    case "FIVE": return 5;
    case "SIX": return 6;
    case "SEVEN": return 7;
    case "EIGHT": return 8;
    case "NINE": return 9;
    default:
      return 0;
  }
}

const RANK_ORDER: Record<string, number> = {
  JOKER: 0,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  JACK: 11,
  QUEEN: 12,
  KING: 13,
  ACE: 14,
};

const SUIT_ORDER: Record<string, number> = {
  CLUBS: 1,
  DIAMONDS: 2,
  HEARTS: 3,
  SPADES: 4,
  JOKER: 0,
};


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
  const src = faceDown
    ? cardBackAssetPath()
    : (card ? cardAssetPath(card) : "");

  return (
    <div
      className={`card ${selected ? "selected" : ""} ${faceDown ? "face-down" : ""} ${size}`}
      onClick={onClick}
    >
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </div>
  );
}

interface HandProps {
  cardIds: CardID[];
  state: GameState;
  selectedIds: Set<CardID>;
  onToggleCard: (id: CardID) => void;
}

function rankToNum(rank: CardDTO["rank"]): number | null {
  switch (rank) {
    case "TWO": return 2;
    case "THREE": return 3;
    case "FOUR": return 4;
    case "FIVE": return 5;
    case "SIX": return 6;
    case "SEVEN": return 7;
    case "EIGHT": return 8;
    case "NINE": return 9;
    case "TEN": return 10;
    case "JACK": return 11;
    case "QUEEN": return 12;
    case "KING": return 13;
    case "ACE": return 14; // adjust if you allow Ace-low runs
    default: return null;
  }
}

function valueFromNumRank(num: number): number {
  // matches your cardValue/valueFromRank behavior
  if (num >= 11) return 10; // J/Q/K/A treated as 10 in your rules
  return num;               // 2..10
}

function scoreSetMax(ids: CardID[], state: GameState): number | null {
  const cards = ids.map(id => state.cardsById[id]);
  const nonJokers = cards.filter(c => c.rank !== "JOKER");
  if (nonJokers.length === 0) return null;

  const rank = nonJokers[0].rank;
  if (!nonJokers.every(c => c.rank === rank)) return null;

  // suits must be unique among non-jokers for a set
  const suits = nonJokers.map(c => c.suit);
  if (new Set(suits).size !== suits.length) return null;

  const jokerCount = cards.length - nonJokers.length;
  const base = nonJokers.reduce((s, c) => s + cardValue(c), 0);
  return base + jokerCount * valueFromRank(rank);
}

function scoreRunMax(ids: CardID[], state: GameState): number | null {
  const cards = ids.map(id => state.cardsById[id]);
  const nonJokers = cards.filter(c => c.rank !== "JOKER");
  if (nonJokers.length === 0) return null;

  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return null;

  const nums: number[] = [];
  for (const c of nonJokers) {
    const n = rankToNum(c.rank);
    if (n == null) return null;
    nums.push(n);
  }

  // duplicates in run not allowed
  if (new Set(nums).size !== nums.length) return null;

  const n = ids.length;
  let best: number | null = null;

  // Try every consecutive window of length n
  for (let start = 2; start <= 14 - n + 1; start++) {
    const expected = new Set<number>();
    let sum = 0;

    for (let i = 0; i < n; i++) {
      const r = start + i;
      expected.add(r);
      sum += valueFromNumRank(r);
    }

    // all non-jokers must fit in this window
    let ok = true;
    for (const r of nums) {
      if (!expected.has(r)) { ok = false; break; }
    }
    if (!ok) continue;

    if (best == null || sum > best) best = sum;
  }

  return best;
}

function groupPointsMax(ids: CardID[], state: GameState): number {
  // Prefer whichever gives a valid score
  const setScore = scoreSetMax(ids, state);
  if (setScore != null) return setScore;

  const runScore = scoreRunMax(ids, state);
  if (runScore != null) return runScore;

  // fallback (invalid group or unknown), keep old behavior
  return ids.reduce((s, id) => s + cardValue(state.cardsById[id]), 0);
}

function SortableHandCard({
  id,
  card,
  selected,
  onClick,
}: {
  id: CardID;
  card: CardDTO;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardView card={card} selected={selected} onClick={onClick} />
    </div>
  );
}

function Hand({ cardIds, state, selectedIds, onToggleCard }: HandProps) {
  // This is the UI order of the hand (sorting + manual drag/drop)
  const [handOrder, setHandOrder] = useState<CardID[]>(cardIds);

  // DnD sensors (important: distance so click still works)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Keep manual order stable when engine hand changes (draw/meld/discard)
  useEffect(() => {
    setHandOrder((prev) => {
      const handSet = new Set(cardIds);

      // keep existing cards in their previous UI order
      const kept = prev.filter((id) => handSet.has(id));
      const keptSet = new Set(kept);

      // append newly added cards at the end (drawn cards)
      const added = cardIds.filter((id) => !keptSet.has(id));

      // if we were missing cards (meld/discard), they are automatically removed by filtering above
      return [...kept, ...added];
    });
  }, [cardIds]);

  // Sort functions (do not touch engine)
  function sortByRankThenSuit() {
    setHandOrder((prev) =>
      [...prev].sort((a, b) => {
        const A = state.cardsById[a];
        const B = state.cardsById[b];
        const ra = RANK_ORDER[A.rank] ?? 0;
        const rb = RANK_ORDER[B.rank] ?? 0;
        if (ra !== rb) return ra - rb;
        const sa = SUIT_ORDER[A.suit] ?? 0;
        const sb = SUIT_ORDER[B.suit] ?? 0;
        return sa - sb;
      })
    );
  }

  function sortBySuitThenRank() {
    setHandOrder((prev) =>
      [...prev].sort((a, b) => {
        const A = state.cardsById[a];
        const B = state.cardsById[b];
        const sa = SUIT_ORDER[A.suit] ?? 0;
        const sb = SUIT_ORDER[B.suit] ?? 0;
        if (sa !== sb) return sa - sb;
        const ra = RANK_ORDER[A.rank] ?? 0;
        const rb = RANK_ORDER[B.rank] ?? 0;
        return ra - rb;
      })
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    setHandOrder((items) => {
      const oldIndex = items.indexOf(active.id as CardID);
      const newIndex = items.indexOf(over.id as CardID);
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  }

  // Only display the cards that actually exist in engine hand (safety)
  const ordered = useMemo(() => {
    const set = new Set(cardIds);
    return handOrder.filter((id) => set.has(id));
  }, [handOrder, cardIds]);

  return (
    <div className="hand">
      <div className="hand-toolbar">
        <button className="btn-secondary" onClick={sortByRankThenSuit}>
          Sort: Rank
        </button>
        <button className="btn-secondary" onClick={sortBySuitThenRank}>
          Sort: Suit
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ordered} strategy={horizontalListSortingStrategy}>
          <div className="hand-cards">
            {ordered.map((id) => (
              <SortableHandCard
                key={id}
                id={id}
                card={state.cardsById[id]}
                selected={selectedIds.has(id)}
                onClick={() => onToggleCard(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
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

 function meldPoints(meld: Meld, state: GameState): number {
    return meld.cardIds.reduce((sum, id) => {
      const dto = state.cardsById[id];

      if (dto.rank !== "JOKER") {
        return sum + cardValue(dto);
      }

      const sub = meld.jokerMap[id]; // { rank, suit }
      if (!sub) return sum;

      return sum + valueFromRank(sub.rank);
    }, 0);
  }

interface MeldZoneProps {
  melds: Meld[];
  state: GameState;
  owner: PlayerID;

  // NEW:
  selectedMeldId: string | null;
  selectedJokerId: CardID | null;
  onSelectMeld: (meldId: string) => void;
  onSelectJoker: (meldId: string, jokerId: CardID) => void;
}

function MeldZone({
  melds,
  state,
  owner,
  selectedMeldId,
  selectedJokerId,
  onSelectMeld,
  onSelectJoker,
}: MeldZoneProps) {
  const playerMelds = melds.filter(m => m.owner === owner);
  if (playerMelds.length === 0) return null;

  return (
    <div className="meld-zone">
      {playerMelds.map(meld => {
        const points = meldPoints(meld, state);
        const meldSelected = selectedMeldId === meld.id;

        return (
          <div
            key={meld.id}
            className={`meld ${meldSelected ? "meld-selected" : ""}`}
            onClick={() => onSelectMeld(meld.id)}
          >
            <div className="meld-cards">
              {meld.cardIds.map(id => {
                const dto = state.cardsById[id];
                const isJoker = dto.rank === "JOKER";
                const jokerSelected = isJoker && selectedJokerId === id && meldSelected;

                return (
                  <div
                    key={id}
                    className={jokerSelected ? "meld-card-selected" : ""}
                    onClick={(e) => {
                      // prevent meld click from firing twice
                      e.stopPropagation();
                      if (isJoker) onSelectJoker(meld.id, id);
                      else onSelectMeld(meld.id);
                    }}
                  >
                    <CardView card={dto} size="small" />
                  </div>
                );
              })}
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

  // NEW:
  selectedMeldId: string | null;
  selectedJokerId: CardID | null;
  onSelectMeld: (meldId: string) => void;
  onSelectJoker: (meldId: string, jokerId: CardID) => void;
}

function PlayerSeat({
  position,
  playerId,
  state,
  isCurrent,
  isHuman,
  selectedMeldId,
  selectedJokerId,
  onSelectMeld,
  onSelectJoker,
}: PlayerSeatProps) {
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
      <MeldZone
        melds={state.tableMelds}
        state={state}
        owner={playerId}
        selectedMeldId={selectedMeldId}
        selectedJokerId={selectedJokerId}
        onSelectMeld={onSelectMeld}
        onSelectJoker={onSelectJoker}
      />
    </div>
  );
}

interface ControlsProps {
  state: GameState;
  selectedIds: Set<CardID>;

  openGroups: CardID[][];
  openGroupsPoints: number;

  onMakeGroup: () => void;
  onRemoveGroup: (idx: number) => void; // optional, if you want remove buttons here
  onClearGroups: () => void;            // optional, if you want a clear

  onDrawDeck: () => void;
  onDrawDiscard: () => void;
  onOpen: () => void;
  onLayMeld: () => void;
  onPass: () => void;
  onDiscard: () => void;

  // new:
  onSwapJoker: () => void;
  selectedMeldId: string | null;
  selectedJokerId: CardID | null;
}


function Controls({
  state,
  selectedIds,
  openGroups,
  openGroupsPoints,
  onMakeGroup,
  onClearGroups,
  onDrawDeck,
  onDrawDiscard,
  onOpen,
  onLayMeld,
  onPass,
  onDiscard,
  onSwapJoker,
  selectedMeldId,
  selectedJokerId
}: ControlsProps) {
  const phase = state.phase;
  const humanId: PlayerID = 0;
  const isHumanTurn = state.currentTurn === humanId;
  const humanOpened = state.playersPublic[humanId].opened;
  const selection = Array.from(selectedIds);
  const points = selectionPoints(selection, state);
  const includesDrawn = state.lastDrawnCardId && selectedIds.has(state.lastDrawnCardId);
  const validMeld = selection.length >= 3 && isValidMeld(selection, state);
  const canSwap =
    phase === "ACTION" &&
    humanOpened &&
    !!selectedMeldId &&
    !!selectedJokerId &&
    selectedIds.size === 1;

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
            <>
              <button
                onClick={onMakeGroup}
                disabled={!validMeld}
                className="btn-secondary"
                title={!validMeld ? "Select a valid meld (3+)" : ""}
              >
                Make Group ({points} pts)
              </button>              

              <button
                onClick={onClearGroups}
                disabled={openGroups.length === 0}
                className="btn-secondary"
              >
                Clear Groups
              </button>

              <button
                onClick={onOpen}
                disabled={openGroups.length === 0 || openGroupsPoints < 51}
                className="btn-primary"
                title={
                  openGroups.length === 0
                    ? "Make at least 1 group"
                    : openGroupsPoints < 51
                    ? "Need 51+ points across groups"
                    : ""
                }
              >
                Open ({openGroupsPoints} pts)
              </button>
            </>
          )}

          {humanOpened && (
            <>
              <button
                onClick={onLayMeld}
                disabled={!validMeld}
                className="btn-primary"
                title={!validMeld ? "Invalid meld" : ""}
              >
                Lay Meld ({points} pts)
              </button>

              <button
                onClick={onSwapJoker}
                disabled={!canSwap}
                className="btn-secondary"
                title={
                  !selectedMeldId ? "Select a meld" :
                  !selectedJokerId ? "Select a joker in that meld" :
                  selectedIds.size !== 1 ? "Select exactly 1 replacement card from your hand" :
                  ""
                }
              >
                Swap Joker
              </button>
            </>
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

/*interface LogProps {
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
}*/

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
  const [openGroups, setOpenGroups] = useState<CardID[][]>([]);
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null);
  const [selectedJokerId, setSelectedJokerId] = useState<CardID | null>(null);
  
  const humanId: PlayerID = 0;

  function groupPointsFromIds(ids: CardID[], state: GameState): number {
  return ids.reduce((sum, id) => sum + cardValue(state.cardsById[id]), 0);
  }

  function openGroupsPoints(groups: CardID[][], state: GameState): number {
    return groups.reduce((sum, g) => sum + groupPointsMax(g, state), 0);
  }


  function handleClearGroups() {
    setOpenGroups([]);
  }

  function handleMakeGroup() {
    const group = Array.from(selectedIds);
    if (group.length < 3) {
      setError("Group must be 3+ cards.");
      return;
    }

    // Use engine validation if possible (preferred)
    // If you don't have validator imported in App.tsx, use your isValidMeld() for now.
    if (!isValidMeld(group, gameState)) {
      setError("That group is not a valid meld.");
      return;
    }

    setOpenGroups(prev => [...prev, group]);
    setSelectedIds(new Set());
    setError("");
    addLog(`Grouped ${group.length} cards`);
  }

  function removeOpenGroup(idx: number) {
    setOpenGroups(prev => prev.filter((_, i) => i !== idx));
  }


  function cloneState(state: GameState): GameState {
    if (typeof structuredClone === "function") return structuredClone(state);
    return JSON.parse(JSON.stringify(state)) as GameState;
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
      clearSwapSelection();
    } else {
      setError(result.error || 'Action failed');
      addLog(`❌ ${result.error || 'Action failed'}`);
    }
  }
  
  function clearSwapSelection() {
      setSelectedMeldId(null);
      setSelectedJokerId(null);
    }

  function handleSwapJoker() {
    if (!selectedMeldId) {
      setError("Select a meld first.");
      return;
    }
    if (!selectedJokerId) {
      setError("Select a joker in that meld.");
      return;
    }
    const handPick = Array.from(selectedIds);
    if (handPick.length !== 1) {
      setError("Select exactly 1 replacement card from your hand.");
      return;
    }

    handleAction(
      {
        type: "SWAP_JOKER",
        player: humanId,
        meldId: selectedMeldId,
        jokerId: selectedJokerId,
        replaceWithId: handPick[0],
      },
      "You swapped a joker"
    );
  }
  
  function handleDrawDeck() {
    handleAction({ type: 'DRAW_DECK', player: humanId }, 'You drew from deck');
  }
  
  function handleDrawDiscard() {
    handleAction({ type: 'DRAW_DISCARD', player: humanId }, 'You drew from discard');
  }
  
  function handleOpen() {
    if(openGroups.length === 0) return;
    
    handleAction(
      { type: 'OPEN_MULTI', player: humanId, groups: openGroups },
      `You opened with ${openGroups.length} groups (${openGroupsPoints(openGroups, gameState)} pts)`
    );
    setOpenGroups([]);
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
    setOpenGroups([]);
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
            🎉 Player {(gameState.winner ?? 0) + 1} Wins!
          </div>
        )}
        
        {error && <div className="error-message">{error}</div>}
        
        <div className="board-layout">
          {/* Top player */}
          {numPlayers >= 3 && (
            <div className="seat-container top-seat">
              <PlayerSeat
                position="top"
                playerId={2}
                state={gameState}
                isCurrent={gameState.currentTurn === 2}
                selectedMeldId={selectedMeldId}
                selectedJokerId={selectedJokerId}
                onSelectMeld={(id) => { setSelectedMeldId(id); setSelectedJokerId(null); }}
                onSelectJoker={(meldId, jokerId) => { setSelectedMeldId(meldId); setSelectedJokerId(jokerId); }}
              />
            </div>
          )}

          
          <div className="middle-row">
            {/* Left player */}
            <div className="seat-container left-seat">
              <PlayerSeat
                position="left"
                playerId={1}
                state={gameState}
                isCurrent={gameState.currentTurn === 1}
                selectedMeldId={selectedMeldId}
                selectedJokerId={selectedJokerId}
                onSelectMeld={(id) => { setSelectedMeldId(id); setSelectedJokerId(null); }}
                onSelectJoker={(meldId, jokerId) => { setSelectedMeldId(meldId); setSelectedJokerId(jokerId); }}
              />
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
                {numPlayers >= 4 && (
                  <div className="seat-container right-seat">
                    <PlayerSeat
                      position="right"
                      playerId={3}
                      state={gameState}
                      isCurrent={gameState.currentTurn === 3}
                      selectedMeldId={selectedMeldId}
                      selectedJokerId={selectedJokerId}
                      onSelectMeld={(id) => { setSelectedMeldId(id); setSelectedJokerId(null); }}
                      onSelectJoker={(meldId, jokerId) => { setSelectedMeldId(meldId); setSelectedJokerId(jokerId); }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Bottom player (human) */}
          <div className="bottom-area">
            <div className="seat-container bottom-seat">
              <PlayerSeat
                position="bottom"
                playerId={0}
                state={gameState}
                isCurrent={gameState.currentTurn === 0}
                isHuman
                selectedMeldId={selectedMeldId}
                selectedJokerId={selectedJokerId}
                onSelectMeld={(id) => { setSelectedMeldId(id); setSelectedJokerId(null); }}
                onSelectJoker={(meldId, jokerId) => { setSelectedMeldId(meldId); setSelectedJokerId(jokerId); }}
              />
            </div>
            
            <Controls
              state={gameState}
              selectedIds={selectedIds}
              openGroups={openGroups}
              openGroupsPoints={openGroupsPoints(openGroups, gameState)}
              onMakeGroup={handleMakeGroup}
              onRemoveGroup={removeOpenGroup}
              onClearGroups={handleClearGroups}
              onDrawDeck={handleDrawDeck}
              onDrawDiscard={handleDrawDiscard}
              onOpen={handleOpen}
              onLayMeld={handleLayMeld}
              onPass={handlePass}
              onDiscard={handleDiscard}
              onSwapJoker={handleSwapJoker}
              selectedMeldId={selectedMeldId}
              selectedJokerId={selectedJokerId}
            />

            {openGroups.length > 0 && (
              <div className="open-groups">
                {openGroups.map((g, idx) => (
                  <div key={idx} className="open-group">
                    <div className="open-group-cards">
                      {g.map(id => (
                        <CardView key={id} card={gameState.cardsById[id]} size="small" />
                      ))}
                    </div>
                    <button className="open-group-remove" onClick={() => removeOpenGroup(idx)}>×</button>
                  </div>
                ))}
              </div>
            )}
            
            <Hand
              cardIds={humanHand}
              state={gameState}
              selectedIds={selectedIds}
              onToggleCard={toggleCard}
            />
            
            {/*<Hints state={gameState} selectedIds={selectedIds} />*/}
          </div>
        </div>
        
        {/*<Log entries={logEntries} />*/}
      </div>
    </div>
  );
}

export default App;