import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Rank } from "./engine/card";
import type { MeldProposal } from "./engine/actions";
import type { PlayerActionRequest } from "./engine/authority";
import type { PlayerGameView } from "./engine/playerView";
import { GroupValidator, calculateMeldValue } from "./engine/groupValidator";
import { findMeldCandidates } from "./engine/meldFinder";
import { canTakeDiscardForOpening } from "./engine/opening";
import type { CardDTO, CardID } from "./engine/types";
import { cardAssetPath, cardBackAssetPath } from "./ui/cardAssets";

const RANK_LABEL: Record<CardDTO["rank"], string> = {
  TWO: "2", THREE: "3", FOUR: "4", FIVE: "5", SIX: "6", SEVEN: "7", EIGHT: "8", NINE: "9",
  TEN: "10", JACK: "J", QUEEN: "Q", KING: "K", ACE: "A", JOKER: "Joker",
};
const SUIT_LABEL: Record<CardDTO["suit"], string> = { CLUBS: "♣", DIAMONDS: "♦", HEARTS: "♥", SPADES: "♠", JOKER: "" };
const RANK_SORT: Record<CardDTO["rank"], number> = { JOKER: 0, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, JACK: 11, QUEEN: 12, KING: 13, ACE: 14 };
const SUIT_SORT: Record<CardDTO["suit"], number> = { JOKER: 0, CLUBS: 1, DIAMONDS: 2, HEARTS: 3, SPADES: 4 };
type TableMotion = { key: number; type: "DRAW_DECK" | "DRAW_DISCARD" | "DISCARD"; player: number; cardId?: CardID; from: { x: number; y: number }; to: { x: number; y: number } };

function label(card: CardDTO): string {
  return card.rank === Rank.JOKER ? "Joker" : `${RANK_LABEL[card.rank]}${SUIT_LABEL[card.suit]}`;
}

function FriendCard({ card, selected = false, small = false, disabled = false, onClick, badge, dragListeners, nativeDragProps }: { card?: CardDTO; selected?: boolean; small?: boolean; disabled?: boolean; onClick?: () => void; badge?: string; dragListeners?: ReturnType<typeof useSortable>["listeners"]; nativeDragProps?: ButtonHTMLAttributes<HTMLButtonElement> }) {
  const name = card ? label(card) : "Face-down card";
  const content = <><img src={card ? cardAssetPath(card) : cardBackAssetPath()} alt={name} draggable={false} />{badge && <span className="card-badge">{badge}</span>}</>;
  if (!onClick) return <span className={`playing-card ${small ? "small" : ""}`}>{content}</span>;
  return <button type="button" className={`playing-card card-button ${selected ? "selected" : ""}`} disabled={disabled} aria-label={`${selected ? "Deselect" : "Select"} ${name}`} aria-pressed={selected} onClick={onClick} {...dragListeners} {...nativeDragProps}>{content}</button>;
}

