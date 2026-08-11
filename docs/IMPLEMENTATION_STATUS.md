# Card51 implementation status

This document maps the authoritative [`RULES.md`](../RULES.md) specification to the current code. `RULES.md` wins if this status file ever becomes stale.

## Rules engine

Implemented and tested:

- 106 uniquely identified physical cards: two standard decks plus two Jokers
- Two, three, and four player dealing with a randomized starter
- Draw, optional repeated actions, mandatory discard, and final-discard-only wins
- Closed and opened trash-draw rules, including exact physical-card tracking
- One- or multi-meld openings totaling at least 51 points
- Same-rank sets with unique suits and independent duplicate-rank sets
- Same-suit runs, dynamically derived low/high Ace placement, and no Ace wrapping
- Explicit Joker identities, represented-card scoring, exact replacement, and reuse
- Extension of any active table meld after opening
- Four-suit set burns and both complete 13-card run burns
- Burned cards entering trash without replacing the normal discard
- Draw-pile recycling that preserves the top trash card
- Atomic action validation and whole-state card-location invariants

The required examples in Rules section 48 are covered in `src/engine/card51.test.ts`. The suite also runs deterministic 300-action simulations for two, three, and four players and checks invariants after every bot action.

## Playable browser UI

Implemented:

- Responsive click/tap interface for one human against one to three bots
- Rank/suit hand sorting and accessible card button labels
- Opening staging with running point totals
- Explicit choice when a Joker or Ace arrangement has multiple legal meanings
- Table meld creation, extension, and Joker replacement
- Rollback to the post-draw state before committing a turn with the discard
- Mouse and touch hand reordering, multi-card table drops, meld drops, and drag-to-discard
- One continuous visible turn flow with the engine phases handled behind the interface
- Paced bot turns with animated draws and discards
- Alternating-color set presentation, larger melds, snap feedback, and win/loss overlays
- Collapsible history and rules panels that stay outside the play surface
- Burn notification/animation, public event history, player counts, and open/closed status
- Plain-language invalid-action messages and a rules quick reference
- Private-room create/join UI, invite links, live lobby seats, and a synchronized friend-game table

## Multiplayer foundation

Implemented with a local development HTTP adapter, but not yet connected to a deployed production transport:

- Per-player projections that exclude the draw pile and opponents' hands
- An authoritative boundary that derives player identity from the authenticated caller
- Private lobbies, invite codes/paths, matchmaking queues, host-only starts, and bot seats
- Automatic bot advancement in mixed human/bot lobbies
- Transactional action drafts that remain private until final discard
- A typed client/server message contract for an HTTP or WebSocket adapter
- Configurable turn duration represented in lobby and game state
- Cross-tab private-room polling and authoritative friend-game actions
- Per-tab room identity restoration across refreshes without changing shared invite URLs

## Remaining production work

These are product/infrastructure tasks, not missing game-rule logic:

1. Select a hosting and identity strategy, then add the HTTP/WebSocket adapter around `LobbyService`.
2. Add online matchmaking and production-grade reconnect handling.
3. Enforce turn deadlines server-side and define the timeout action policy.
4. Add persistence/observability if games must survive a server restart.
5. Add end-to-end tests against the selected network transport.

## Product decisions still needed

The rules intentionally make turn timers configurable but do not say what happens when time expires. Before timer enforcement is implemented, decide whether expiry should auto-draw/pass/discard, forfeit the game, or use another family rule. Hosting, account requirements, and whether unfinished matches must survive restarts also require deployment choices.
