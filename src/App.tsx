import { useMemo, useState } from "react";
import "./app.css";
import { WebGame } from "./engine/webGame";
import type { CandidateGroup } from "./engine/webGame";
import { Card } from "./engine/card";

function cardKey(c: Card): string {
  // Works because each Card is a unique object in your deck.
  return `${c.rank}_${c.suit}_${(c as any).__id ?? ""}`; // fallback
}

function cardLabel(c: Card): string {
  return c.isJoker() ? "JOKER" : `${c.rank} ${c.suit}`;
}

export default function App() {
  const [game, setGame] = useState(() => new WebGame(2));
  const [selected, setSelected] = useState<Card[]>([]);
  const [msg, setMsg] = useState<string>("");

  const p = game.currentPlayer();
  const hand = p.getHand();

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleCard(c: Card) {
    setSelected((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function resetSelection() {
    setSelected([]);
  }

  const openCandidates = useMemo(() => game.getOpenCandidates(), [game, hand.length, game.lastDrawn]);
  const postOpenCandidates = useMemo(() => game.getPostOpenCandidates(), [game, hand.length, game.lastDrawn]);

  function pickExactCandidate(groups: CandidateGroup[]): CandidateGroup | null {
    // match selection by reference equality
    for (const g of groups) {
      if (g.cards.length !== selected.length) continue;
      const all = g.cards.every((c) => selectedSet.has(c));
      if (all) return g;
    }
    return null;
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="title">Card 51 (Web)</div>
        <div className="status">
          <div><b>Player:</b> {game.turn + 1}</div>
          <div><b>Phase:</b> {game.phase}</div>
          <div><b>Opened:</b> {p.hasOpened() ? "Yes" : "No"}</div>
          <div><b>Discard top:</b> {game.discardTop() ? cardLabel(game.discardTop()!) : "empty"}</div>
          <div><b>Last drawn:</b> {game.lastDrawn ? cardLabel(game.lastDrawn) : "-"}</div>
        </div>

        <div className="actions">
          <button
            onClick={() => {
              setGame(new WebGame(2));
              resetSelection();
              setMsg("");
            }}
          >
            New Game
          </button>

          <button
            disabled={game.phase !== "DRAW"}
            onClick={() => {
              const r = game.draw("DECK");
              setMsg(r.message ?? "");
              setGame(Object.assign(Object.create(Object.getPrototypeOf(game)), game));
              resetSelection();
            }}
          >
            Draw Deck
          </button>

          <button
            disabled={game.phase !== "DRAW"}
            onClick={() => {
              const r = game.draw("DISCARD");
              setMsg(r.message ?? "");
              setGame(Object.assign(Object.create(Object.getPrototypeOf(game)), game));
              resetSelection();
            }}
          >
            Draw Discard
          </button>

          <button
            disabled={!(game.phase === "OPEN_OR_MELD" || game.phase === "POST_OPEN_MELD")}
            onClick={() => {
              game.skipMeld();
              setMsg("");
              setGame(Object.assign(Object.create(Object.getPrototypeOf(game)), game));
              resetSelection();
            }}
          >
            Skip Meld
          </button>

          <button
            disabled={game.phase !== "OPEN_OR_MELD" || selected.length < 3}
            onClick={() => {
              const cand = pickExactCandidate(openCandidates);
              if (!cand) {
                setMsg("Selection is not an openable group (must include drawn card and be 51+).");
                return;
              }
              const r = game.openWith(cand.cards);
              setMsg(r.message ?? "");
              setGame(Object.assign(Object.create(Object.getPrototypeOf(game)), game));
              resetSelection();
            }}
          >
            Open (select exact openable group)
          </button>

          <button
            disabled={game.phase !== "POST_OPEN_MELD" || selected.length < 3}
            onClick={() => {
              // allow laying any valid meld; we still check validity inside engine
              const r = game.layMeld([...selected]);
              setMsg(r.message ?? "");
              setGame(Object.assign(Object.create(Object.getPrototypeOf(game)), game));
              resetSelection();
            }}
          >
            Lay Meld (select cards)
          </button>

          <button
            disabled={game.phase !== "DISCARD" || selected.length !== 1}
            onClick={() => {
              const r = game.discard(selected[0]);
              setMsg(r.message ?? "");
              setGame(Object.assign(Object.create(Object.getPrototypeOf(game)), game));
              resetSelection();
            }}
          >
            Discard (select 1)
          </button>
        </div>

        {msg && <div className="msg">{msg}</div>}

        {game.winner !== null && (
          <div className="winner">
            Winner: <b>Player {game.winner + 1}</b>
          </div>
        )}
      </header>

      <main className="grid">
        <section className="panel">
          <h2>Your Hand (click to select)</h2>
          <div className="hand">
            {hand.map((c, idx) => {
              const sel = selectedSet.has(c);
              return (
                <button
                  key={idx}
                  className={`card ${sel ? "sel" : ""} ${c.isJoker() ? "joker" : ""}`}
                  onClick={() => toggleCard(c)}
                >
                  {cardLabel(c)}
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Groups on Table</h2>
          <div className="groups">
            {p.getGroups().length === 0 ? (
              <div className="muted">No groups laid yet.</div>
            ) : (
              p.getGroups().map((g, i) => (
                <div key={i} className="group">
                  <div className="groupHead">
                    <span className="muted">points:</span> {g.reduce((s, c) => s + c.getValue(), 0)}
                  </div>
                  <div className="groupRow">
                    {g.map((c, j) => (
                      <span key={j} className={`chip ${c.isJoker() ? "joker" : ""}`}>
                        {cardLabel(c)}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Hints</h2>

          {game.phase === "OPEN_OR_MELD" && !p.hasOpened() && (
            <>
              <div className="muted">Openable groups (must include drawn card, 51+ points):</div>
              <div className="cand">
                {openCandidates.length === 0 ? (
                  <div className="muted">None.</div>
                ) : (
                  openCandidates.slice(0, 12).map((g, i) => (
                    <div key={i} className="candItem">
                      <b>{g.points}</b> ({g.kind}{g.mode ? ` ${g.mode}` : ""}):{" "}
                      {g.cards.map(cardLabel).join(", ")}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {game.phase === "POST_OPEN_MELD" && p.hasOpened() && (
            <>
              <div className="muted">Possible melds (showing up to 12):</div>
              <div className="cand">
                {postOpenCandidates.length === 0 ? (
                  <div className="muted">None.</div>
                ) : (
                  postOpenCandidates.slice(0, 12).map((g, i) => (
                    <div key={i} className="candItem">
                      <b>{g.points}</b> ({g.kind}{g.mode ? ` ${g.mode}` : ""}):{" "}
                      {g.cards.map(cardLabel).join(", ")}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          <div className="muted" style={{ marginTop: 10 }}>
            Rule enforced: you can draw from discard only after opening.
          </div>
        </section>
      </main>
    </div>
  );
}
