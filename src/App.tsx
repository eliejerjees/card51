import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./App.css";
import { Rank } from "./engine/card";
import type { Action, MeldProposal } from "./engine/actions";
import { chooseBotAction } from "./engine/bot";
import { GroupValidator, calculateMeldValue } from "./engine/groupValidator";
import { findMeldCandidates } from "./engine/meldFinder";
import { canTakeDiscardForOpening } from "./engine/opening";
import { createPlayerView } from "./engine/playerView";
import { applyAction, initGame } from "./engine/state";
import type { CardDTO, CardID, GameState, Meld } from "./engine/types";
import { cardAssetPath, cardBackAssetPath } from "./ui/cardAssets";

const HUMAN_ID = 0;

type TableMotion = {
  key: number;
  type: "DRAW_DECK" | "DRAW_DISCARD" | "DISCARD";
  player: number;
  cardId?: CardID;
};

const RANK_LABEL: Record<CardDTO["rank"], string> = {
  TWO: "2", THREE: "3", FOUR: "4", FIVE: "5", SIX: "6", SEVEN: "7",
  EIGHT: "8", NINE: "9", TEN: "10", JACK: "J", QUEEN: "Q", KING: "K", ACE: "A", JOKER: "Joker",
};
const SUIT_LABEL: Record<CardDTO["suit"], string> = {
  CLUBS: "♣", DIAMONDS: "♦", HEARTS: "♥", SPADES: "♠", JOKER: "",
};
const RANK_SORT: Record<CardDTO["rank"], number> = {
  JOKER: 0, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7,
  EIGHT: 8, NINE: 9, TEN: 10, JACK: 11, QUEEN: 12, KING: 13, ACE: 14,
};
const SUIT_SORT: Record<CardDTO["suit"], number> = {
  JOKER: 0, CLUBS: 1, DIAMONDS: 2, HEARTS: 3, SPADES: 4,
};

