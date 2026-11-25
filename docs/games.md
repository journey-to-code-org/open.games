---
order: 3
---

# The games

80 games are on the kit, all as `TableGame`s. This list is written from the built package, so it is exactly what `KIT_GAMES` holds: cards (46), boards (19), words (7), table sports (7) and field games (1). Look one up with `kitGame(id)`.

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
| Mahjong Shanghai | `mahjongshanghai` | 1 to 4 (1) |  | 4 | Match the free tiles and clear the stack |
| Mahjong Riichi | `mahjongriichi` | 4 (4) |  | 3 | Japanese mahjong: riichi, dora and calls for four |

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
| Pig | `pig` | 2 to 6 (2) |  | 4 | Roll again, or keep what you have? |
| Ten Thousand | `tenthousand` | 2 to 6 (2) |  | 4 | Six dice: bank the points, or push your luck |
| Ship, Captain, Crew | `shipcaptaincrew` | 2 to 6 (2) |  | 4 | Find a 6, a 5 and a 4, then sail with the biggest cargo |
| Shut the Box | `shutthebox` | 1 to 6 (2) |  | 4 | Roll, and shut the tiles that add up to it |
| Liar's Dice | `liarsdice` | 2 to 6 (3) |  | 4 | Bid on dice you can't see, or call the bluff |
| Mancala | `mancala` | 2 |  | 4 | Sow your seeds round the board and fill your store |
| Dominoes | `dominoes` | 2 to 4 (2) |  | 4 | Match the ends of the line and play out your tiles |
| Ludo | `ludo` | 2 to 4 (4) |  | 4 | Race your tokens round the board and home |
| Chinese Checkers | `chinesecheckers` | 2 to 6 (2) |  | 3 | Hop your pegs across the star before anyone else |
| Snakes & Ladders | `snakes` | 2 to 4 (2) |  | 6 | Race to square 100, up ladders and down snakes |

## Word games

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Secret Word | `secretword` | 1 to 6 (1) |  | 3 | Guess the hidden word in six tries |
| Anagrams | `anagrams` | 1 to 6 (2) |  | 3 | The longest word from one rack of letters |
| Hangman | `hangman` | 1 to 6 (2) |  | 3 | Name letters and uncover the word before the misses run out |
| Word Hunt | `wordhunt` | 1 to 6 (2) |  | 3 | Trace words in a square of letters before time runs out |
| Criss-Crosswords | `crisscross` | 2 to 4 (2) |  | 1 | Build crossing words from your tiles on one board |
| Draw & Guess | `drawguess` | 2 to 8 (4) |  | 3 | One draws, everyone else guesses (needs people: `practice` is false) |
| Read the Room | `readtheroom` | 3 to 8 (4) |  | 3 | Everyone answers at once with a slider, a vote, either-ors, three answers or a caption, and scores for guessing the room |

These are the games on the word kit. Draw & Guess and Read the Room sit on the "Party games" shelf of a picker (`category: "party"`); the rest on "Word games".

## Table sports

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Mini Golf | `minigolf` | 1 to 6 (2) |  | 4 | Nine holes round the garden, in turn or all at once |
| Bowling | `bowling` | 1 to 6 (2) |  | 4 | Ten pins, ten frames: strikes, spares and a score sheet |
| Billiards | `billiards` | 2 to 4 (2) |  | 3 | Eight-ball and nine-ball, for two or as partners |
| Carrom | `carrom` | 2 to 4 (2) |  | 2 | The flick board: nine pieces a side, and the queen |
| Shuffleboard | `shuffleboard` | 2 to 4 (2) |  | 3 | Slide your pucks down the long board, and knock theirs off |
| Crokinole | `crokinole` | 2 to 4 (2) |  | 3 | Flick discs at the hole in the middle, and theirs into the ditch |
| Flick Football | `flickfootball` | 2 |  | 3 | Paper football: flick it so it stops hanging over their edge |

## Field games

Played side on, over land, a shot at a time: see [adding a game](adding-a-game.md#a-field-game).

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Over the Hill | `overthehill` | 2 to 4 (2) |  | 7 | Tanks, hills and a bag of odd shells: lob one over |

## Arcade games

These are `ArcadeGame`s, played in real time: see [arcade games](arcade-games.md). They are in `ARCADE_GAMES`, not `KIT_GAMES`; look one up with `arcadeGame(id)`.

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Shitstorm | `skyfire` | 1 to 4 (1) |  | 4 | Dodge the bullets, chain the kills, beat your score |
| Tower of Ryan | `bulwark` | 1 to 4 (1) |  | 4 | Build towers, hold the road, send the next wave if you dare |
| Chip Stack | `chipstack` | 1 to 4 (1) |  | 4 | Tap, buy, and stack as high as the clock allows |
| Road to the Shootout | `pinkslips` | 1 to 4 (2) |  | 4 | Build a shitbox, line it up, and leave on the green |
| Air Hockey | `airhockey` | 1 to 2 (2) |  | 5 | A puck on air, a mallet each, and a goal to guard |
| Zubra Quest | `zubraquest` | 1 (1) |  | 3 | A sixteen-bit adventure: a sword, three dens, three stolen Stripes and the thief who took them. |
| Delbie's Counter | `counter` | 1 (1) |  | 3 | A shift behind the parts counter: look it up, ring it up, make the change, and keep the line moving. |

## Idle games

These are `IdleGame`s, which carry on while nobody is looking: see [idle games](idle-games.md). They are in `IDLE_GAMES`; look one up with `idleGame(id)`.

| Game | `id` | Seats | Teams | Presets | Blurb |
| --- | --- | --- | --- | --- | --- |
| Delbie's Daycare & Geriatrics | `delbies` | 1 |  |  | Run the parts store. Mind the counter. Never say no |

## Not on the kit

Spades and Palace predate the kit and have their own packages with their own functions: [`@journey-to-code/rules`](packages.md#rules-spades) and [`@journey-to-code/palace`](packages.md#palace). The drinking games on this list (Ride the Bus, Kings Cup, Horse Race and Drinking Pyramid) are for adults.
