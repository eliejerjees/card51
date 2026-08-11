# Card51 — Complete Game Rules and Browser Game Specification

Build **Card51** as a browser-based multiplayer card game.

The most important priority is that the underlying game engine accurately enforces the rules below. Multiplayer, bots, animations, and UI should all interact with the same authoritative game-state/rules system rather than implementing separate versions of the rules.

---

# 1. Game Modes

Support:

* Online matchmaking with random players
* Private online lobbies
* Shareable lobby/invite links
* Games against bots
* 2–4 players per game

A game requires at least 2 players.

The current UI should limit games to 4 players, but the architecture should avoid unnecessarily assuming exactly four players so the limit could be increased later.

Each player plays individually. There are no teams.

---

# 2. Deck

Use:

* Two complete standard 52-card decks
* Two Jokers

Total:

**106 cards**

Because two decks are used, two physically identical cards can exist.

For example, there can be two separate 7♣ cards in the game.

That does NOT mean identical cards can necessarily coexist inside the same meld. Meld validation rules are described below.

---

# 3. Objective

The goal is to be the **first player to legally empty their hand**.

A player wins only by ending their turn with no cards remaining after making their required final discard.

You cannot win merely by placing every card from your hand into melds.

Every turn must still end with a discarded card.

Therefore, if a player has three cards remaining and all three form a valid set, they cannot simply place all three down and win because they would have no card left to discard.

They must find another legal sequence of moves that leaves one card available for the final discard.

The round/game ends immediately when the first player legally empties their hand.

---

# 4. Starting Hands

Each player starts with **14 cards**.

For implementation simplicity, deal everyone 14 cards and have the starting player perform a normal turn:

1. Draw a card.
2. Play any legal actions.
3. Discard a card.

This is functionally equivalent to the traditional method where the starting player receives 15 cards and immediately discards one.

Randomly choose the starting player unless another lobby setting is later added.

---

# 5. Basic Turn Structure

Every normal turn follows this structure:

1. **Draw exactly one card**
2. Perform any legal actions
3. **Discard exactly one card**
4. End turn

A player must draw before playing.

A player must discard to finish their turn.

The draw can come from either:

* The face-down draw pile
* The top card of the discard/trash pile

Which options are legal depends on whether the player has already opened.

---

# 6. The Draw Pile

The face-down pile is the standard draw source.

When drawing from it:

* Add one card to the player's hand.
* The player may then perform any legal actions.
* The drawn card does NOT have to be used during that turn.
* The player eventually discards one card to end the turn.

If the draw pile runs out:

* Take the discard pile and reshuffle it into a new draw pile.
* Preserve whatever card is currently needed as the active top discard if necessary for normal gameplay.
* Continue the game.

The implementation should avoid losing, duplicating, or accidentally creating cards during reshuffling.

---

# 7. The Trash / Discard Pile

Players normally discard one card face-up at the end of every turn.

Only the **top card** of the trash pile can be drawn.

Rules for drawing that card depend on whether the player has opened.

---

# 8. Opening

A player begins the game in a **closed** state.

To become **open**, the player must place one or more new valid sets and/or runs from their own hand whose combined point value is at least:

**51 points**

The opening requirement only needs to be satisfied once per player.

After successfully opening, that player remains open for the rest of the game.

Other players opening does not open you.

---

# 9. Opening Value

The total value of all melds placed as part of the opening action must be:

**51 or more**

Multiple melds can be combined to reach 51.

Example:

* A set worth 21
* A run worth 30

Total = 51

That is a valid opening.

A single meld worth 51 or more also works.

Only cards actually placed during that player's opening action count toward their 51-point requirement.

Cards already on the table do not count.

---

# 10. Card Values

For calculating the 51-point opening requirement:

* 2 = 2
* 3 = 3
* 4 = 4
* 5 = 5
* 6 = 6
* 7 = 7
* 8 = 8
* 9 = 9
* 10 = 10
* Jack = 10
* Queen = 10
* King = 10
* Ace = 10

Jokers take the value of the card they are representing.

Example:

7♣ + 7♦ + Joker representing 7♥

Value:

7 + 7 + 7 = 21

---

# 11. Sets

A **set** consists of at least 3 cards of the same rank.

Examples:

* 7♣, 7♦, 7♥
* K♣, K♦, K♠

A set may contain different suits, but an individual set **cannot contain duplicate suits**.

Because there are two decks, two copies of the exact same card can exist, but they cannot be used together inside the same set.

Valid:

* 8♣
* 8♦
* 8♥

