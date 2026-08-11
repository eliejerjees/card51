import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
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
import { BotGame, type BotGameSession } from "./BotGame";
import { FriendsGame } from "./FriendsGame";
import { Rank } from "./engine/card";
import type { Action, MeldProposal } from "./engine/actions";
import { AuthoritativeGame } from "./engine/authority";
import { chooseBotAction } from "./engine/bot";
import { GroupValidator, calculateMeldValue } from "./engine/groupValidator";
import { findMeldCandidates } from "./engine/meldFinder";
import { canTakeDiscardForOpening } from "./engine/opening";
import { createPlayerView } from "./engine/playerView";
import { applyAction, initGame } from "./engine/state";
import type { CardDTO, CardID, GameState, Meld } from "./engine/types";
import { addFriendLobbyBot, createFriendLobby, getFriendLobby, joinFriendLobby, leaveFriendLobby, removeFriendLobbySeat, startFriendLobby, updateFriendLobbySettings } from "./online/friendsClient";
import type { LobbySnapshot } from "./online/lobbyService";
import { cardAssetPath, cardBackAssetPath } from "./ui/cardAssets";

const HUMAN_ID = 0;
type AppScreen = "HOME" | "BOTS" | "ONLINE" | "FRIENDS" | "SETTINGS" | "GAME";
type FriendsStep = "CHOICE" | "JOIN" | "LOBBY";
type StoredFriendSession = { userId: string; displayName: string; lobbyId: string; inviteCode: string };
const FRIEND_SESSION_BASE_KEY = "card51.friend-session.v1";
const TAB_NAME_PREFIX = "card51-tab:";
const TURN_TIME_OPTIONS = [
  { value: null, label: "No time limit" },
  { value: 30_000, label: "30 seconds" },
  { value: 60_000, label: "1 minute" },
  { value: 90_000, label: "1 minute 30 seconds" },
  { value: 120_000, label: "2 minutes" },
] as const;

function friendSessionKey(): string {
  if (!window.name.startsWith(TAB_NAME_PREFIX)) window.name = `${TAB_NAME_PREFIX}${crypto.randomUUID()}`;
  return `${FRIEND_SESSION_BASE_KEY}:${window.name.slice(TAB_NAME_PREFIX.length)}`;
}

const FRIEND_SESSION_KEY = friendSessionKey();

