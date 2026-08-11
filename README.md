# Card51

Card51 is a browser implementation of a family rummy game for 2-4 individual players. The current playable mode is one local human against bots.

## Authoritative rules

[`RULES.md`](./RULES.md) is the sole source of truth for game behavior. Do not infer or change rules based on historical implementations in Git. Engine, UI, bots, and future multiplayer code must all conform to that specification.

## Development

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run lint
npm run build
```

## Architecture

- `src/engine/` contains authoritative, UI-independent game rules and state transitions.
- `src/engine/card51.test.ts` covers the rule examples and invariants required by the specification.
- `src/App.tsx` renders state and requests engine actions; it does not decide whether moves are legal.
- Every physical card has a unique ID even when two cards share the same rank and suit.

## Implementation status

Implemented:

- Local games against bots with 2–4 players
- Sets, runs, low/high Ace handling, and explicit Joker identities
- Dynamically derived Ace placement when runs are extended
- Multi-meld 51-point openings
- Closed/open trash-draw restrictions and physical-card re-discard protection
- Multiple actions per turn
- Shared meld extension and Joker replacement
- Complete-meld burning, trash recycling, public history, and final-discard wins
- Rollbackable turn actions that commit with the final discard
- Mouse/touch card reordering and multi-card drag-and-drop play
- Animated, readable bot draws and discards
- Meld snap feedback, larger table cards, and win/loss celebrations
- Redacted per-player game views and authenticated action ownership
- Transport-independent private-lobby, invite, matchmaking, and bot-seat services
- Automated engine tests

Not yet implemented:

- A deployed HTTP/WebSocket transport, authentication, and persistence
- Online lobby screens wired to the transport-independent lobby service
- Turn-timer enforcement (the configured duration is already represented in state)

The detailed implementation audit and remaining production work are tracked in [`docs/IMPLEMENTATION_STATUS.md`](./docs/IMPLEMENTATION_STATUS.md).