Invalid:

* 8♣
* 8♣
* 8♦

Even though those two 8♣ cards may physically come from different decks, the set is invalid because Clubs appears twice.

---

# 12. Set Size

A valid set requires at least:

**3 cards**

A four-card set containing all four suits is technically valid but immediately becomes **complete** and therefore burns.

Because there are only four suits, an active set can normally contain three cards.

The fourth unique suit completes it.

For table presentation, cards in a set should alternate colors whenever possible: red-black-red or black-red-black. Suit order within those color positions is not important and does not affect legality.

---

# 13. Multiple Sets of the Same Rank

Different melds may contain the same rank.

For example, because two decks are used, this can exist:

Set A:

* 9♣
* 9♦
* 9♥

Set B:

* 9♣
* 9♦
* 9♠

This is legal as long as each individual set contains no duplicate suit.

Do not merge independent sets automatically merely because they use the same rank.

---

# 14. Runs

A **run** consists of:

* At least 3 cards
* Sequential ranks
* All cards belonging to the same suit

Example:

* 5♦
* 6♦
* 7♦

Valid.

This is invalid:

* 5♦
* 6♣
* 7♦

because the suits differ.

---

# 15. Ace Rules in Runs

Ace can be either low or high.

Valid low-Ace sequence:

* A, 2, 3

Valid high-Ace sequence:

* Q, K, A

Ace cannot wrap around.

Therefore this is invalid:

* Q, K, A, 2, 3

A sequence can progress toward Ace from either legal direction, but it cannot loop from high Ace back into 2.

Ace position is derived from the run's current cards; it is not a permanent low/high setting chosen when the run is created. A run such as 10-J-Q-K must accept an Ace after the King even if it was originally placed without an Ace. Whenever cards are added, the complete run is re-evaluated and the Ace is automatically placed at the only legal end.

If both complete orientations are theoretically possible, the distinction has no gameplay effect because the 13-card run immediately burns. Joker replacement still uses the Joker's visible represented identity; an Ace replaces a Joker when that Joker occupies the Ace position.

---

# 16. Complete Runs

There are two possible logically complete run sequences:

### Low-Ace complete run

A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K

### High-Ace complete run

2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A

Each card must still be the same suit.

When a run reaches either complete sequence, it burns.

---

# 17. Jokers

Jokers are wild cards.

A Joker may represent any missing card necessary to create or extend a valid set or run.

Once placed into a meld, the Joker should have an explicit represented identity.

For example:

J♦, Q♦, Joker, A♦

The Joker represents:

**K♦**

For all game logic while it remains there, treat that Joker as K♦.

---

# 18. Joker Value

For opening calculations, a Joker is worth the point value of the card it represents.

Example:

7♣, 7♦, Joker representing 7♥

The Joker is worth 7.

Example:

Q♦, Joker representing K♦, A♦

Values:

10 + 10 + 10 = 30

---

# 19. Joker Validation

The Joker must represent a card that actually makes the meld legal.

It cannot be assigned an arbitrary identity merely to manipulate scoring.

Its represented rank/suit should be determined and stored as part of the meld state.

The UI should make the Joker's current representation understandable to players.

---

# 20. Opening After Drawing From the Normal Pile

A closed player who draws from the normal face-down pile may:

* Open that turn
* Or remain closed and simply discard

If they choose to open, the card they just drew does **not** have to be part of their opening melds.

They simply need to place valid melds totaling at least 51.

---

# 21. Closed Player Taking the Top Trash Card

A closed player may draw the top card of the trash pile, but doing so creates an immediate obligation.

They must:

1. Take the top discard.
2. Open during that same turn.
3. Use that exact discarded card in one of the melds used for their opening.
4. Their entire opening must still total at least 51.
5. Finish the turn by discarding one card.

If they cannot legally open while using that exact discard, they cannot take it.

The UI should ideally prevent the player from taking the discard unless a legal opening may be possible, but the server/rules engine must validate the final move regardless.

---

# 22. Already-Open Player Taking the Trash Card

Once a player has opened, they may freely draw the top card of the trash pile on their turn.

They do NOT have to:

* Use it immediately
* Add it to a meld
* Create a new meld with it

They may simply keep it in their hand.

It becomes a normal hand card.

---

# 23. No Immediate Re-Discard of a Taken Trash Card

If a player draws the top card from the trash pile, they cannot immediately discard that exact same card at the end of the same turn.

This prevents effectively passing the discard to the next player for free while taking no meaningful action.

The card may be discarded on a later turn.