function readFriendSession(): StoredFriendSession | null {
  try {
    const raw = window.sessionStorage.getItem(FRIEND_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredFriendSession>;
    if (!value.userId || !value.displayName || !value.lobbyId || !value.inviteCode) return null;
    return value as StoredFriendSession;
  } catch {
    return null;
  }
}

function writeFriendSession(session: StoredFriendSession): void {
  window.sessionStorage.setItem(FRIEND_SESSION_KEY, JSON.stringify(session));
}

function clearFriendSession(): void {
  window.sessionStorage.removeItem(FRIEND_SESSION_KEY);
}

type TableMotion = {
  key: number;
  type: "DRAW_DECK" | "DRAW_DISCARD" | "DISCARD";
  player: number;
  cardId?: CardID;
  from: { x: number; y: number };
  to: { x: number; y: number };
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

function ModeIcon({ type, className = "mode-icon" }: { type: "online" | "friends" | "bots"; className?: string }) {
  return <span className={className} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {type === "online" && <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21M12 3c-2.4 2.5-3.6 5.5-3.6 9S9.6 18.5 12 21" /></>}
    {type === "friends" && <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3.5 2.3-5.5 5.5-5.5s5 2 5.5 5.5" /><circle cx="17" cy="9" r="2.3" /><path d="M15.2 14.4c3.3-.8 5.1.8 5.5 3.6" /></>}
    {type === "bots" && <><path d="M12 3v3M9.5 3h5" /><rect x="3" y="6" width="18" height="14" rx="3" /><circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" /><path d="M8 16h8M3 11H1.5M22.5 11H21" /></>}
  </svg></span>;
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
  index,
  activeIndex,
  dragOverIndex,
  recentDraw,
  card,
  selected,
  disabled,
  onClick,
  badge,
  onNativeDragStart,
  onNativeDragOver,
  onNativeDrop,
  onNativeDragEnd,
  onNodeRef,
}: {
  id: CardID;
  index: number;
  activeIndex: number;
  dragOverIndex: number;
  recentDraw: boolean;
  card: CardDTO;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  badge?: string;
  onNativeDragStart: (id: CardID) => void;
  onNativeDragOver: (id: CardID) => void;
  onNativeDrop: (id: CardID) => void;
  onNativeDragEnd: () => void;
  onNodeRef: (node: HTMLDivElement | null) => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const dragDistance = dragOverIndex < 0 ? 99 : Math.abs(index - dragOverIndex);
  const dragDirection = index < dragOverIndex ? -1 : 1;
  const dragLift = Math.max(0, 6 - dragDistance * 1.5);
  const dragTilt = dragDirection * Math.max(0, 1.1 - dragDistance * 0.25);
  const isInsertionTarget = activeIndex >= 0 && dragOverIndex === index && activeIndex !== dragOverIndex;
  const insertionClass = !isInsertionTarget ? "" : activeIndex < dragOverIndex ? "drop-gap-after" : "drop-gap-before";
  const slotTransition = [transition, "margin-left .2s cubic-bezier(.2,.82,.3,1)", "margin-right .2s cubic-bezier(.2,.82,.3,1)"].filter(Boolean).join(", ");
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        onNodeRef(node);
      }}
      className={`hand-card-slot ${isDragging ? "dragging" : ""} ${dragDistance <= 3 ? "drag-neighbor" : ""} ${recentDraw ? "recently-drawn" : ""} ${insertionClass}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: slotTransition,
        "--drag-lift": `${dragLift}px`,
        "--drag-tilt": `${dragTilt}deg`,
      } as CSSProperties}
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
          onDragOver: (event) => {
            event.preventDefault();
            onNativeDragOver(id);
          },
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
  const [initialFriendSession] = useState<StoredFriendSession | null>(() => readFriendSession());
  const initialInviteCode = new URLSearchParams(window.location.search).get("lobby")?.toUpperCase() ?? "";
  const [screen, setScreen] = useState<AppScreen>(initialFriendSession || initialInviteCode ? "FRIENDS" : "HOME");
  const [settingsReturnScreen, setSettingsReturnScreen] = useState<AppScreen>("HOME");
  const [botCount, setBotCount] = useState(1);
  const [friendsStep, setFriendsStep] = useState<FriendsStep>(initialFriendSession ? "LOBBY" : initialInviteCode ? "JOIN" : "CHOICE");
  const [friendUserId] = useState(() => initialFriendSession?.userId ?? crypto.randomUUID());
  const [friendName, setFriendName] = useState(initialFriendSession?.displayName ?? "");
  const [friendCode, setFriendCode] = useState(initialFriendSession?.inviteCode ?? initialInviteCode);
  const friendTurnPickerRef = useRef<HTMLDetailsElement>(null);
  const [friendLobby, setFriendLobby] = useState<LobbySnapshot | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendError, setFriendError] = useState("");
  const [friendRestoring, setFriendRestoring] = useState(Boolean(initialFriendSession));
  const [inviteCopied, setInviteCopied] = useState(false);
  const [numPlayers, setNumPlayers] = useState(2);
  const botGameSession = useRef<BotGameSession>({ authority: new AuthoritativeGame(2) });
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
  const [dragOverId, setDragOverId] = useState<CardID | null>(null);
  const [recentDrawId, setRecentDrawId] = useState<CardID | null>(null);
  const [tableMotion, setTableMotion] = useState<TableMotion | null>(null);
  const tableShellRef = useRef<HTMLDivElement>(null);
  const drawPileRef = useRef<HTMLButtonElement>(null);
  const discardPileRef = useRef<HTMLButtonElement>(null);
  const handPanelRef = useRef<HTMLElement>(null);
  const handCardsRef = useRef<HTMLDivElement>(null);
  const handCardRefs = useRef(new Map<CardID, HTMLDivElement>());
  const playerSeatRefs = useRef(new Map<number, HTMLDivElement>());
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );
  const friendLobbyId = friendLobby?.id;

  useEffect(() => {
    const closeTurnPicker = (event: PointerEvent | KeyboardEvent) => {
      const picker = friendTurnPickerRef.current;
      if (!picker?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        picker.removeAttribute("open");
        picker.querySelector("summary")?.focus();
        return;
      }
      if (event instanceof PointerEvent && event.target instanceof Node && !picker.contains(event.target)) picker.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeTurnPicker);
    document.addEventListener("keydown", closeTurnPicker);
    return () => {
      document.removeEventListener("pointerdown", closeTurnPicker);
      document.removeEventListener("keydown", closeTurnPicker);
    };
  }, []);

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

  const createTableMotion = useCallback((type: TableMotion["type"], player: number, cardId?: CardID): TableMotion => {
    const table = tableShellRef.current;
    const playerTarget = player === HUMAN_ID
      ? type !== "DISCARD" && cardId ? handCardRefs.current.get(cardId) ?? handPanelRef.current : handPanelRef.current
      : playerSeatRefs.current.get(player);
    const source = type === "DRAW_DECK"
      ? drawPileRef.current
      : type === "DRAW_DISCARD" ? discardPileRef.current : playerTarget;
    const destination = type === "DISCARD" ? discardPileRef.current : playerTarget;

    const center = (element: Element | null | undefined): { x: number; y: number } => {
      if (!table || !element) return { x: 0, y: 0 };
      const tableRect = table.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left - tableRect.left + rect.width / 2,
        y: rect.top - tableRect.top + rect.height / 2,
      };
    };

    return { key: Date.now(), type, player, cardId, from: center(source), to: center(destination) };
  }, []);

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
    if (!initialFriendSession) return;
    let active = true;
    getFriendLobby(initialFriendSession.lobbyId, initialFriendSession.userId)
      .then((lobby) => {
        if (!active) return;
        setFriendLobby(lobby);
        setFriendCode(lobby.inviteCode);
        setFriendsStep("LOBBY");
        setFriendError("");
      })
      .catch((restoreError: unknown) => {
        if (!active) return;
        clearFriendSession();
        setFriendLobby(null);
        setFriendsStep("JOIN");
        setFriendError(restoreError instanceof Error ? `${restoreError.message} Re-enter the invite code to join again.` : "The saved room could not be restored.");
      })
      .finally(() => {
        if (active) setFriendRestoring(false);
      });
    return () => { active = false; };
  }, [initialFriendSession]);

  useEffect(() => {
    if (screen !== "FRIENDS" || !friendLobbyId) return;
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const lobby = await getFriendLobby(friendLobbyId, friendUserId);
        if (active) {
          setFriendLobby(lobby);
          setFriendError("");
        }
      } catch (pollError) {
        if (active) setFriendError(pollError instanceof Error ? pollError.message : "Could not refresh the room.");
      }
    };
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [friendLobbyId, friendUserId, screen]);

  useEffect(() => {
    if (!activeDragId) return;
    const safetyTimer = window.setTimeout(() => setActiveDragId(null), 10_000);
    return () => window.clearTimeout(safetyTimer);
  }, [activeDragId]);

  useEffect(() => {
    if (screen !== "GAME" || gameState.phase === "GAME_OVER" || gameState.currentTurn === HUMAN_ID || activeDragId) return;
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
      if (animated) setTableMotion(createTableMotion(action.type as TableMotion["type"], action.player, cardId));
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
  }, [activeDragId, createTableMotion, gameState, screen]);

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
      const cardId = action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD"
        ? next.lastDrawnCardId
        : action.cardId[0];
      window.requestAnimationFrame(() => {
        if (action.player === HUMAN_ID && action.type !== "DISCARD" && cardId) {
          const cardNode = handCardRefs.current.get(cardId);
          const handNode = handCardsRef.current;
          if (cardNode && handNode) {
            handNode.scrollLeft = Math.max(0, cardNode.offsetLeft - (handNode.clientWidth - cardNode.offsetWidth) / 2);
          }
          window.requestAnimationFrame(() => {
            setTableMotion(createTableMotion(action.type, action.player, cardId));
          });
          return;
        }
        setTableMotion(createTableMotion(action.type, action.player, cardId ?? undefined));
      });
      if (action.type === "DRAW_DECK" || action.type === "DRAW_DISCARD") setRecentDrawId(cardId ?? null);
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
    setGameState(next);
    window.requestAnimationFrame(() => {
      setTableMotion(createTableMotion("DISCARD", HUMAN_ID, cardId));
    });
    setTurnBaseline(null);
    setDraftGroups([]);
    setError("");
    clearSelections();
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
    if (!event.over) {
      setActiveDragId(null);
      setDragOverId(null);
      return;
    }
    handleCardDrop(String(event.active.id), String(event.over.id));
  }

  function handleCardDrop(activeId: CardID, overId: string): void {
    setActiveDragId(null);
    setDragOverId(null);
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
    setRecentDrawId(null);
    setTurnBaseline(null);
    setDraftGroups([]);
    clearSelections();
    setError("");
  }

  function startBotGame(): void {
    const players = botCount + 1;
    const next = initGame(players);
    setNumPlayers(players);
    botGameSession.current.authority = new AuthoritativeGame(players);
    setGameState(next);
    setManualOrder(next.playersPrivate[HUMAN_ID].hand);
    setSortMode("rank");
    setRecentDrawId(null);
    setTurnBaseline(null);
    setDraftGroups([]);
    clearSelections();
    setError("");
    setScreen("GAME");
  }

  function returnHome(): void {
    if (friendLobby && friendLobby.status !== "FINISHED") void leaveFriendLobby(friendLobby.id, friendUserId).catch(() => undefined);
    setActiveDragId(null);
    setDragOverId(null);
    setTableMotion(null);
    setFriendLobby(null);
    setFriendsStep("CHOICE");
    setFriendError("");
    clearFriendSession();
    window.history.replaceState({}, "", window.location.pathname);
    setScreen("HOME");
  }

  function openSettings(): void {
    if (screen === "SETTINGS") return;
    setSettingsReturnScreen(screen);
    setScreen("SETTINGS");
  }

  function goBackFromSetup(): void {
    if (screen === "SETTINGS") {
      setScreen(settingsReturnScreen);
      return;
    }
    if (screen === "FRIENDS" && friendsStep === "LOBBY") {
      leaveFriendsRoom();
      return;
    }
    if (screen === "FRIENDS" && friendsStep !== "CHOICE") {
      setFriendsStep("CHOICE");
      setFriendError("");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    returnHome();
  }

  async function createFriendsRoom(): Promise<void> {
    const displayName = friendName.trim();
    if (!displayName) {
      setFriendError("Enter the name you want other players to see.");
      return;
    }
    setFriendBusy(true);
    setFriendError("");
    try {
      const lobby = await createFriendLobby(friendUserId, displayName);
      setFriendName(displayName);
      setFriendLobby(lobby);
      setFriendCode(lobby.inviteCode);
      setFriendsStep("LOBBY");
      writeFriendSession({ userId: friendUserId, displayName, lobbyId: lobby.id, inviteCode: lobby.inviteCode });
      window.history.replaceState({}, "", lobby.invitePath);
    } catch (requestError) {
      setFriendError(requestError instanceof Error ? requestError.message : "Could not create the room.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function joinFriendsRoom(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFriendBusy(true);
    setFriendError("");
    try {
      const lobby = await joinFriendLobby(friendUserId, friendName, friendCode);
      setFriendLobby(lobby);
      setFriendCode(lobby.inviteCode);
      setFriendsStep("LOBBY");
      writeFriendSession({ userId: friendUserId, displayName: friendName.trim(), lobbyId: lobby.id, inviteCode: lobby.inviteCode });
      window.history.replaceState({}, "", lobby.invitePath);
    } catch (requestError) {
      setFriendError(requestError instanceof Error ? requestError.message : "Could not join the room.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function addBotToFriendsRoom(): Promise<void> {
    if (!friendLobby) return;
    setFriendBusy(true);
    setFriendError("");
    try {
      setFriendLobby(await addFriendLobbyBot(friendLobby.id, friendUserId));
    } catch (requestError) {
      setFriendError(requestError instanceof Error ? requestError.message : "Could not add a bot.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function removeSeatFromFriendsRoom(targetUserId: string): Promise<void> {
    if (!friendLobby) return;
    setFriendBusy(true);
    setFriendError("");
    try {
      setFriendLobby(await removeFriendLobbySeat(friendLobby.id, friendUserId, targetUserId));
    } catch (requestError) {
      setFriendError(requestError instanceof Error ? requestError.message : "Could not remove that player.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function updateFriendsRoomSettings(turnTimeLimitMs: number | null, scoringMode: "ROUNDS" | "VALUES"): Promise<void> {
    if (!friendLobby) return;
    setFriendBusy(true);
    setFriendError("");
    try {
      setFriendLobby(await updateFriendLobbySettings(friendLobby.id, friendUserId, turnTimeLimitMs, scoringMode));
    } catch (requestError) {
      setFriendError(requestError instanceof Error ? requestError.message : "Could not update the table rules.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function startFriendsRoom(): Promise<void> {
    if (!friendLobby) return;
    setFriendBusy(true);
    setFriendError("");
    try {
      setFriendLobby(await startFriendLobby(friendLobby.id, friendUserId));
    } catch (requestError) {
      setFriendError(requestError instanceof Error ? requestError.message : "Could not start the game.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function copyFriendsInvite(): Promise<void> {
    if (!friendLobby) return;
    await navigator.clipboard.writeText(`${window.location.origin}${friendLobby.invitePath}`);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1_600);
  }

  function leaveFriendsRoom(): void {
    if (friendLobby && friendLobby.status !== "FINISHED") void leaveFriendLobby(friendLobby.id, friendUserId).catch(() => undefined);
    setFriendLobby(null);
    setFriendError("");
    setFriendsStep("CHOICE");
    clearFriendSession();
    window.history.replaceState({}, "", window.location.pathname);
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
  const activeHandIndex = activeDragId ? orderedHand.indexOf(activeDragId) : -1;
  const hasTurnChanges = Boolean(turnBaseline && (
    draftGroups.length > 0
    || gameState.phase !== turnBaseline.phase
    || gameState.playersPrivate[HUMAN_ID].hand.length !== turnBaseline.playersPrivate[HUMAN_ID].hand.length
    || JSON.stringify(gameState.tableMelds) !== JSON.stringify(turnBaseline.tableMelds)
  ));

  if (screen === "FRIENDS" && friendLobby?.game) {
    return <FriendsGame lobby={friendLobby} userId={friendUserId} onLobby={setFriendLobby} onLeave={returnHome} onSettings={openSettings} />;
  }

  if (screen === "GAME") {
    return <BotGame numPlayers={numPlayers} session={botGameSession.current} onSessionChange={(authority) => { botGameSession.current.authority = authority; }} onLeave={returnHome} onSettings={openSettings} />;
  }

  if (["HOME", "BOTS", "ONLINE", "FRIENDS", "SETTINGS"].includes(screen)) {
    return (
      <main className="home-shell">
        <header className="home-nav">
          <button type="button" className="home-brand" onClick={returnHome} aria-label="Card51 home">
            <span>51</span>
            <strong>Card51</strong>
          </button>
          <button type="button" className="settings-button" onClick={openSettings} aria-label="Open settings">
            <span aria-hidden="true">⚙</span> Settings
          </button>
        </header>

        {screen === "HOME" ? (
          <div className="home-content">
            <section className="home-hero">
              <div className="home-suits" aria-hidden="true"><i /><i /><i /><i /></div>
              <p className="eyebrow">The family rummy game</p>
              <h1>Card51</h1>
              <p className="home-tagline">Build your hand. Open with 51. Be the first to make the final discard.</p>
            </section>

            <section className="mode-section" aria-labelledby="choose-game-mode">
              <div className="home-section-heading">
                <div><p className="eyebrow">Take a seat</p><h2 id="choose-game-mode">How do you want to play?</h2></div>
                <span>2–4 players</span>
              </div>
              <div className="mode-grid">
                <button type="button" className="mode-card mode-online" onClick={() => setScreen("ONLINE")}>
                  <ModeIcon type="online" />
                  <span className="mode-copy"><small>Quick match</small><strong>Play online</strong><span>Find a table and play against other Card51 players.</span></span>
                  <span className="mode-arrow" aria-hidden="true">→</span>
                </button>
                <button type="button" className="mode-card mode-friends" onClick={() => setScreen("FRIENDS")}>
                  <ModeIcon type="friends" />
                  <span className="mode-copy"><small>Private table</small><strong>Play with friends</strong><span>Create a room or join one with an invite code.</span></span>
                  <span className="mode-arrow" aria-hidden="true">→</span>
                </button>
                <button type="button" className="mode-card mode-bots" onClick={() => setScreen("BOTS")}>
                  <ModeIcon type="bots" />
                  <span className="mode-copy"><small>Ready now</small><strong>Play against bots</strong><span>Choose your opponents and start immediately.</span></span>
                  <span className="mode-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          </div>
        ) : (
          <section className="setup-shell">
            <button type="button" className="back-button" onClick={goBackFromSetup}>← Back</button>

            {screen === "BOTS" && (
              <div className="setup-card bot-setup">
                <ModeIcon type="bots" className="setup-icon" />
                <p className="eyebrow">Solo table</p>
                <h1>Play against bots</h1>
                <p>Pick how many opponents you want at the table.</p>
                <fieldset className="bot-picker">
                  <legend>Number of bots</legend>
                  {[1, 2, 3].map((count) => (
                    <button key={count} type="button" aria-pressed={botCount === count} onClick={() => setBotCount(count)}>
                      <strong>{count}</strong><span>{count === 1 ? "Bot" : "Bots"}</span>
                    </button>
                  ))}
                </fieldset>
                <div className={`table-preview bots-${botCount}`} aria-label={`Table preview with you and ${botCount} ${botCount === 1 ? "bot" : "bots"}`}>
                  <span className="preview-seat you">You</span>
                  {Array.from({ length: botCount }, (_, index) => <span className={`preview-seat bot bot-${index + 1}`} key={index}>B{index + 1}</span>)}
                  <i>51</i>
                </div>
                <button type="button" className="gold-button start-game-button" onClick={startBotGame}>Deal the cards</button>
              </div>
            )}

            {screen === "ONLINE" && (
              <div className="setup-card future-mode">
                <ModeIcon type="online" className="setup-icon" />
                <p className="eyebrow">Quick match</p>
                <h1>Play online</h1>
                <p>Matchmaking will connect you with an open Card51 table. The game rules and secure multiplayer foundation are ready; the live connection screen is next.</p>
                <div className="future-status"><span>Online matchmaking</span><strong>Coming next</strong></div>
                <button type="button" className="gold-button start-game-button" disabled>Find a game</button>
              </div>
            )}

            {screen === "FRIENDS" && (
              <div className={`setup-card friends-setup friends-${friendsStep.toLowerCase()} ${friendLobby?.status === "PLAYING" ? "friends-playing" : ""}`}>
                <ModeIcon type="friends" className="setup-icon" />
                <p className="eyebrow">Private table</p>
                {friendsStep === "CHOICE" && (
                  <>
                    <h1>Play with friends</h1>
                    <p>Create a private Card51 room or enter the six-character code from a friend.</p>
                    <label className="friend-choice-name">Display name<input required maxLength={24} autoComplete="nickname" value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="Your name" /></label>
                    <div className="friend-choice-grid">
                      <button type="button" disabled={friendBusy || !friendName.trim()} onClick={() => createFriendsRoom()}><strong>{friendBusy ? "Creating…" : "Create a room"}</strong><span>Open a private table instantly</span></button>
                      <button type="button" onClick={() => setFriendsStep("JOIN")}><strong>Join a room</strong><span>Use a friend's invite code</span></button>
                    </div>
                    {friendError && <p className="friend-error" role="alert">{friendError}</p>}
                  </>
                )}

                {friendsStep === "JOIN" && (
                  <form className="friend-form" onSubmit={joinFriendsRoom}>
                    <h1>Join a room</h1>
                    <p>Enter your name and the invite code shared by the host.</p>
                    <label>Display name<input required maxLength={24} autoComplete="nickname" value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="Your name" /></label>
                    <label>Invite code<input required minLength={6} maxLength={6} autoCapitalize="characters" autoComplete="off" value={friendCode} onChange={(event) => setFriendCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABC123" className="invite-code-input" /></label>
                    {friendError && <p className="friend-error" role="alert">{friendError}</p>}
                    <button type="submit" className="gold-button start-game-button" disabled={friendBusy}>{friendBusy ? "Joining…" : "Join private room"}</button>
                  </form>
                )}

                {friendsStep === "LOBBY" && !friendLobby && (
                  <div className="friend-restoring" role="status"><h1>Rejoining room</h1><p>{friendRestoring ? "Restoring your seat and current game…" : "The room could not be restored."}</p></div>
                )}

                {friendsStep === "LOBBY" && friendLobby && (() => {
                  if (friendLobby.game) return <FriendsGame lobby={friendLobby} userId={friendUserId} onLobby={setFriendLobby} onLeave={returnHome} onSettings={openSettings} />;
                  const isHost = friendLobby.hostUserId === friendUserId;
                  const canStart = isHost && friendLobby.seats.length >= 2;
                  const viewerSeatIndex = Math.max(0, friendLobby.seats.findIndex((seat) => seat.userId === friendUserId));
                  const seatSlots = [...friendLobby.seats, ...Array.from({ length: friendLobby.settings.maxPlayers - friendLobby.seats.length }, () => null)];
                  const previewSeats = Array.from({ length: friendLobby.settings.maxPlayers }, (_, offset) => seatSlots[(viewerSeatIndex + offset) % friendLobby.settings.maxPlayers]);
                  return (
                    <div className="friend-lobby">
                      <h1>{friendLobby.status === "WAITING" ? "Your room" : "Game started"}</h1>
                      <div className="invite-panel">
                        <span>Invite code</span>
                        <strong>{friendLobby.inviteCode}</strong>
                        <button type="button" onClick={copyFriendsInvite}>{inviteCopied ? "Copied!" : "Copy invite link"}</button>
                      </div>
                      {isHost && friendLobby.roundNumber === 0 ? <div className="lobby-settings-editor">
                        <fieldset className="turn-time-field"><legend>Turn time</legend><details ref={friendTurnPickerRef} className="turn-time-picker"><summary>{TURN_TIME_OPTIONS.find((option) => option.value === friendLobby.settings.turnTimeLimitMs)?.label ?? "Choose a turn time"}<span aria-hidden="true" /></summary><div className="turn-time-options" role="listbox" aria-label="Turn time">{TURN_TIME_OPTIONS.map((option) => <button key={option.label} type="button" role="option" disabled={friendBusy} aria-selected={option.value === friendLobby.settings.turnTimeLimitMs} onClick={() => { friendTurnPickerRef.current?.removeAttribute("open"); void updateFriendsRoomSettings(option.value, friendLobby.settings.scoringMode); }}><span>{option.label}</span>{option.value === friendLobby.settings.turnTimeLimitMs && <i aria-hidden="true">✓</i>}</button>)}</div></details></fieldset>
                        <fieldset className="scoring-mode-picker lobby-scoring-picker"><legend>Game mode</legend><button type="button" disabled={friendBusy} aria-pressed={friendLobby.settings.scoringMode === "ROUNDS"} onClick={() => updateFriendsRoomSettings(friendLobby.settings.turnTimeLimitMs, "ROUNDS")}><strong>Round wins</strong><span>Count hands won</span></button><button type="button" disabled={friendBusy} aria-pressed={friendLobby.settings.scoringMode === "VALUES"} onClick={() => updateFriendsRoomSettings(friendLobby.settings.turnTimeLimitMs, "VALUES")}><strong>Card values</strong><span>Lowest total leads</span></button></fieldset>
                      </div> : <><div className="lobby-rule"><span>Turn time</span><strong>{friendLobby.settings.turnTimeLimitMs === null ? "No limit" : `${friendLobby.settings.turnTimeLimitMs / 1000} seconds`}</strong></div><div className="lobby-rule"><span>Game mode</span><strong>{friendLobby.settings.scoringMode === "VALUES" ? `Card values · ${friendLobby.roundNumber} ${friendLobby.roundNumber === 1 ? "round" : "rounds"} played` : "Round wins"}</strong></div></>}
                      <div className="lobby-heading"><span>Players</span><strong>{friendLobby.seats.length} / {friendLobby.settings.maxPlayers}</strong></div>
                      <div className={`table-preview friend-table-preview lobby-size-${friendLobby.settings.maxPlayers}`} aria-label={`${friendLobby.seats.length} of ${friendLobby.settings.maxPlayers} seats filled`}>
                        <i>51</i><span className="preview-count">{friendLobby.seats.length} / {friendLobby.settings.maxPlayers} seated</span>
                        {previewSeats.map((seat, index) => <div className={`friend-preview-seat preview-position-${index} ${index === 0 ? "you" : ""} ${seat ? "filled" : "empty"}`} key={seat?.userId ?? `open-${index}`}>
                          <b>{seat ? seat.isBot ? "B" : seat.displayName.slice(0, 1).toUpperCase() : "+"}</b>
                          <span><strong>{seat?.displayName ?? "Open seat"}</strong><small>{seat ? `${seat.userId === friendLobby.hostUserId ? "Host" : seat.isBot ? "Bot" : "Ready"} · ${friendLobby.settings.scoringMode === "VALUES" ? `${seat.score} pts` : `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}`}` : "Waiting"}</small></span>
                          {isHost && seat && seat.userId !== friendLobby.hostUserId && friendLobby.roundNumber === 0 && <button type="button" className="preview-seat-remove" disabled={friendBusy} aria-label={`Remove ${seat.displayName}`} title={`Remove ${seat.displayName}`} onClick={() => removeSeatFromFriendsRoom(seat.userId)}>×</button>}
                        </div>)}
                      </div>
                      {friendError && <p className="friend-error" role="alert">{friendError}</p>}
                      {isHost ? (
                        <div className="lobby-controls">
                          <button type="button" disabled={friendBusy || friendLobby.roundNumber > 0 || friendLobby.seats.length >= friendLobby.settings.maxPlayers} onClick={addBotToFriendsRoom}>Add bot</button>
                          <button type="button" className="gold-button" disabled={friendBusy || !canStart} onClick={startFriendsRoom}>{friendBusy ? "Starting…" : friendLobby.roundNumber > 0 ? "Start next round" : "Start game"}</button>
                        </div>
                      ) : <p className="waiting-host">Waiting for the host to start the game…</p>}
                    </div>
                  );
                })()}
              </div>
            )}

            {screen === "SETTINGS" && (
              <div className="setup-card settings-setup">
                <div className="setup-icon" aria-hidden="true">⚙</div>
                <p className="eyebrow">Your game</p>
                <h1>Settings</h1>
                <p>This space is ready for the options we add next.</p>
                <div className="settings-preview">
                  <span><strong>Sound & music</strong><small>Coming later</small></span>
                  <span><strong>Animation speed</strong><small>Coming later</small></span>
                  <span><strong>Table appearance</strong><small>Coming later</small></span>
                </div>
              </div>
            )}
          </section>
        )}
        <footer className="home-footer"><span>Card51</span><span>Family rules, faithfully played.</span></footer>
      </main>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveDragId(null); setDragOverId(null); }}
    >
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">The family rummy game</p>
          <h1>Card51</h1>
        </div>
        <div className="new-game-controls">
          <span className="session-mode">You vs {numPlayers - 1} {numPlayers === 2 ? "bot" : "bots"}</span>
          <button type="button" onClick={openSettings}>Settings</button>
          <button type="button" onClick={returnHome}>Home</button>
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
      <div ref={tableShellRef} className={`table-shell ${isHumanTurn ? "your-turn" : "waiting-turn"} ${activeDragId ? "dragging-card" : ""}`}>
      <section className="opponents" aria-label="Opponents">
        {Array.from({ length: gameState.numPlayers }, (_, player) => player).filter((player) => player !== HUMAN_ID).map((player) => (
          <div
            key={player}
            ref={(node) => {
              if (node) playerSeatRefs.current.set(player, node);
              else playerSeatRefs.current.delete(player);
            }}
            className={`player-chip ${gameState.currentTurn === player ? "current" : ""} ${tableMotion?.player === player ? "motion-pulse" : ""}`}
          >
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
        <div
          key={tableMotion.key}
          className={`table-motion motion-${tableMotion.type.toLowerCase()} ${tableMotion.player === HUMAN_ID ? "motion-human" : "motion-bot"}`}
          style={{
            "--motion-from-x": `${tableMotion.from.x}px`,
            "--motion-from-y": `${tableMotion.from.y}px`,
            "--motion-to-x": `${tableMotion.to.x}px`,
            "--motion-to-y": `${tableMotion.to.y}px`,
          } as CSSProperties}
          aria-live="polite"
        >
          <CardView card={(tableMotion.player !== HUMAN_ID && tableMotion.type === "DRAW_DECK") || !tableMotion.cardId ? undefined : gameState.cardsById[tableMotion.cardId]} small />
          <span>{tableMotion.player === HUMAN_ID ? "You" : `Player ${tableMotion.player + 1}`} {tableMotion.type === "DISCARD" ? "discarded" : "drew"}</span>
        </div>
      )}

      <section className="table-area">
        <div className="piles">
          <button
            ref={drawPileRef}
            type="button"
            className={`pile-button ${tableMotion?.type === "DRAW_DECK" ? "motion-pulse" : ""}`}
            disabled={!isHumanTurn || gameState.phase !== "DRAW" || gameState.deckCount === 0 && gameState.discard.length <= 1}
            onClick={() => runAction({ type: "DRAW_DECK", player: HUMAN_ID })}
          >
            <span>Draw pile</span><CardView /><strong>{gameState.deckCount}</strong>
          </button>
          <DropZone id="discard-drop" className="discard-drop-zone" onNativeDrop={() => activeDragId && handleCardDrop(activeDragId, "discard-drop")}>
          <button
            ref={discardPileRef}
            type="button"
            className={`pile-button ${tableMotion?.type === "DRAW_DISCARD" || tableMotion?.type === "DISCARD" ? "motion-pulse" : ""}`}
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

      <section ref={handPanelRef} className={`hand-panel ${tableMotion?.player === HUMAN_ID ? "motion-pulse" : ""}`}>
        <div className="section-heading">
          <div className="you-heading"><span className="player-avatar you-avatar">YOU</span><div><p className="eyebrow">Your seat · {humanOpened ? "Opened" : "Closed"}</p><h2>Your hand · {humanHand.length}</h2></div></div>
          <div className="sort-controls">
            <button type="button" aria-pressed={sortMode === "rank"} onClick={() => setSortMode("rank")}>By rank</button>
            <button type="button" aria-pressed={sortMode === "suit"} onClick={() => setSortMode("suit")}>By suit</button>
          </div>
        </div>
        <p className="drag-hint">Drag to reorder · Select several cards, then drag them to the table · Drag one to the discard pile to end your turn</p>
        <SortableContext items={orderedHand} strategy={horizontalListSortingStrategy}>
        <div ref={handCardsRef} className={`hand-cards ${activeDragId ? "live-reordering" : ""}`}>
          {orderedHand.map((id, index) => (
            <SortableHandCard
              key={id}
              id={id}
              index={index}
              activeIndex={activeHandIndex}
              dragOverIndex={dragOverId ? orderedHand.indexOf(dragOverId) : -1}
              recentDraw={recentDrawId === id}
              card={gameState.cardsById[id]}
              selected={selectedIds.has(id)}
              disabled={stagedIds.has(id)}
              onClick={() => toggleCard(id)}
              badge={stagedIds.has(id) ? "Staged" : undefined}
              onNativeDragStart={(dragId) => { setActiveDragId(dragId); setDragOverId(dragId); }}
              onNativeDragOver={setDragOverId}
              onNativeDrop={(targetId) => activeDragId && handleCardDrop(activeDragId, targetId)}
              onNativeDragEnd={() => { setActiveDragId(null); setDragOverId(null); }}
              onNodeRef={(node) => {
                if (node) handCardRefs.current.set(id, node);
                else handCardRefs.current.delete(id);
              }}
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
