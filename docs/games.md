---
order: 3
---

# The games

55 games are on the kit, all as `TableGame`s. This list is written from the built package, so it is exactly what `KIT_GAMES` holds: cards (44), boards (9) and table sports (2). Look one up with `kitGame(id)`.

Seats are `min` to `max`, with the usual number in brackets. **Teams** means partners across the table. **Presets** is how many named rule sets it ships with; every one can be changed field by field.

## Card games

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Hearts | `hearts` | 3 to 5 (4) |  | 3 | Dodge the hearts and the queen |
| Oh Hell | `ohhell` | 3 to 7 (4) |  | 3 | Bid exactly what you'll take |
| Euchre | `euchre` | 4 | yes | 3 | Partners, bowers and calling trump |
| Crazy Eights | `crazy8` | 2 to 6 (4) |  | 3 | Match the card; eights are wild |
| Gin Rummy | `gin` | 2 |  | 3 | Two players, melds and knocking |
| Pinochle | `pinochle` | 4 | yes | 4 | Partners, bidding, meld and tricks |
| Canasta | `canasta` | 4 | yes | 3 | Partners, melds and canastas |
| Go Fish | `gofish` | 2 to 6 (4) |  | 2 | Ask for cards, make books |
| Old Maid | `oldmaid` | 2 to 6 (4) |  | 2 | Pairs, and don't get stuck with her |
| War | `war` | 2 to 4 (2) |  | 3 | Flip, and the highest card takes all |
| Whist | `whist` | 4 | yes | 3 | Spades' grandparent: partners and tricks |
| Golf | `golf` | 2 to 6 (4) |  | 3 | Swap your way to the lowest score |
| Rummy 500 | `rummy500` | 2 to 6 (3) |  | 3 | Melds, lay-offs and a pile to dig into |
| President | `president` | 3 to 7 (5) |  | 4 | Climb from Scum to President |
| Klondike Solitaire | `klondike` | 1 |  | 2 | The classic solitaire, just for you |
| FreeCell | `freecell` | 1 |  | 1 | Solitaire where every card is face up |
| Hand and Foot | `handfoot` | 4 | yes | 3 | Partners, books of seven, and a foot |
| Cribbage | `cribbage` | 2 |  | 2 | Fifteen two, fifteen four, and a pair is six |
| Five Card Draw | `fivedraw` | 2 to 6 (4) |  | 3 | Poker for chips: bet, swap, bet, show |
| Texas Hold'em | `holdem` | 2 to 6 (4) |  | 3 | Two cards, five on the board, chips only |
| Bluff | `bluff` | 2 to 6 (4) |  | 3 | Say what you're putting down, true or not |
| Liar's Poker | `liarspoker` | 2 to 6 (4) |  | 4 | Bid poker hands hiding in everyone's cards |
| Switch | `switch` | 2 to 6 (4) |  | 3 | Uno's ancestor, with an ordinary deck |
| Thirty-One | `thirtyone` | 2 to 8 (4) |  | 5 | Three cards, one suit, as close to 31 as you dare |
| Kings in the Corner | `kingscorner` | 2 to 4 (4) |  | 2 | Solitaire for the whole table |
| Blackjack | `blackjack` | 1 to 5 (3) |  | 3 | Get closer to 21 than the dealer (chips only) |
| Spite and Malice | `spite` | 2 to 4 (2) |  | 3 | Race to play off your pile; kings are wild |
| Pitch | `pitch` | 2 to 6 (4) |  | 3 | Bid for High, Low, Jack and Game |
| Five Hundred | `fivehundred` | 4 | yes | 2 | Partners bid tricks; the joker is boss |
| Durak | `durak` | 2 to 6 (3) |  | 3 | Attack, defend, and don't be the fool |
| Bridge | `bridge` | 4 | yes | 2 | Contract bridge, Chicago scoring |
| Fruit Salad | `fruitsalad` | 2 to 8 (4) |  | 3 | Our own colour-card game: match the fruit |
| Slapjack | `slapjack` | 2 to 6 (3) |  | 4 | Flip, and slap the jacks first |
| Speed | `speed` | 2 |  | 3 | No turns: play faster than the other player |
| Memory | `memory` | 1 to 6 (2) |  | 3 | Find the pairs (great for grandkids) |
| Sevens | `sevens` | 3 to 7 (4) |  | 3 | Build out from the 7s |
| Cuckoo | `cuckoo` | 3 to 10 (5) |  | 3 | One card each; don't get stuck with the lowest |
| Contract Rummy | `contractrummy` | 3 to 8 (4) |  | 2 | Seven rounds, seven contracts to lay down |
| Spider | `spider` | 1 |  | 3 | Two-deck solitaire: build runs from king to ace |
| Pyramid | `pyramid` | 1 |  | 2 | Solitaire: clear pairs that make 13 |
| Ride the Bus | `ridethebus` | 2 to 8 (4) |  | 2 | Drinking game: guess, match, and don't ride the bus |
| Kings Cup | `kingscup` | 2 to 10 (5) |  | 2 | Drinking game: every card has a rule |
| Horse Race | `horserace` | 2 to 10 (5) |  | 2 | Drinking game: bet sips on an ace and watch them run |
| Drinking Pyramid | `drinkingpyramid` | 2 to 8 (4) |  | 2 | Drinking game: remember your cards, match the pyramid, bluff |

## Board games

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Tic-Tac-Toe | `tictactoe` | 2 |  | 4 | Three in a row, or nine boards at once |
| Drop Four | `dropfour` | 2 |  | 5 | Drop your discs, four in a row wins |
| Combat | `combat` | 2 |  | 4 | Hide your fleet, hunt theirs |
| Reversi | `reversi` | 2 |  | 3 | Trap their discs and flip them to yours |
| Checkers | `checkers` | 2 |  | 4 | Jump their pieces and crown your kings |
| Go | `go` | 2 |  | 4 | Surround more of the board than they do (Weiqi, Baduk) |
| Chess | `chess` | 2 |  | 8 | Checkmate the king, against the clock if you like |
| Yacht | `yacht` | 1 to 6 (2) |  | 4 | Five dice, three rolls, one scorecard |
| Backgammon | `backgammon` | 2 |  | 6 | Race your checkers home, and hit theirs on the way |

## Table sports

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Mini Golf | `minigolf` | 1 to 6 (2) |  | 4 | Nine holes round the garden, in turn or all at once |
| Bowling | `bowling` | 1 to 6 (2) |  | 4 | Ten pins, ten frames: strikes, spares and a score sheet |

## Not on the kit

Spades and Palace predate the kit and have their own packages with their own functions: [`@journey-to-code/rules`](packages.md#rules-spades) and [`@journey-to-code/palace`](packages.md#palace). The drinking games on this list (Ride the Bus, Kings Cup, Horse Race and Drinking Pyramid) are for adults.