Implementation-wise, track which physical card instance was drawn from the trash that turn and prohibit that exact card instance from being selected as the player's end-of-turn discard.

This restriction applies even when duplicate copies of the same rank/suit exist.

The other identical physical copy would still be a different card instance.

---

# 24. Playing Melds After Opening

After a player has opened, they may create additional valid sets and runs without needing to reach 51 again.

For example, an opened player may later place:

* 3♣, 4♣, 5♣

even though that meld is worth only 12 points.

The 51 requirement applies only to the initial opening.

---

# 25. Adding Cards to Existing Melds

Once a player is open, they may add legal cards to **any active meld on the table**, regardless of which player originally created it.

Examples:

Existing run:

6♥, 7♥, 8♥

An opened player may add:

5♥

or:

9♥

Existing set:

Q♣, Q♦, Q♥

An opened player may add:

Q♠

Adding cards must preserve all meld validity rules.

---

# 26. Replacing a Joker

If a meld contains a Joker and a player has the exact card the Joker represents, an opened player may replace the Joker.

Example:

Table:

J♦, Q♦, Joker representing K♦, A♦

Player has:

K♦

The player may:

1. Place K♦ into the Joker's position.
2. Remove the Joker from the meld.
3. Take control of the freed Joker.
4. Immediately use that Joker elsewhere or keep using it during their turn.

The freed Joker becomes wild again.

---

# 27. Using a Freed Joker

After replacing a Joker, the player may use the freed Joker to:

* Create another new valid set
* Create another new valid run
* Extend another existing meld
* Replace another necessary card in a valid meld
* Keep manipulating legally during that same turn
* Discard the Joker as their normal end-of-turn discard if they want

Once removed from its old meld, it no longer retains its previous identity.

---

# 28. Burning

A meld is **burnt** when it becomes completely filled.

Burning removes that meld from active play.

Burnt cards are moved into the trash/discard pile.

A burnt meld should briefly remain visible or animate so players understand what became complete before the cards disappear into the trash.

---

# 29. Burning Sets

A set burns when all four suits of that rank are represented.

Example:

7♣
7♦
7♥
7♠

The moment the fourth unique suit is added, the set is complete.

All four cards burn.

This applies whether:

* A player initially places all four cards at once, or
* A three-card set already exists and someone later adds the fourth card

Example:

Existing:

8♣, 8♦, 8♥

Player adds:

8♠

Result:

The four-card set is briefly shown and then all four cards are moved into the trash pile.

---

# 30. Burning Runs

A run burns when it reaches either full legal sequence for its suit.

Either:

A through K

or:

2 through A

with every sequential rank represented exactly as required.

This will be uncommon, but the engine must support it.

The entire completed run is then moved into the trash pile.

---

# 31. Jokers in Burnt Melds

If a completed meld contains one or more Jokers, those Jokers burn with the meld.

They do NOT automatically become free again.

Example:

5♣
5♦
Joker representing 5♥

A player adds:

5♠

The logical set now contains all four suits:

* Clubs
* Diamonds
* Hearts represented by Joker
* Spades

The set is complete.

All four physical cards burn, including the Joker.

The only way to recover that Joker beforehand would have been for someone to replace it with the actual 5♥ before completion.

---

# 32. Burnt Cards and the Trash Pile

When a meld burns:

* Move all of its physical cards into the trash pile together.
* Their internal order does not materially matter.

This does NOT satisfy the active player's mandatory discard.

The player whose action caused the burn must still eventually discard one card normally to finish their turn.

That player's final normal discard becomes the relevant top card of the trash pile for the next player.

---

# 33. Multiple Actions Per Turn

After drawing and before discarding, an eligible player may perform multiple legal actions during the same turn.

For example, an opened player could:

1. Draw.
2. Create a new run.
3. Add a card to another player's set.
4. Replace a Joker.
5. Use that Joker in another run.
6. Cause a meld to burn.
7. Discard.
8. End turn.

Do not artificially restrict players to one meld action per turn.

---

# 34. Turn Completion

A turn is not complete until the player makes their normal discard.

Burning cards does not count as the discard.

Creating melds does not count as the discard.

Replacing a Joker does not count as the discard.

The player must always place one card from their hand onto the trash pile to end their turn.

---

# 35. Winning

A player wins when:

1. They began their turn normally.
2. They drew one card.
3. They made any desired legal actions.
4. They made their required final discard.
5. Their hand now contains zero cards.

The game immediately ends.

Example:

Player begins with 4 cards.