function FriendDropZone({ id, className = "", children, onNativeDrop }: { id: string; className?: string; children: ReactNode; onNativeDrop?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className} ${isOver ? "drop-active" : ""}`} onDragOver={onNativeDrop ? (event: ReactDragEvent<HTMLDivElement>) => event.preventDefault() : undefined} onDrop={onNativeDrop ? (event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); onNativeDrop(); } : undefined}>{children}</div>;
}

function SortableFriendCard({ id, index, activeIndex, dragOverIndex, recentDraw, card, selected, disabled, badge, onClick, onNativeDragStart, onNativeDragOver, onNativeDrop, onNativeDragEnd, onNodeRef }: { id: CardID; index: number; activeIndex: number; dragOverIndex: number; recentDraw: boolean; card: CardDTO; selected: boolean; disabled: boolean; badge?: string; onClick: () => void; onNativeDragStart: (id: CardID) => void; onNativeDragOver: (id: CardID) => void; onNativeDrop: (id: CardID) => void; onNativeDragEnd: () => void; onNodeRef: (node: HTMLDivElement | null) => void }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const distance = dragOverIndex < 0 ? 99 : Math.abs(index - dragOverIndex);
  const direction = index < dragOverIndex ? -1 : 1;
  const insertion = activeIndex >= 0 && dragOverIndex === index && activeIndex !== dragOverIndex ? activeIndex < dragOverIndex ? "drop-gap-after" : "drop-gap-before" : "";
  const slotTransition = [transition, "margin-left .2s cubic-bezier(.2,.82,.3,1)", "margin-right .2s cubic-bezier(.2,.82,.3,1)"].filter(Boolean).join(", ");
  return <div ref={(node) => { setNodeRef(node); onNodeRef(node); }} className={`hand-card-slot ${isDragging ? "dragging" : ""} ${distance <= 3 ? "drag-neighbor" : ""} ${recentDraw ? "recently-drawn" : ""} ${insertion}`} style={{ transform: CSS.Transform.toString(transform), transition: slotTransition, "--drag-lift": `${Math.max(0, 6 - distance * 1.5)}px`, "--drag-tilt": `${direction * Math.max(0, 1.1 - distance * .25)}deg` } as CSSProperties}><FriendCard card={card} selected={selected} disabled={disabled} badge={badge} onClick={onClick} dragListeners={listeners} nativeDragProps={{ draggable: true, onDragStart: (event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); onNativeDragStart(id); }, onDragOver: (event) => { event.preventDefault(); onNativeDragOver(id); }, onDrop: (event) => { event.preventDefault(); onNativeDrop(id); }, onDragEnd: onNativeDragEnd }} /></div>;
}

export type TablePlayer = { id: number; name: string; avatar?: string };

export type GameTableProps = {
  game: PlayerGameView;
  players: TablePlayer[];
  modeLabel: string;
  turnDeadlineAt?: number | null;
  onAction: (request: PlayerActionRequest) => Promise<PlayerGameView>;
  onResetTurn: () => Promise<PlayerGameView>;
  onLeave: () => void;
  onSettings: () => void;
  onNewGame?: () => void;
};

export function GameTable({ game, players, modeLabel, turnDeadlineAt = null, onAction, onResetTurn, onLeave, onSettings, onNewGame }: GameTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<CardID>>(new Set());
  const [draftGroups, setDraftGroups] = useState<MeldProposal[]>([]);
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null);
  const [selectedJokerId, setSelectedJokerId] = useState<CardID | null>(null);
  const [sortMode, setSortMode] = useState<"rank" | "suit" | "custom">("rank");
  const [manualOrder, setManualOrder] = useState<CardID[]>(game.ownHand);
  const [activeDragId, setActiveDragId] = useState<CardID | null>(null);
  const [dragOverId, setDragOverId] = useState<CardID | null>(null);
  const [recentDrawId, setRecentDrawId] = useState<CardID | null>(null);
  const [tableMotion, setTableMotion] = useState<TableMotion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clockNow, setClockNow] = useState(Date.now());
  const tableShellRef = useRef<HTMLDivElement>(null);
  const drawPileRef = useRef<HTMLButtonElement>(null);
  const discardPileRef = useRef<HTMLButtonElement>(null);
  const handPanelRef = useRef<HTMLElement>(null);
  const handCardsRef = useRef<HTMLDivElement>(null);
  const handCardRefs = useRef(new Map<CardID, HTMLDivElement>());
  const playerSeatRefs = useRef(new Map<number, HTMLDivElement>());
  const seenEvents = useRef(new Set(game.events.map((event) => event.id)));
  const sensors = useSensors(useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }));

  const selection = useMemo(() => [...selectedIds], [selectedIds]);
  const stagedIds = useMemo(() => new Set(draftGroups.flatMap((group) => group.cardIds)), [draftGroups]);
  const orderedHand = useMemo(() => sortMode === "custom" ? [...manualOrder.filter((id) => game.ownHand.includes(id)), ...game.ownHand.filter((id) => !manualOrder.includes(id))] : [...game.ownHand].sort((a, b) => {
    const cardA = game.cardsById[a];
    const cardB = game.cardsById[b];
    return sortMode === "rank"
      ? RANK_SORT[cardA.rank] - RANK_SORT[cardB.rank] || SUIT_SORT[cardA.suit] - SUIT_SORT[cardB.suit]
      : SUIT_SORT[cardA.suit] - SUIT_SORT[cardB.suit] || RANK_SORT[cardA.rank] - RANK_SORT[cardB.rank];
  }), [game.cardsById, game.ownHand, manualOrder, sortMode]);
  const candidate = useMemo(() => findMeldCandidates(selection, game.cardsById).find((option) => option.cardIds.length === selection.length), [game.cardsById, selection]);
  const draftPoints = useMemo(() => draftGroups.reduce((sum, group) => {
    const result = GroupValidator.validateMeld(group.cardIds.map((id) => game.cardsById[id]), { kind: group.kind, aceMode: group.aceMode, fixedJokerMap: group.jokerMap });
    return sum + (result.ok ? result.points : 0);
  }, 0), [draftGroups, game.cardsById]);
  const isMyTurn = game.currentTurn === game.viewer && game.phase !== "GAME_OVER";
  const opened = game.playersPublic[game.viewer].opened;
  const selectedDiscard = selection.length === 1 ? selection[0] : null;
  const topDiscard = game.topDiscardId ? game.cardsById[game.topDiscardId] : undefined;
  const canDrawDiscard = Boolean(topDiscard && (opened || canTakeDiscardForOpening(game.ownHand, game.topDiscardId!, game.cardsById)));
  const activeHandIndex = activeDragId ? orderedHand.indexOf(activeDragId) : -1;
  const selectedReplacement = selection.length === 1 ? selection[0] : null;
  const canSwapJoker = Boolean(opened && selectedMeldId && selectedJokerId && selectedReplacement);
  const remainingTurnMs = turnDeadlineAt === null ? 0 : Math.max(0, turnDeadlineAt - clockNow);
  const remainingTurnSeconds = Math.ceil(remainingTurnMs / 1000);
  const turnProgress = game.turnTimeLimitMs ? Math.min(1, remainingTurnMs / game.turnTimeLimitMs) : 0;
  const timerUrgent = remainingTurnMs <= 10_000;

  const createTableMotion = useCallback((type: TableMotion["type"], player: number, cardId?: CardID): TableMotion => {
    const table = tableShellRef.current;
    const playerTarget = player === game.viewer ? type !== "DISCARD" && cardId ? handCardRefs.current.get(cardId) ?? handPanelRef.current : handPanelRef.current : playerSeatRefs.current.get(player);
    const source = type === "DRAW_DECK" ? drawPileRef.current : type === "DRAW_DISCARD" ? discardPileRef.current : playerTarget;
    const destination = type === "DISCARD" ? discardPileRef.current : playerTarget;
    const center = (element: Element | null | undefined): { x: number; y: number } => {
      if (!table || !element) return { x: 0, y: 0 };
      const tableRect = table.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return { x: rect.left - tableRect.left + rect.width / 2, y: rect.top - tableRect.top + rect.height / 2 };
    };
    return { key: Date.now(), type, player, cardId, from: center(source), to: center(destination) };
  }, [game.viewer]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => game.ownHand.includes(id))));
    setManualOrder((current) => [...current.filter((id) => game.ownHand.includes(id)), ...game.ownHand.filter((id) => !current.includes(id))]);
    if (!isMyTurn) {
      setDraftGroups([]);
      setSelectedMeldId(null);
      setSelectedJokerId(null);
    }
  }, [game.ownHand, game.turnNumber, isMyTurn]);

  useEffect(() => {
    if (!tableMotion) return;
    const timer = window.setTimeout(() => setTableMotion(null), 1_150);
    return () => window.clearTimeout(timer);
  }, [tableMotion]);

  useEffect(() => {
    if (!recentDrawId) return;
    const timer = window.setTimeout(() => setRecentDrawId(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [recentDrawId]);

  useEffect(() => {
    if (turnDeadlineAt === null || game.phase === "GAME_OVER") return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game.phase, game.turnNumber, turnDeadlineAt]);

  useEffect(() => {
    const newEvents = game.events.filter((event) => !seenEvents.current.has(event.id));
    newEvents.forEach((event) => seenEvents.current.add(event.id));
    const visualEvents = newEvents.filter((event) => event.player !== undefined && event.player !== game.viewer && (event.type === "DRAW_DECK" || event.type === "DRAW_DISCARD" || event.type === "DISCARD"));
    const timers = visualEvents.map((event, index) => window.setTimeout(() => setTableMotion(createTableMotion(event.type as TableMotion["type"], event.player!, event.cardId)), index * 760));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [createTableMotion, game.events, game.viewer]);

  async function send(request: PlayerActionRequest): Promise<PlayerGameView> {
    const updated = await onAction(request);
    updated.events.filter((event) => event.player === game.viewer).forEach((event) => seenEvents.current.add(event.id));
    if (request.type === "DRAW_DECK" || request.type === "DRAW_DISCARD" || request.type === "DISCARD") {
      const cardId = request.type === "DISCARD" ? request.cardId[0] : updated.lastDrawnCardId ?? undefined;
      if (request.type === "DRAW_DECK" || request.type === "DRAW_DISCARD") setRecentDrawId(cardId ?? null);
      window.requestAnimationFrame(() => {
        if (request.type !== "DISCARD" && cardId) {
          const cardNode = handCardRefs.current.get(cardId);
          const handNode = handCardsRef.current;
          if (cardNode && handNode) handNode.scrollLeft = Math.max(0, cardNode.offsetLeft - (handNode.clientWidth - cardNode.offsetWidth) / 2);
          window.requestAnimationFrame(() => setTableMotion(createTableMotion(request.type, game.viewer, cardId)));
          return;
        }
        setTableMotion(createTableMotion(request.type, game.viewer, cardId));
      });
    }
    return updated;
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The game action failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggleCard(id: CardID): void {
    if (!isMyTurn || (game.phase !== "ACTION" && game.phase !== "DISCARD") || stagedIds.has(id)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent): void {
    const id = String(event.active.id);
    setActiveDragId(id);
    setDragOverId(id);
  }

  function handleDragOver(event: DragOverEvent): void {
    setDragOverId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    if (event.over) handleCardDrop(String(event.active.id), String(event.over.id));
    else { setActiveDragId(null); setDragOverId(null); }
  }

  function handleCardDrop(activeId: CardID, overId: string): void {
    setActiveDragId(null);
    setDragOverId(null);
    const draggedIds = selectedIds.has(activeId) ? selection : [activeId];
    if (overId === "discard-drop") {
      if (!isMyTurn || (game.phase !== "ACTION" && game.phase !== "DISCARD")) return;
      void finishTurn(activeId);
      return;
    }
    if (overId === "table-meld-drop" || overId.startsWith("meld:")) {
      if (!isMyTurn || game.phase !== "ACTION") return;
      const meldId = overId.startsWith("meld:") ? overId.slice(5) : undefined;
      const draggedCandidate = findMeldCandidates(draggedIds, game.cardsById).find((option) => option.cardIds.length === draggedIds.length);
      if (!opened) {
        if (!draggedCandidate) { setError("Those cards do not form a valid set or run."); return; }
        setDraftGroups((groups) => [...groups, { cardIds: draggedIds, kind: draggedCandidate.validation.kind, aceMode: draggedCandidate.validation.aceMode, jokerMap: draggedCandidate.validation.jokerMap }]);
        setSelectedIds(new Set());
        return;
      }
      if (meldId) {
        void perform(async () => { await send({ type: "ADD_TO_MELD", meldId, cardIds: draggedIds }); setSelectedIds(new Set()); });
        return;
      }
      if (!draggedCandidate) { setError("Those cards do not form a valid new meld."); return; }
      void perform(async () => { await send({ type: "LAY_MELD", cardIds: draggedIds, kind: draggedCandidate.validation.kind, aceMode: draggedCandidate.validation.aceMode, jokerMap: draggedCandidate.validation.jokerMap }); setSelectedIds(new Set()); });
      return;
    }
    const oldIndex = orderedHand.indexOf(activeId);
    const newIndex = orderedHand.indexOf(overId);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      setManualOrder(arrayMove(orderedHand, oldIndex, newIndex));
      setSortMode("custom");
    }
  }

  function stageSelection(): void {
    if (!candidate) {
      setError("Those cards do not form a valid set or run.");
      return;
    }
    setDraftGroups((groups) => [...groups, { cardIds: selection, kind: candidate.validation.kind, aceMode: candidate.validation.aceMode, jokerMap: candidate.validation.jokerMap }]);
    setSelectedIds(new Set());
    setError("");
  }

  async function playSelection(): Promise<void> {
    if (!opened) {
      stageSelection();
      return;
    }
    if (selectedMeldId) {
      await perform(async () => {
        await send({ type: "ADD_TO_MELD", meldId: selectedMeldId, cardIds: selection });
        setSelectedIds(new Set());
        setSelectedMeldId(null);
      });
      return;
    }
    if (!candidate) {
      setError("Those cards do not form a valid new meld.");
      return;
    }
    await perform(async () => {
      await send({ type: "LAY_MELD", cardIds: selection, kind: candidate.validation.kind, aceMode: candidate.validation.aceMode, jokerMap: candidate.validation.jokerMap });
      setSelectedIds(new Set());
    });
  }

  async function swapJoker(): Promise<void> {
    if (!selectedMeldId || !selectedJokerId || !selectedReplacement) return;
    await perform(async () => {
      await send({ type: "SWAP_JOKER", meldId: selectedMeldId, jokerId: selectedJokerId, replaceWithId: selectedReplacement });
      setSelectedIds(new Set());
      setSelectedJokerId(null);
    });
  }

  async function finishTurn(cardId: CardID | null = selectedDiscard): Promise<void> {
    if (!cardId) return;
    await perform(async () => {
      if (game.phase === "ACTION") {
        if (!opened && draftGroups.length > 0) await send({ type: "OPEN_MULTI", groups: draftGroups });
        await send({ type: "PASS_ACTION" });
      }
      await send({ type: "DISCARD", cardId: [cardId] });
      setSelectedIds(new Set());
      setDraftGroups([]);
    });
  }

  async function undoTurn(): Promise<void> {
    if (draftGroups.length > 0) {
      setDraftGroups([]);
      setSelectedIds(new Set());
      return;
    }
    await perform(async () => {
      await onResetTurn();
      setDraftGroups([]);
      setSelectedIds(new Set());
    });
  }

  const playerName = (id: number) => players.find((player) => player.id === id)?.name ?? `Player ${id + 1}`;
  const turnName = playerName(game.currentTurn);
  const winnerName = playerName(game.winner ?? 0);
  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveDragId(null); setDragOverId(null); }}>
    <main className="app-shell game-table-app">
      <header className="topbar">
        <div><p className="eyebrow">The family rummy game</p><h1>Card51</h1></div>
        <div className="new-game-controls"><span className="session-mode">{modeLabel}</span><button type="button" onClick={onSettings}>Settings</button><button type="button" onClick={onLeave}>Home</button>{onNewGame && <button type="button" className="gold-button" onClick={onNewGame}>New game</button>}</div>
      </header>

      <section className="status-strip" aria-live="polite">
        <strong>{game.phase === "GAME_OVER" ? `${winnerName} wins!` : isMyTurn ? "Your turn" : `${turnName}'s turn`}</strong>
        <span>{game.phase === "DRAW" ? "Draw a card" : game.phase === "GAME_OVER" ? "Game over" : "Play or discard"}</span>
        <span>Turn {game.turnNumber}</span>
      </section>
      {error && <div className="error-banner" role="alert">{error}</div>}

      {game.lastBurnedMeld && (
        <div className="burn-banner" role="status"><div><strong>Complete {game.lastBurnedMeld.kind.toLowerCase()} burnt into the trash</strong><span>A normal discard is still required.</span></div><div className="burned-cards">{game.lastBurnedMeld.cardIds.map((id) => <FriendCard key={id} card={game.cardsById[id]} small />)}</div></div>
      )}

      <div className="game-layout">
        <div ref={tableShellRef} className={`table-shell ${isMyTurn ? "your-turn" : "waiting-turn"} ${isMyTurn && turnDeadlineAt !== null ? "has-own-timer" : ""} ${activeDragId ? "dragging-card" : ""}`}>
          <section className="opponents" aria-label="Opponents">
            {players.map((player) => player.id === game.viewer ? null : (
              <div ref={(node) => { if (node) playerSeatRefs.current.set(player.id, node); else playerSeatRefs.current.delete(player.id); }} className={`player-chip ${player.id === game.currentTurn ? "current" : ""} ${tableMotion?.player === player.id ? "motion-pulse" : ""}`} key={player.id}>
                <div className="player-avatar">{player.avatar ?? player.name.slice(0, 1).toUpperCase()}</div>
                <div className="player-copy"><span>{player.name}</span><strong>{game.playersPublic[player.id].handCount} cards</strong><small>{game.playersPublic[player.id].opened ? "Opened" : "Closed"}</small></div>
                <div className="seat-card-stack" aria-hidden="true"><i /><i /><i /></div>
                {turnDeadlineAt !== null && player.id === game.currentTurn && <div className={`opponent-turn-timer ${timerUrgent ? "urgent" : ""}`} role="progressbar" aria-label={`${remainingTurnSeconds} seconds left in ${player.name}'s turn`} aria-valuemin={0} aria-valuemax={game.turnTimeLimitMs ? game.turnTimeLimitMs / 1000 : 0} aria-valuenow={remainingTurnSeconds}><i style={{ "--turn-progress": turnProgress } as CSSProperties} /></div>}
              </div>
            ))}
          </section>

          {tableMotion && <div key={tableMotion.key} className={`table-motion motion-${tableMotion.type.toLowerCase()} ${tableMotion.player === game.viewer ? "motion-human" : "motion-bot"}`} style={{ "--motion-from-x": `${tableMotion.from.x}px`, "--motion-from-y": `${tableMotion.from.y}px`, "--motion-to-x": `${tableMotion.to.x}px`, "--motion-to-y": `${tableMotion.to.y}px` } as CSSProperties} aria-live="polite"><FriendCard card={(tableMotion.player !== game.viewer && tableMotion.type === "DRAW_DECK") || !tableMotion.cardId ? undefined : game.cardsById[tableMotion.cardId]} small /><span>{tableMotion.player === game.viewer ? "You" : playerName(tableMotion.player)} {tableMotion.type === "DISCARD" ? "discarded" : "drew"}</span></div>}

          <section className="table-area">
            <div className="piles">
              <button ref={drawPileRef} className={`pile-button ${tableMotion?.type === "DRAW_DECK" ? "motion-pulse" : ""}`} type="button" disabled={busy || !isMyTurn || game.phase !== "DRAW" || game.deckCount === 0} onClick={() => perform(async () => { await send({ type: "DRAW_DECK" }); })}><span>Draw pile</span><FriendCard /><strong>{game.deckCount}</strong></button>
              <FriendDropZone id="discard-drop" className="discard-drop-zone" onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, "discard-drop")}><button ref={discardPileRef} className={`pile-button ${tableMotion?.type === "DRAW_DISCARD" || tableMotion?.type === "DISCARD" ? "motion-pulse" : ""}`} type="button" disabled={busy || !isMyTurn || game.phase !== "DRAW" || !canDrawDiscard} onClick={() => perform(async () => { await send({ type: "DRAW_DISCARD" }); })}><span>Discard pile</span>{topDiscard ? <FriendCard card={topDiscard} /> : <span className="empty-pile">Empty</span>}<strong>{topDiscard ? 1 : 0}</strong></button></FriendDropZone>
            </div>

            <FriendDropZone id="table-meld-drop" className="meld-drop-zone" onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, "table-meld-drop")}><div className="meld-board">
              <div className="section-heading"><div><p className="eyebrow">Shared table</p><h2>Active melds</h2></div><span>{game.tableMelds.length}</span></div>
              {draftGroups.length > 0 && <div className="staged-table-melds">{draftGroups.map((group, index) => <article className="meld-card staged-meld" key={`${group.cardIds.join("-")}-${index}`}><button type="button" className="meld-heading" onClick={() => setDraftGroups((groups) => groups.filter((_, groupIndex) => groupIndex !== index))}>Staged meld · remove</button><div className="meld-cards">{group.cardIds.map((id) => <FriendCard key={id} card={game.cardsById[id]} small />)}</div><span className="meld-owner">Opening total: {draftPoints} / 51</span></article>)}</div>}
              {game.tableMelds.length === 0 && draftGroups.length === 0 ? <p className="empty-message">No active melds yet. Complete four-card sets and full runs burn automatically.</p> : <div className="meld-grid">{game.tableMelds.map((meld) => <FriendDropZone id={`meld:${meld.id}`} className="meld-card-drop" key={meld.id} onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, `meld:${meld.id}`)}><article className={`meld-card ${selectedMeldId === meld.id ? "selected-meld" : ""}`}><button type="button" className="meld-heading" onClick={() => { setSelectedMeldId(selectedMeldId === meld.id ? null : meld.id); setSelectedJokerId(null); }}>{meld.kind} · {calculateMeldValue(meld, game.cardsById)} pts</button><div className="meld-cards">{meld.cardIds.map((id) => <FriendCard key={id} card={game.cardsById[id]} small selected={selectedJokerId === id} onClick={game.cardsById[id].rank === Rank.JOKER ? () => { setSelectedMeldId(meld.id); setSelectedJokerId(id); } : () => { setSelectedMeldId(meld.id); setSelectedJokerId(null); }} />)}</div><span className="meld-owner">Created by {playerName(meld.owner)}</span></article></FriendDropZone>)}</div>}
            </div></FriendDropZone>
          </section>

          <section className="action-panel">
            <div className="section-heading"><div><p className="eyebrow">Turn flow</p><h2>{isMyTurn ? "Your move" : `${turnName} is playing…`}</h2></div>{!opened && draftGroups.length > 0 && <span>Opening · {draftPoints} pts</span>}</div>
            {isMyTurn && game.phase === "DRAW" && <p className="instruction"><strong>Start by drawing.</strong> Choose the deck or discard pile above.</p>}
            {isMyTurn && game.phase !== "DRAW" && game.phase !== "GAME_OVER" && <div className="action-stack"><p className="instruction">{opened ? selectedMeldId ? selectedJokerId ? "Select its natural replacement from your hand." : "Add selected cards to this meld." : "Select cards to create a meld, or select a table meld to extend." : `Stage opening melds worth at least 51 points. Current total: ${draftPoints}.`}</p><div className="button-row"><button type="button" disabled={busy || selection.length === 0 || (!selectedMeldId && !candidate)} onClick={playSelection}>{opened ? selectedMeldId ? "Add to meld" : "Play meld" : "Move selection to table"}</button>{canSwapJoker && <button type="button" disabled={busy} onClick={swapJoker}>Replace Joker</button>}<button type="button" disabled={busy} onClick={undoTurn}>Undo table moves</button><button type="button" className="gold-button" disabled={busy || !selectedDiscard} onClick={() => finishTurn()}>Discard & end turn</button></div></div>}
            {!isMyTurn && game.phase !== "GAME_OVER" && <p className="instruction waiting-copy">Watch the table — their committed plays and discard will appear here.</p>}
          </section>

          {isMyTurn && turnDeadlineAt !== null && game.phase !== "GAME_OVER" && <section className={`table-turn-timer ${timerUrgent ? "urgent" : ""}`} aria-label={`${remainingTurnSeconds} seconds left in your turn`}><div className="turn-timer-copy"><span>Your time</span><strong>{remainingTurnSeconds}<small>s</small></strong></div><div className="turn-timer-track" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={game.turnTimeLimitMs ? game.turnTimeLimitMs / 1000 : 0} aria-valuenow={remainingTurnSeconds}><i style={{ "--turn-progress": turnProgress } as CSSProperties} /></div></section>}

          <section ref={handPanelRef} className={`hand-panel ${tableMotion?.player === game.viewer ? "motion-pulse" : ""}`}>
            <div className="section-heading"><div className="you-heading"><span className="player-avatar you-avatar">YOU</span><div><p className="eyebrow">Your seat · {opened ? "Opened" : "Closed"}</p><h2>Your hand · {game.ownHand.length}</h2></div></div><div className="sort-controls"><button type="button" aria-pressed={sortMode === "rank"} onClick={() => setSortMode("rank")}>By rank</button><button type="button" aria-pressed={sortMode === "suit"} onClick={() => setSortMode("suit")}>By suit</button></div></div>
            <p className="drag-hint">Drag to reorder · Select several cards, then drag them to the table · Drag one to the discard pile to end your turn</p>
            <SortableContext items={orderedHand} strategy={horizontalListSortingStrategy}><div ref={handCardsRef} className={`hand-cards ${activeDragId ? "live-reordering" : ""}`}>{orderedHand.map((id, index) => <SortableFriendCard key={id} id={id} index={index} activeIndex={activeHandIndex} dragOverIndex={dragOverId ? orderedHand.indexOf(dragOverId) : -1} recentDraw={recentDrawId === id} card={game.cardsById[id]} selected={selectedIds.has(id)} disabled={stagedIds.has(id)} badge={stagedIds.has(id) ? "Staged" : undefined} onClick={() => toggleCard(id)} onNativeDragStart={(dragId) => { setActiveDragId(dragId); setDragOverId(dragId); }} onNativeDragOver={setDragOverId} onNativeDrop={(targetId) => activeDragId && handleCardDrop(activeDragId, targetId)} onNativeDragEnd={() => { setActiveDragId(null); setDragOverId(null); }} onNodeRef={(node) => { if (node) handCardRefs.current.set(id, node); else handCardRefs.current.delete(id); }} />)}</div></SortableContext>
          </section>
        </div>

        <aside className="lower-grid"><details className="history-panel"><summary>Game history <span>{game.events.length}</span></summary>{game.events.length === 0 ? <p className="empty-message">No actions yet.</p> : <ol>{game.events.slice(-10).reverse().map((event) => <li key={event.id}>{event.message}</li>)}</ol>}</details><details className="rules-panel"><summary>Rules quick reference</summary><p>The complete authoritative specification is stored in <code>RULES.md</code>.</p></details></aside>
      </div>

      {game.phase === "GAME_OVER" && <div className={`game-result-overlay ${game.winner === game.viewer ? "victory" : "defeat"}`} role="dialog" aria-modal="true"><div className="result-particles" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div><div className="result-card"><p className="eyebrow">Game over</p><h2>{game.winner === game.viewer ? "You win!" : `${winnerName} wins`}</h2><p>{game.winner === game.viewer ? "Perfect final discard." : "Good game."}</p><button type="button" className="gold-button" onClick={onLeave}>Return home</button></div></div>}
    </main>
    <DragOverlay>{activeDragId && game.cardsById[activeDragId] ? <div className="drag-overlay-card"><FriendCard card={game.cardsById[activeDragId]} />{selectedIds.has(activeDragId) && selection.length > 1 && <span>+{selection.length - 1}</span>}</div> : null}</DragOverlay>
    </DndContext>
  );
}