function cardLabel(card: CardDTO): string {
  return card.rank === Rank.JOKER ? "Joker" : `${RANK_LABEL[card.rank]}${SUIT_LABEL[card.suit]}`;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function CardView({
  card,
  selected = false,
  disabled = false,
  small = false,
  onClick,
  badge,
  dragListeners,
  nativeDragProps,
}: {
  card?: CardDTO;
  selected?: boolean;
  disabled?: boolean;
  small?: boolean;
  onClick?: () => void;
  badge?: string;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  nativeDragProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const label = card ? cardLabel(card) : "Face-down card";
  const content = (
    <>
      <img src={card ? cardAssetPath(card) : cardBackAssetPath()} alt={label} draggable={false} />
      {badge && <span className="card-badge">{badge}</span>}
    </>
  );
  if (!onClick) return <span className={`playing-card ${small ? "small" : ""}`}>{content}</span>;
  return (
    <button
      type="button"
      className={`playing-card card-button ${small ? "small" : ""} ${selected ? "selected" : ""}`}
      aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      {...dragListeners}
      {...nativeDragProps}
    >
      {content}
    </button>
  );
}

function SortableHandCard({
  id,
  card,
  selected,
  disabled,
  onClick,
  badge,
  onNativeDragStart,
  onNativeDrop,
  onNativeDragEnd,
}: {
  id: CardID;
  card: CardDTO;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  badge?: string;
  onNativeDragStart: (id: CardID) => void;
  onNativeDrop: (id: CardID) => void;
  onNativeDragEnd: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`hand-card-slot ${isDragging ? "dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <CardView
        card={card}
        selected={selected}
        disabled={disabled}
        onClick={onClick}
        badge={badge}
        dragListeners={listeners}
        nativeDragProps={{
          draggable: true,
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
            onNativeDragStart(id);
          },
          onDragOver: (event) => event.preventDefault(),
          onDrop: (event) => {
            event.preventDefault();
            onNativeDrop(id);
          },
          onDragEnd: onNativeDragEnd,
        }}
      />
    </div>
  );
}

function DropZone({ id, className = "", children, onNativeDrop }: { id: string; className?: string; children: ReactNode; onNativeDrop?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div
    ref={setNodeRef}
    className={`${className} ${isOver ? "drop-active" : ""}`}
    onDragOver={onNativeDrop ? (event: ReactDragEvent<HTMLDivElement>) => event.preventDefault() : undefined}
    onDrop={onNativeDrop ? (event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); onNativeDrop(); } : undefined}
  >{children}</div>;
}

function MeldView({
  meld,
  state,
  selected,
  selectedJokerId,
  onSelect,
  onSelectJoker,
  onNativeDrop,
}: {
  meld: Meld;
  state: GameState;
  selected: boolean;
  selectedJokerId: CardID | null;
  onSelect: () => void;
  onSelectJoker: (id: CardID) => void;
  onNativeDrop: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `meld:${meld.id}` });
  return (
    <article
      ref={setNodeRef}
      className={`meld-card ${selected ? "selected-meld" : ""} ${isOver ? "drop-active" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onNativeDrop(); }}
    >
      <button type="button" className="meld-heading" onClick={onSelect}>
        {meld.kind === "SET" ? "Set" : "Run"} · {calculateMeldValue(meld, state.cardsById)} pts
      </button>
      <div className="meld-cards">
        {meld.cardIds.map((id) => {
          const card = state.cardsById[id];
          const represented = meld.jokerMap[id];
          return (
            <CardView
              key={id}
              card={card}
              small
              selected={selected && selectedJokerId === id}
              onClick={card.rank === Rank.JOKER ? () => onSelectJoker(id) : onSelect}
              badge={represented ? `${RANK_LABEL[represented.rank]}${SUIT_LABEL[represented.suit]}` : undefined}
            />
          );
        })}
      </div>
      <span className="meld-owner">Created by Player {meld.owner + 1}</span>
    </article>
  );
}

function App() {
  const [numPlayers, setNumPlayers] = useState(2);
  const [gameState, setGameState] = useState<GameState>(() => initGame(2));
  const [selectedIds, setSelectedIds] = useState<Set<CardID>>(new Set());
  const [draftGroups, setDraftGroups] = useState<MeldProposal[]>([]);
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null);
  const [selectedJokerId, setSelectedJokerId] = useState<CardID | null>(null);
  const [sortMode, setSortMode] = useState<"rank" | "suit" | "custom">("rank");
  const [interpretationIndex, setInterpretationIndex] = useState(0);
  const [error, setError] = useState("");
  const [turnBaseline, setTurnBaseline] = useState<GameState | null>(null);
  const [manualOrder, setManualOrder] = useState<CardID[]>(() => gameState.playersPrivate[HUMAN_ID].hand);
  const [activeDragId, setActiveDragId] = useState<CardID | null>(null);
  const [tableMotion, setTableMotion] = useState<TableMotion | null>(null);
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );

  const humanHand = gameState.playersPrivate[HUMAN_ID].hand;
  const selection = useMemo(() => [...selectedIds], [selectedIds]);
  const stagedIds = useMemo(() => new Set(draftGroups.flatMap((group) => group.cardIds)), [draftGroups]);
  const selectedOptions = useMemo(() => {
    if (selection.length < 3) return [];
    const selected = new Set(selection);
    return findMeldCandidates(selection, gameState.cardsById)
      .filter((candidate) => candidate.cardIds.length === selection.length && candidate.cardIds.every((id) => selected.has(id)));
  }, [gameState.cardsById, selection]);
  const selectedOption = selectedOptions[Math.min(interpretationIndex, Math.max(0, selectedOptions.length - 1))];
  const fallbackValidation = useMemo(
    () => GroupValidator.validateMeld(selection.map((id) => gameState.cardsById[id])),
    [gameState.cardsById, selection],
  );
  const selectedValidation = selectedOption?.validation ?? fallbackValidation;
  const selectedProposal: MeldProposal | null = selectedOption ? {
    cardIds: selection,
    kind: selectedOption.validation.kind,
    aceMode: selectedOption.validation.aceMode,
    jokerMap: selectedOption.validation.jokerMap,
  } : null;
  const draftPoints = useMemo(
    () => draftGroups.reduce((sum, group) => {
      const result = GroupValidator.validateMeld(group.cardIds.map((id) => gameState.cardsById[id]), {
        kind: group.kind,
        aceMode: group.aceMode,
        fixedJokerMap: group.jokerMap,
      });
      return sum + (result.ok ? result.points : 0);
    }, 0),
    [draftGroups, gameState.cardsById],
  );
  const topDiscardId = gameState.discard[gameState.discard.length - 1];
  const humanOpened = gameState.playersPublic[HUMAN_ID].opened;
  const isHumanTurn = gameState.currentTurn === HUMAN_ID && gameState.phase !== "GAME_OVER";
  const canDrawTrash = useMemo(() => {
    if (!topDiscardId) return false;
    return humanOpened || canTakeDiscardForOpening(humanHand, topDiscardId, gameState.cardsById);
  }, [gameState.cardsById, humanHand, humanOpened, topDiscardId]);

  const orderedHand = useMemo(() => {
    if (sortMode === "custom") {
      const known = manualOrder.filter((id) => humanHand.includes(id));
      return [...known, ...humanHand.filter((id) => !known.includes(id))];
    }
    return [...humanHand].sort((a, b) => {
    const cardA = gameState.cardsById[a];
    const cardB = gameState.cardsById[b];
    if (sortMode === "rank") {
      return RANK_SORT[cardA.rank] - RANK_SORT[cardB.rank] || SUIT_SORT[cardA.suit] - SUIT_SORT[cardB.suit];
    }
    return SUIT_SORT[cardA.suit] - SUIT_SORT[cardB.suit] || RANK_SORT[cardA.rank] - RANK_SORT[cardB.rank];
    });
  }, [gameState.cardsById, humanHand, manualOrder, sortMode]);

  useEffect(() => {
    if (!tableMotion) return;
    const timer = window.setTimeout(() => setTableMotion(null), 1_150);
    return () => window.clearTimeout(timer);
  }, [tableMotion]);

  useEffect(() => {
    if (!activeDragId) return;
    const safetyTimer = window.setTimeout(() => setActiveDragId(null), 10_000);
    return () => window.clearTimeout(safetyTimer);
  }, [activeDragId]);

  useEffect(() => {
    if (gameState.phase === "GAME_OVER" || gameState.currentTurn === HUMAN_ID || activeDragId) return;
    const action = chooseBotAction(createPlayerView(gameState, gameState.currentTurn));
    if (!action) {
      const failureTimer = window.setTimeout(
        () => setError(`Bot ${gameState.currentTurn + 1} could not choose a legal move.`),
        0,
      );
      return () => window.clearTimeout(failureTimer);
    }
    const animated = action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD" || action.type === "DISCARD";
    const cardId = action.type === "DRAW_DISCARD"
      ? gameState.discard[gameState.discard.length - 1]
      : action.type === "DISCARD" ? action.cardId[0] : undefined;
    const motionTimer = window.setTimeout(() => {
      if (animated) setTableMotion({ key: Date.now(), type: action.type as TableMotion["type"], player: action.player, cardId });
    }, 360);
    const actionTimer = window.setTimeout(() => {
      const next = cloneState(gameState);
      const result = applyAction(next, action);
      if (result.ok) setGameState(next);
      else setError(`Bot ${next.currentTurn + 1}: ${result.error}`);
    }, animated ? 1_400 : 850);
    return () => {
      window.clearTimeout(motionTimer);
      window.clearTimeout(actionTimer);
    };
  }, [activeDragId, gameState]);

  function clearSelections(): void {
    setSelectedIds(new Set());
    setSelectedMeldId(null);
    setSelectedJokerId(null);
    setInterpretationIndex(0);
  }

  function runAction(action: Action): boolean {
    const next = cloneState(gameState);
    const result = applyAction(next, action);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    if (action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD" || action.type === "DISCARD") {
      const cardId = action.type === "DRAW_DISCARD"
        ? gameState.discard[gameState.discard.length - 1]
        : action.type === "DISCARD" ? action.cardId[0] : undefined;
      setTableMotion({ key: Date.now(), type: action.type, player: action.player, cardId });
    }
    if (action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD") {
      setTurnBaseline(cloneState(next));
    } else if (action.type === "DISCARD") {
      setTurnBaseline(null);
    }
    setGameState(next);
    setError("");
    clearSelections();
    return true;
  }

  function proposalFor(cardIds: CardID[]): MeldProposal | null {
    if (selectedProposal && cardIds.length === selection.length && cardIds.every((id) => selectedIds.has(id))) {
      return { ...selectedProposal, cardIds };
    }
    const candidate = findMeldCandidates(cardIds, gameState.cardsById)
      .find((option) => option.cardIds.length === cardIds.length);
    return candidate ? {
      cardIds,
      kind: candidate.validation.kind,
      aceMode: candidate.validation.aceMode,
      jokerMap: candidate.validation.jokerMap,
    } : null;
  }

  function playCards(cardIds: CardID[], meldId?: string): void {
    if (!isHumanTurn || gameState.phase !== "ACTION") return;
    if (!humanOpened) {
      const proposal = proposalFor(cardIds);
      if (!proposal) {
        setError("Select a valid set or run before moving it to the table.");
        return;
      }
      setDraftGroups((groups) => [...groups, proposal]);
      setSelectedIds(new Set());
      setError("");
      return;
    }
    if (meldId) {
      runAction({ type: "ADD_TO_MELD", player: HUMAN_ID, meldId, cardIds });
      return;
    }
    const proposal = proposalFor(cardIds);
    if (!proposal) {
      setError("Those cards do not form a valid new set or run.");
      return;
    }
    runAction({ type: "LAY_MELD", player: HUMAN_ID, ...proposal });
  }

  function finishTurnWithDiscard(cardId: CardID): void {
    if (!isHumanTurn || (gameState.phase !== "ACTION" && gameState.phase !== "DISCARD")) return;
    const next = cloneState(gameState);
    const actions: Action[] = [];
    if (next.phase === "ACTION") {
      if (!next.playersPublic[HUMAN_ID].opened && draftGroups.length > 0) {
        actions.push({ type: "OPEN_MULTI", player: HUMAN_ID, groups: draftGroups });
      }
      actions.push({ type: "PASS_ACTION", player: HUMAN_ID });
    }
    actions.push({ type: "DISCARD", player: HUMAN_ID, cardId: [cardId] });
    for (const action of actions) {
      const result = applyAction(next, action);
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }
    setTableMotion({ key: Date.now(), type: "DISCARD", player: HUMAN_ID, cardId });
    setGameState(next);
    setTurnBaseline(null);
    setDraftGroups([]);
    setError("");
    clearSelections();
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    if (!event.over) {
      setActiveDragId(null);
      return;
    }
    handleCardDrop(String(event.active.id), String(event.over.id));
  }

  function handleCardDrop(activeId: CardID, overId: string): void {
    setActiveDragId(null);
    const draggedIds = selectedIds.has(activeId) ? selection : [activeId];
    if (overId === "table-meld-drop") {
      playCards(draggedIds);
      return;
    }
    if (overId.startsWith("meld:")) {
      playCards(draggedIds, overId.slice(5));
      return;
    }
    if (overId === "discard-drop") {
      finishTurnWithDiscard(activeId);
      return;
    }
    const oldIndex = orderedHand.indexOf(activeId);
    const newIndex = orderedHand.indexOf(overId);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      setManualOrder(arrayMove(orderedHand, oldIndex, newIndex));
      setSortMode("custom");
    }
  }

  function toggleCard(id: CardID): void {
    if (!isHumanTurn || stagedIds.has(id)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setInterpretationIndex(0);
  }

  function stageOpeningGroup(): void {
    if (!selectedValidation.ok) {
      setError(fallbackValidation.ok ? "Choose a legal interpretation for this meld." : fallbackValidation.error);
      return;
    }
    if (!selectedProposal) {
      setError("Choose a legal interpretation for this meld.");
      return;
    }
    setDraftGroups((groups) => [...groups, selectedProposal]);
    setSelectedIds(new Set());
    setInterpretationIndex(0);
    setError("");
  }

  function newGame(): void {
    const next = initGame(numPlayers);
    setGameState(next);
    setManualOrder(next.playersPrivate[HUMAN_ID].hand);
    setSortMode("rank");
    setTurnBaseline(null);
    setDraftGroups([]);
    clearSelections();
    setError("");
  }

  function resetTurnActions(): void {
    if (!turnBaseline) return;
    setGameState(cloneState(turnBaseline));
    setDraftGroups([]);
    clearSelections();
    setError("");
  }

  const selectedMeld = gameState.tableMelds.find((meld) => meld.id === selectedMeldId);
  const selectedReplacement = selection.length === 1 ? selection[0] : null;
  const canSwap = Boolean(selectedMeld && selectedJokerId && selectedReplacement);
  const selectedDiscard = selection.length === 1 ? selection[0] : null;
  const sameTrashCard = Boolean(selectedDiscard && gameState.lastDrawSource === "DISCARD" && selectedDiscard === gameState.lastDrawnCardId);
  const mustOpenFromTrash = !humanOpened && gameState.lastDrawSource === "DISCARD";
  const openingReady = draftGroups.length > 0 && draftPoints >= 51;
  const canFinishTurn = Boolean(selectedDiscard && !sameTrashCard && (!mustOpenFromTrash || openingReady));
  const hasTurnChanges = Boolean(turnBaseline && (
    draftGroups.length > 0
    || gameState.phase !== turnBaseline.phase
    || gameState.playersPrivate[HUMAN_ID].hand.length !== turnBaseline.playersPrivate[HUMAN_ID].hand.length
    || JSON.stringify(gameState.tableMelds) !== JSON.stringify(turnBaseline.tableMelds)
  ));

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDragId(null)}>
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">The family rummy game</p>
          <h1>Card51</h1>
        </div>
        <div className="new-game-controls">
          <label>
            Players
            <select value={numPlayers} onChange={(event) => setNumPlayers(Number(event.target.value))}>
              <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
            </select>
          </label>
          <button type="button" className="gold-button" onClick={newGame}>New game</button>
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <strong>{gameState.phase === "GAME_OVER" ? `Player ${(gameState.winner ?? 0) + 1} wins!` : `Player ${gameState.currentTurn + 1}'s turn`}</strong>
        <span>{gameState.phase === "DRAW" ? "Draw a card" : gameState.phase === "ACTION" ? "Play or discard" : gameState.phase === "DISCARD" ? "Discard to finish" : "Game over"}</span>
        <span>Turn {gameState.turnNumber}</span>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {gameState.lastBurnedMeld && (
        <div className="burn-banner" role="status">
          <div>
            <strong>🔥 Complete {gameState.lastBurnedMeld.kind.toLowerCase()} burnt into the trash</strong>
            <span>A normal discard is still required.</span>
          </div>
          <div className="burned-cards">
            {gameState.lastBurnedMeld.cardIds.map((id) => {
              const represented = gameState.lastBurnedMeld?.jokerMap[id];
              return <CardView
                key={id}
                card={gameState.cardsById[id]}
                small
                badge={represented ? `${RANK_LABEL[represented.rank]}${SUIT_LABEL[represented.suit]}` : undefined}
              />;
            })}
          </div>
        </div>
      )}

      <div className="game-layout">
      <div className={`table-shell ${isHumanTurn ? "your-turn" : "waiting-turn"} ${activeDragId ? "dragging-card" : ""}`}>
      <section className="opponents" aria-label="Opponents">
        {Array.from({ length: gameState.numPlayers }, (_, player) => player).filter((player) => player !== HUMAN_ID).map((player) => (
          <div key={player} className={`player-chip ${gameState.currentTurn === player ? "current" : ""}`}>
            <div className="player-avatar">P{player + 1}</div>
            <div className="player-copy">
              <span>Player {player + 1}</span>
              <strong>{gameState.playersPublic[player].handCount} cards</strong>
              <small>{gameState.playersPublic[player].opened ? "Opened" : "Closed"}</small>
            </div>
            <div className="seat-card-stack" aria-hidden="true"><i /><i /><i /></div>
          </div>
        ))}
      </section>

      {tableMotion && (
        <div key={tableMotion.key} className={`table-motion motion-${tableMotion.type.toLowerCase()} ${tableMotion.player === HUMAN_ID ? "motion-human" : "motion-bot"} motion-seat-${tableMotion.player}`} aria-live="polite">
          <CardView card={tableMotion.type === "DRAW_DECK" || !tableMotion.cardId ? undefined : gameState.cardsById[tableMotion.cardId]} small />
          <span>{tableMotion.player === HUMAN_ID ? "You" : `Player ${tableMotion.player + 1}`} {tableMotion.type === "DISCARD" ? "discarded" : "drew"}</span>
        </div>
      )}

      <section className="table-area">
        <div className="piles">
          <button
            type="button"
            className="pile-button"
            disabled={!isHumanTurn || gameState.phase !== "DRAW" || gameState.deckCount === 0 && gameState.discard.length <= 1}
            onClick={() => runAction({ type: "DRAW_DECK", player: HUMAN_ID })}
          >
            <span>Draw pile</span><CardView /><strong>{gameState.deckCount}</strong>
          </button>
          <DropZone id="discard-drop" className="discard-drop-zone" onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, "discard-drop")}>
          <button
            type="button"
            className="pile-button"
            disabled={!isHumanTurn || gameState.phase !== "DRAW" || !canDrawTrash}
            onClick={() => runAction({ type: "DRAW_DISCARD", player: HUMAN_ID })}
            title={!humanOpened && topDiscardId && !canDrawTrash ? "This card does not enable a legal 51-point opening." : undefined}
          >
            <span>Discard pile</span>
            {topDiscardId ? <CardView card={gameState.cardsById[topDiscardId]} /> : <span className="empty-pile">Empty</span>}
            <strong>{gameState.discard.length}</strong>
          </button>
          </DropZone>
        </div>

        <DropZone id="table-meld-drop" className="meld-drop-zone" onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, "table-meld-drop")}>
        <div className="meld-board">
          <div className="section-heading">
            <div><p className="eyebrow">Shared table</p><h2>Active melds</h2></div>
            <span>{gameState.tableMelds.length}</span>
          </div>
          {draftGroups.length > 0 && (
            <div className="staged-table-melds" aria-label="Staged opening melds">
              {draftGroups.map((group, index) => {
                const validation = GroupValidator.validateMeld(group.cardIds.map((id) => gameState.cardsById[id]), {
                  kind: group.kind,
                  aceMode: group.aceMode,
                  fixedJokerMap: group.jokerMap,
                });
                const orderedIds = validation.ok ? validation.orderedIds : group.cardIds;
                return (
                  <article className="meld-card staged-meld" key={group.cardIds.join("-")}>
                    <button type="button" className="meld-heading" onClick={() => setDraftGroups((groups) => groups.filter((_, groupIndex) => groupIndex !== index))}>
                      Staged {validation.ok ? validation.kind.toLowerCase() : "meld"} · {validation.ok ? validation.points : 0} pts · remove
                    </button>
                    <div className="meld-cards">{orderedIds.map((id) => <CardView key={id} card={gameState.cardsById[id]} small />)}</div>
                    <span className="meld-owner">Commits when you discard</span>
                  </article>
                );
              })}
            </div>
          )}
          {gameState.tableMelds.length === 0 && draftGroups.length === 0 ? (
            <p className="empty-message">No active melds yet. Complete four-card sets and full runs burn automatically.</p>
          ) : gameState.tableMelds.length > 0 ? (
            <div className="meld-grid">
              {gameState.tableMelds.map((meld) => (
                <MeldView
                  key={meld.id}
                  meld={meld}
                  state={gameState}
                  selected={selectedMeldId === meld.id}
                  selectedJokerId={selectedJokerId}
                  onSelect={() => { setSelectedMeldId(meld.id); setSelectedJokerId(null); }}
                  onSelectJoker={(id) => { setSelectedMeldId(meld.id); setSelectedJokerId(id); }}
                  onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, `meld:${meld.id}`)}
                />
              ))}
            </div>
          ) : null}
        </div>
        </DropZone>
      </section>

      <section className="action-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Turn flow</p><h2>{isHumanTurn ? "Your move" : `Player ${gameState.currentTurn + 1} is playing…`}</h2></div>
          {selectedValidation.ok && selection.length > 0 && <span>{selectedValidation.kind} · {selectedValidation.points} pts</span>}
        </div>

        {isHumanTurn && gameState.phase === "ACTION" && selectedOptions.length > 1 && (
          <label className="interpretation-picker">
            Joker interpretation
            <select value={Math.min(interpretationIndex, selectedOptions.length - 1)} onChange={(event) => setInterpretationIndex(Number(event.target.value))}>
              {selectedOptions.map((option, index) => {
                const represented = Object.values(option.validation.jokerMap)
                  .map((card) => `${RANK_LABEL[card.rank]}${SUIT_LABEL[card.suit]}`).join(", ");
                return <option key={`${option.validation.kind}-${option.validation.aceMode}-${represented}-${index}`} value={index}>
                  {option.validation.kind} · {option.validation.points} pts{represented ? ` · Joker as ${represented}` : ""}
                </option>;
              })}
            </select>
          </label>
        )}

        {isHumanTurn && gameState.phase === "DRAW" && (
          <p className="instruction"><strong>Start by drawing.</strong> Choose the deck or discard pile above. Then play cards if you want and discard once to end your turn.</p>
        )}

        {isHumanTurn && gameState.phase === "ACTION" && !humanOpened && (
          <div className="action-stack">
            <p className="instruction">Select a set or run and drag it onto the table. Your opening is committed together when you discard.</p>
            <div className="button-row">
              <button type="button" disabled={!selectedValidation.ok} onClick={stageOpeningGroup}>Move selection to table</button>
              {hasTurnChanges && <button type="button" onClick={resetTurnActions}>Undo table moves</button>}
              <button type="button" className="gold-button" disabled={!canFinishTurn} onClick={() => selectedDiscard && finishTurnWithDiscard(selectedDiscard)}>Discard & end turn</button>
            </div>
            {draftGroups.length > 0 && (
              <div className="drafts">
                <span className={openingReady ? "opening-ready" : ""}>Opening: {draftPoints} / 51</span>
              </div>
            )}
          </div>
        )}

        {isHumanTurn && gameState.phase === "ACTION" && humanOpened && (
          <div className="action-stack">
            <p className="instruction">Drag selected cards onto the table or an existing meld. Drag your final card to the discard pile when you are done.</p>
            <div className="button-row">
              <button type="button" disabled={selection.length === 0 || (!selectedMeldId && !selectedProposal)} onClick={() => playCards(selection, selectedMeldId ?? undefined)}>{selectedMeldId ? "Add selection to meld" : "Play selection"}</button>
              {canSwap && <button type="button" onClick={() => runAction({ type: "SWAP_JOKER", player: HUMAN_ID, meldId: selectedMeldId!, jokerId: selectedJokerId!, replaceWithId: selectedReplacement! })}>Replace Joker</button>}
              {hasTurnChanges && <button type="button" onClick={resetTurnActions}>Undo table moves</button>}
              <button type="button" className="gold-button" disabled={!canFinishTurn} onClick={() => selectedDiscard && finishTurnWithDiscard(selectedDiscard)}>Discard & end turn</button>
            </div>
          </div>
        )}

        {isHumanTurn && gameState.phase === "DISCARD" && (
          <div className="action-stack">
            <p className="instruction">Drag one card to the discard pile, or select it and use the button.</p>
            <div className="button-row">
              {hasTurnChanges && <button type="button" onClick={resetTurnActions}>Undo table moves</button>}
              <button type="button" className="gold-button" disabled={!canFinishTurn} onClick={() => selectedDiscard && finishTurnWithDiscard(selectedDiscard)}>Discard & end turn</button>
            </div>
          </div>
        )}

        {!isHumanTurn && gameState.phase !== "GAME_OVER" && (
          <p className="instruction waiting-copy">Watch the table — their draw, plays, and discard will happen here.</p>
        )}
      </section>

      <section className="hand-panel">
        <div className="section-heading">
          <div className="you-heading"><span className="player-avatar you-avatar">YOU</span><div><p className="eyebrow">Your seat · {humanOpened ? "Opened" : "Closed"}</p><h2>Your hand · {humanHand.length}</h2></div></div>
          <div className="sort-controls">
            <button type="button" aria-pressed={sortMode === "rank"} onClick={() => setSortMode("rank")}>By rank</button>
            <button type="button" aria-pressed={sortMode === "suit"} onClick={() => setSortMode("suit")}>By suit</button>
          </div>
        </div>
        <p className="drag-hint">Drag to reorder · Select several cards, then drag them to the table · Drag one to the discard pile to end your turn</p>
        <SortableContext items={orderedHand} strategy={horizontalListSortingStrategy}>
        <div className="hand-cards">
          {orderedHand.map((id) => (
            <SortableHandCard
              key={id}
              id={id}
              card={gameState.cardsById[id]}
              selected={selectedIds.has(id)}
              disabled={stagedIds.has(id)}
              onClick={() => toggleCard(id)}
              badge={stagedIds.has(id) ? "Staged" : undefined}
              onNativeDragStart={setActiveDragId}
              onNativeDrop={(targetId) => activeDragId && handleCardDrop(activeDragId, targetId)}
              onNativeDragEnd={() => setActiveDragId(null)}
            />
          ))}
        </div>
        </SortableContext>
      </section>
      </div>

      <aside className="lower-grid">
        <details className="history-panel">
          <summary>Game history <span>{gameState.events.length}</span></summary>
          {gameState.events.length === 0 ? <p className="empty-message">No actions yet.</p> : (
            <ol>{gameState.events.slice(-10).reverse().map((event) => <li key={event.id}>{event.message}</li>)}</ol>
          )}
        </details>
        <details className="rules-panel">
          <summary>Rules quick reference</summary>
          <ul>
            <li>Draw once, take any number of legal actions, then discard once.</li>
            <li>Open with one or more new melds worth at least 51.</li>
            <li>Sets use one rank and no duplicate suits; four suits burn.</li>
            <li>Runs are same-suit sequences; Ace is low or high, never wrapping.</li>
            <li>Opened players may extend any active meld and replace exact Joker identities.</li>
            <li>You win only by making the required final discard.</li>
          </ul>
          <p>The complete authoritative specification is stored in <code>RULES.md</code>.</p>
        </details>
      </aside>
      </div>

      {gameState.phase === "GAME_OVER" && (
        <div className={`game-result-overlay ${gameState.winner === HUMAN_ID ? "victory" : "defeat"}`} role="dialog" aria-modal="true" aria-labelledby="game-result-title">
          <div className="result-particles" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
          <div className="result-card">
            <p className="eyebrow">Game over</p>
            <h2 id="game-result-title">{gameState.winner === HUMAN_ID ? "You win!" : `Player ${(gameState.winner ?? 0) + 1} wins`}</h2>
            <p>{gameState.winner === HUMAN_ID ? "Perfect final discard." : "Good game — deal another hand?"}</p>
            <button type="button" className="gold-button" onClick={newGame}>Play again</button>
          </div>
        </div>
      )}
    </main>
    <DragOverlay>
      {activeDragId && gameState.cardsById[activeDragId] ? (
        <div className="drag-overlay-card">
          <CardView card={gameState.cardsById[activeDragId]} />
          {selectedIds.has(activeDragId) && selection.length > 1 && <span>+{selection.length - 1}</span>}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

export default App;