They draw, giving them 5.

They legally place 4 cards into melds.

They discard their remaining card.

Their hand is now empty.

They win.

Invalid example:

Player has 3 cards.

All three form a valid meld.

They place all three cards.

Their hand is empty, but they have no card available for their required discard.

That is NOT a legal winning move.

The game should prevent the player from committing a sequence that leaves them unable to complete the mandatory discard unless another legal action restores a card to their hand.

---

# 36. Turn Timer

Online games should have a turn timer because this is a browser multiplayer game.

The exact duration should be configurable rather than deeply hard-coded into the rules engine.

Bot-only games should have **unlimited player thinking time**.

Bots themselves should act quickly rather than intentionally waiting through a fake timer.

---

# 37. Bots

Bots must follow exactly the same rules as human players.

Do not give bots privileged access to hidden information.

A bot should only know:

* Its own hand
* Public table melds
* Public trash/discard information
* Public game state
* Information legitimately inferable from previous actions

Bot difficulty can later influence strategy, but not rule access.

Bots must understand at minimum:

* Opening at 51+
* Whether taking the trash card enables a legal opening
* Creating sets
* Creating runs
* Extending table melds
* Joker usage
* Joker replacement
* Burning
* Avoiding illegal final-hand states
* Winning when possible

---

# 38. Multiplayer Authority

For online games, the client should NOT be trusted to determine whether moves are legal.

Use an authoritative server/game-state layer.

The server should validate:

* Whose turn it is
* Which card was drawn
* Where it was drawn from
* Whether the player has opened
* Whether an opening reaches 51
* Whether a trash card was required in the opening
* Set validity
* Run validity
* Joker identities
* Joker replacements
* Additions to existing melds
* Burning
* Discards
* The no-immediate-re-discard rule
* Winning conditions

Clients should request actions and render the authoritative resulting state.

This prevents cheating and desynchronization.

---

# 39. Physical Card Identity

Every physical card in the deck should have a unique internal ID.

This is important because two decks create duplicates.

For example:

* deck1-7-clubs
* deck2-7-clubs

They are visually identical but remain separate physical cards.

Jokers should also have separate IDs.

Do not determine card identity solely from rank and suit.

This matters for:

* Hands
* Trash pile
* Draw tracking
* The no-immediate-re-discard rule
* Multiplayer synchronization
* Joker manipulation
* Burning
* Reconstructing game history

---

# 40. Meld Representation

Each active meld should be represented explicitly in game state.

Suggested conceptual structure:

* Unique meld ID
* Meld type: `set` or `run`
* Physical cards belonging to it
* Current logical ordering
* Joker represented identities
* Whether it is active or burnt
* Original creator if useful for UI/history

The rules engine should derive validity from the meld contents instead of trusting the client.

---

# 41. Transactional Turn Actions

The implementation should support players experimenting with arrangements before committing them.

For example, a player may drag several cards onto the table, reconsider them, retrieve a Joker, rearrange cards, etc.

Do not permanently commit every drag operation immediately.

A useful model is:

* Authoritative starting state for turn
* Temporary proposed turn state
* Validate actions continuously
* Player presses/initiates final discard
* Server validates the complete turn
* Commit valid state atomically

If the resulting turn is illegal, reject it and allow correction.

This is especially important for opening, Joker manipulation, and ensuring the player retains a final discard.

---

# 42. Information Visibility

Each player may see:

* Their own cards
* Number of cards held by each opponent
* Active melds
* The top discard
* Publicly discarded cards as appropriate
* Whose turn it is
* Which players have opened
* Turn timer
* Game events such as Joker replacement and burning

Players must NOT see opponents' hidden cards.

Bots must obey the same hidden-information boundaries.

---

# 43. UI Expectations

The game should visually distinguish:

* Player hand
* Draw pile
* Trash/discard pile
* Active sets
* Active runs
* Jokers and what they currently represent
* Players who have opened
* Current player
* Turn timer
* Number of cards remaining for each player

Interactions should preferably support intuitive drag-and-drop while also being usable through click/tap controls.

The UI should make invalid actions understandable instead of silently failing.

Examples:

* "Opening must total at least 51."
* "You must use the discard you picked up in your opening."
* "A set cannot contain duplicate suits."
* "Runs must use one suit."
* "You still need a card to discard."
* "You cannot immediately discard the card you just took from the trash."

---

# 44. Burn Animation / Visibility

When a meld burns:

