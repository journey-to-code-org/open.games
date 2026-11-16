// Every game on the kit, by id. Adding a game: write its engine and list it here, with the card
// games, the board games or the table sports.
import { hearts } from "./hearts.js";
import { ohHell } from "./ohhell.js";
import { euchre } from "./euchre.js";
import { crazy8 } from "./crazy8.js";
import { gin } from "./gin.js";
import { pinochle } from "./pinochle.js";
import { canasta } from "./canasta.js";
import { goFish } from "./gofish.js";
import { oldMaid } from "./oldmaid.js";
import { war } from "./war.js";
import { whist } from "./whist.js";
import { golf } from "./golf.js";
import { rummy500 } from "./rummy500.js";
import { president } from "./president.js";
import { klondike } from "./klondike.js";
import { freeCell } from "./freecell.js";
import { mahjongShanghai } from "./mahjongshanghai.js";
import { handFoot } from "./handfoot.js";
import { cribbage } from "./cribbage.js";
import { fiveDraw } from "./fivedraw.js";
import { holdem } from "./holdem.js";
import { bluff } from "./bluff.js";
import { liarsPoker } from "./liarspoker.js";
import { switchGame } from "./switch.js";
import { thirtyOne } from "./thirtyone.js";
import { kingsCorner } from "./kingscorner.js";
import { blackjack } from "./blackjack.js";
import { spite } from "./spite.js";
import { pitch } from "./pitch.js";
import { fiveHundred } from "./fivehundred.js";
import { durak } from "./durak.js";
import { bridge } from "./bridge.js";
import { fruitSalad } from "./fruitsalad.js";
import { slapjack } from "./slapjack.js";
import { speed } from "./speed.js";
import { memory } from "./memory.js";
import { sevens } from "./sevens.js";
import { cuckoo } from "./cuckoo.js";
import { contractRummy } from "./contractrummy.js";
import { spider } from "./spider.js";
import { pyramid } from "./pyramid.js";
import { rideTheBus } from "./ridethebus.js";
import { kingsCup } from "./kingscup.js";
import { horseRace } from "./horserace.js";
import { drinkingPyramid } from "./drinkingpyramid.js";
import { ticTacToe } from "./tictactoe.js";
import { dropFour } from "./dropfour.js";
import { combat } from "./combat.js";
import { reversi } from "./reversi.js";
import { checkers } from "./checkers.js";
import { go } from "./go.js";
import { chess } from "./chess.js";
import { yacht } from "./yacht.js";
import { backgammon } from "./backgammon.js";
import { miniGolf } from "./minigolf.js";
import { bowling } from "./bowling.js";
import { skyfire } from "./skyfire.js";
import { bulwark } from "./bulwark.js";
import { chipStack } from "./chipstack.js";
import { pinkSlips } from "./pinkslips.js";
import type { ArcadeGame, ArcadeGameId } from "./arcade.js";
import { delbies } from "./delbies.js";
import type { IdleGame, IdleGameId } from "./idle.js";
import type { BoardGame } from "./board.js";
import type { SportGame } from "./sport.js";
import type { CardGame } from "./kit.js";
import type { BoardGameId, CardGameId, GameCategory, KitGameId, SportGameId, TableGame } from "./table.js";

export const CARD_GAMES: CardGame<any, any, any>[] = [hearts, ohHell, euchre, crazy8, gin, pinochle, canasta, goFish, oldMaid, war, whist, golf, rummy500, president, klondike, freeCell, handFoot, cribbage, fiveDraw, holdem, bluff, liarsPoker, switchGame, thirtyOne, kingsCorner, blackjack, spite, pitch, fiveHundred, durak, bridge, fruitSalad, slapjack, speed, memory, sevens, cuckoo, contractRummy, spider, pyramid, rideTheBus, kingsCup, horseRace, drinkingPyramid, mahjongShanghai];

export const BOARD_GAMES: BoardGame<any, any, any>[] = [ticTacToe, dropFour, combat, reversi, checkers, go, chess, yacht, backgammon];

export const SPORT_GAMES: SportGame<any, any, any>[] = [miniGolf, bowling];

/**
 * Every game on the kit, cards, boards and table sports alike. Rooms, houses, challenges, tournaments, the setup
 * screen and practice go by this list: none of them care what the table looks like.
 */
export const KIT_GAMES: TableGame<any, any, any, any>[] = [...CARD_GAMES, ...BOARD_GAMES, ...SPORT_GAMES];

export const kitGame = (id: unknown): TableGame<any, any, any, any> | undefined => KIT_GAMES.find((g) => g.id === id);
export const isKitGame = (id: unknown): id is KitGameId => KIT_GAMES.some((g) => g.id === id);
export const isCardGame = (id: unknown): id is CardGameId => CARD_GAMES.some((g) => g.id === id);
export const isBoardGame = (id: unknown): id is BoardGameId => BOARD_GAMES.some((g) => g.id === id);
export const isSportGame = (id: unknown): id is SportGameId => SPORT_GAMES.some((g) => g.id === id);

/**
 * The arcade games: played in real time against the game itself, so they are `ArcadeGame`s, with a
 * tick where a `TableGame` has a move. They are not in `KIT_GAMES`: a room that takes turns cannot
 * run them.
 */
export const ARCADE_GAMES: ArcadeGame<any, any, any>[] = [skyfire, bulwark, chipStack, pinkSlips];
export const arcadeGame = (id: unknown): ArcadeGame<any, any, any> | undefined => ARCADE_GAMES.find((g) => g.id === id);
export const isArcadeGame = (id: unknown): id is ArcadeGameId => ARCADE_GAMES.some((g) => g.id === id);

/**
 * The idle games: they go by the clock on the wall and carry on while nobody is looking, so they
 * are `IdleGame`s. One player each; no room, no table.
 */
export const IDLE_GAMES: IdleGame<any, any, any>[] = [delbies];
export const idleGame = (id: unknown): IdleGame<any, any, any> | undefined => IDLE_GAMES.find((g) => g.id === id);
export const isIdleGame = (id: unknown): id is IdleGameId => IDLE_GAMES.some((g) => g.id === id);

/** What a picker needs to know about a game, whichever kit it is on. */
export type GameInfo = Pick<TableGame, "name" | "emoji" | "category" | "blurb" | "tagline" | "seats" | "teams"> & { id: KitGameId | ArcadeGameId | IdleGameId };
/** Every game there is: the kit's, then the arcade's, then the idle ones. */
export const ALL_GAMES: GameInfo[] = [...KIT_GAMES, ...ARCADE_GAMES, ...IDLE_GAMES];
/** The games on one shelf of a picker, in order. */
export const gamesIn = (category: GameCategory): GameInfo[] => ALL_GAMES.filter((g) => g.category === category);