1. Show its completed form.
2. Clearly indicate that it is complete/burnt.
3. Animate or otherwise visibly move/remove the cards.
4. Add the cards to the trash.
5. Leave the active player in their turn.
6. Require their normal final discard.

Do not make the completed meld disappear so quickly that players cannot understand what happened.

---

# 45. Game History / Event Log

Maintain enough game history to display useful public actions such as:

* Player drew from trash
* Player opened
* Player created a meld
* Player extended a meld
* Player replaced a Joker
* Meld burnt
* Player discarded
* Player won

Do NOT reveal hidden draws from the face-down pile.

The underlying history should also be useful for debugging multiplayer synchronization problems.

---

# 46. Rule Engine Design

Keep rules separate from rendering.

Prefer pure or mostly pure functions for logic such as:

* `isValidSet`
* `isValidRun`
* `calculateMeldValue`
* `calculateOpeningValue`
* `canOpen`
* `canTakeDiscard`
* `canAddCardToMeld`
* `canReplaceJoker`
* `resolveJokerIdentity`
* `isCompleteSet`
* `isCompleteRun`
* `burnCompletedMelds`
* `canDiscard`
* `canEndTurn`
* `isWinningState`

Names do not need to match these exactly.

The important requirement is centralized, testable rules rather than distributing game logic across UI components.

---

# 47. Important Rule Invariants

These should always remain true:

1. Every physical card exists in exactly one valid location.
2. A player draws exactly once per normal turn.
3. A player discards exactly once per normal turn.
4. A player cannot act when it is not their turn.
5. Closed players cannot manipulate table melds before opening.
6. Opening requires at least 51 points.
7. A closed player taking trash must use that card in the opening that turn.
8. An opened player may keep a card drawn from trash.
9. A card drawn from trash cannot be immediately re-discarded by that same player on that turn.
10. Sets require at least 3 cards.
11. Runs require at least 3 cards.
12. Sets cannot contain duplicate suits.
13. Runs must remain sequential and same-suit.
14. Ace may be low or high but cannot wrap.
15. Jokers must have a valid represented identity while in a meld.
16. A Joker can be recovered by replacing it with the exact represented card.
17. Complete melds burn.
18. Jokers inside burnt melds burn with them.
19. Burning does not replace the required final discard.
20. A player only wins after legally discarding their final card.

---

# 48. Tests That Must Exist

Before considering the rules implementation complete, add automated tests for at least the following:

### Sets

* Valid 3-card set
* Valid 4-card set triggers burn
* Duplicate suit rejected
* Same-rank cards from different decks handled correctly
* Two separate sets of the same rank allowed

### Runs

* Basic 3-card run
* Longer run
* Mixed suit rejected
* Gap rejected
* A-2-3 accepted
* Q-K-A accepted
* Q-K-A-2 rejected
* Existing 10-J-Q-K run accepts Ace without a preselected Ace mode
* Complete A-through-K run burns
* Complete 2-through-A run burns
* Existing 2-through-K run burns when Ace is added

### Opening

* Exactly 51 accepted
* More than 51 accepted
* 50 rejected
* Multiple meld totals accepted
* Joker values calculated from represented cards

### Trash Draw

* Closed player draws trash and successfully opens using card
* Closed player attempts opening without using drawn trash card and is rejected
* Closed player cannot simply keep trash card
* Open player may take trash and keep it
* Player cannot immediately throw same physical trash card back
* Duplicate copy of same rank/suit is correctly treated as a separate physical card

### Jokers

* Joker completes valid set
* Joker fills valid run gap
* Joker receives correct point value
* Actual represented card replaces Joker
* Freed Joker can be reused
* Joker burns when containing meld burns

### Burning

* Three-card set remains active
* Adding fourth suit burns set
* Initially playing all four suits burns set
* Burnt cards enter trash
* Burning does not end turn
* Player must still discard afterward

### Winning

* Player empties hand after discard and wins
* Player attempts to empty hand entirely through melds and is rejected
* Player performs multiple actions then legally discards final card and wins

### Draw Pile

* Empty draw pile properly recycles trash
* No cards duplicated
* No cards disappear

---

# 49. Priority Order

When implementing this project, prioritize:

1. Correct game-state model
2. Correct rules engine
3. Automated rule tests
4. Functional local multiplayer/game simulation
5. Bots
6. Online multiplayer synchronization
7. Private lobbies and invite links
8. Random matchmaking
9. Polished UI/animations

Do not sacrifice rule correctness to rush multiplayer or visual polish.

The end result should feel like an actual online implementation of Card51 rather than a generic rummy game with approximately similar rules.
