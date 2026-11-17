// Liar's Dice: everyone rolls five dice under a cup and looks only at their own. In turn, each
// player bids how many dice of one number there are under all the cups together ("four fives"),
// and every bid has to be higher than the last: more dice, or the same number of a higher face.
// Instead of bidding you can call the last bidder a liar. Then every cup is lifted and the dice are
// counted: if there are at least as many as the bid said, the caller loses a die; if not, the
// bidder does. Everyone rolls again, the loser bids first, and the last player with dice wins.
//
// Ones are wild at most tables: they count as whatever number was bid.
//
// A seat's dice are its own: they are in that seat's view and nobody else's (the board kit's
// private `dice`), until a call lifts the cups. Then every hand is shown, to everyone, until the
// table moves on.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardView } from "./board.js";
import { drink, newTally, type Tally } from "./drinks.js";
import { drinkingField } from "./kit.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, who, type BaseRules, type Choice } from "./table.js";

export interface LiarsDiceRules extends BaseRules {
  /** How many dice everyone starts with. */
  dice: number;
  /** Ones count as whatever number was bid (but only as ones when ones are bid). */
  wild: boolean;
  /** Drinking mode: lose a die and you drink. */
  drinking: boolean;
}

export const classicLiarsDice: LiarsDiceRules = { id: "liarsdice-classic", name: "Classic", dice: 5, wild: true, drinking: false };
export const plainLiarsDice: LiarsDiceRules = { id: "liarsdice-plain", name: "No wild ones", dice: 5, wild: false, drinking: false };
export const quickLiarsDice: LiarsDiceRules = { id: "liarsdice-quick", name: "Quick (three dice)", dice: 3, wild: true, drinking: false };
export const drinkingLiarsDice: LiarsDiceRules = { ...classicLiarsDice, id: "liarsdice-drinking", name: "Drinking Liar's Dice 🍺", drinking: true };
const PRESETS = [classicLiarsDice, plainLiarsDice, quickLiarsDice, drinkingLiarsDice];
const DICE = [3, 4, 5];

const FACE_ONE = ["", "one", "two", "three", "four", "five", "six"];
const FACE_MANY = ["", "ones", "twos", "threes", "fours", "fives", "sixes"];
/** How many quantities up from the lowest legal one a seat is offered to bid. */
const ROWS = 3;

export interface LiarsDiceBid {
  seat: number;
  /** How many dice… */
  count: number;
  /** …of which number. */
  face: number;
}

export interface LiarsDiceState {
  game: "liarsdice";
  rules: LiarsDiceRules;
  seats: number;
  rng: number;
  /** Which round, from 1: the dice are rolled afresh for each. */
  round: number;
  /** Whose turn it is to bid or call. */
  turn: number;
  /** Each seat's dice: empty for a seat that is out. */
  hands: number[][];
  /** The bid that stands, or null before the first of a round. */
  bid: LiarsDiceBid | null;
  /** The last call: who called whom, how many there were, and who lost a die. `hands` is every cup as it was lifted. */
  called: { caller: number; bid: LiarsDiceBid; found: number; loser: number; hands: number[][] } | null;
  /** After a call: who has looked and is ready for the next round. */
  ready: boolean[];
  /** The seats that are out, in the order they went. */
  out: number[];
  tally: Tally;
  phase: "bidding" | "reveal" | "finished";
  narration: string | null;
}

export type LiarsDiceMove = { type: "bid"; count: number; face: number } | { type: "liar" } | { type: "next" };

const alive = (s: LiarsDiceState, seat: number) => s.hands[seat]!.length > 0;
const totalDice = (s: LiarsDiceState) => s.hands.reduce((n, hand) => n + hand.length, 0);
/** The next seat round the table that still has dice. */
function after(s: LiarsDiceState, seat: number): number {
  for (let i = 1; i <= s.seats; i++) if (alive(s, (seat + i) % s.seats)) return (seat + i) % s.seats;
  return seat;
}
/** "three fives", "one six". */
const say = (bid: Pick<LiarsDiceBid, "count" | "face">) => `${bid.count} ${bid.count === 1 ? FACE_ONE[bid.face] : FACE_MANY[bid.face]}`;
/** Whether a die counts towards a bid on `face`. */
const counts = (rules: LiarsDiceRules, die: number, face: number) => die === face || (rules.wild && die === 1);
/** How many dice in these hands count towards a bid on `face`. */
const countOf = (rules: LiarsDiceRules, hands: readonly number[][], face: number) => hands.reduce((n, hand) => n + hand.filter((die) => counts(rules, die, face)).length, 0);
/** Whether a bid outbids the one that stands: more dice, or as many of a higher number. */
const outbids = (bid: Pick<LiarsDiceBid, "count" | "face">, stands: LiarsDiceBid | null) => !stands || bid.count > stands.count || (bid.count === stands.count && bid.face > stands.face);

function rollAll(s: LiarsDiceState) {
  const rand = nextRandom(s);
  s.hands = s.hands.map((hand) => hand.map(() => 1 + Math.floor(rand() * 6)));
}

export function newLiarsDice(rules: LiarsDiceRules, seats: number, seed: number): LiarsDiceState {
  const s = { game: "liarsdice", rules, seats, rng: seed >>> 0, round: 1, bid: null, called: null, out: [], phase: "bidding", narration: null } as unknown as LiarsDiceState;
  s.turn = Math.floor(nextRandom(s)() * seats);
  s.hands = Array.from({ length: seats }, () => Array<number>(rules.dice).fill(0));
  rollAll(s);
  s.ready = Array<boolean>(seats).fill(false);
  s.tally = newTally(seats);
  return s;
}

/**
 * The bids a seat is offered: every number at the lowest quantity that outbids what stands, and at
 * the next two quantities up, never more dice than are on the table. (Any higher bid is legal; these
 * are the ones with a button.)
 */
export function liarsDiceBids(s: LiarsDiceState): { count: number; face: number }[] {
  const total = totalDice(s);
  const out: { count: number; face: number }[] = [];
  const from = s.bid ? (s.bid.face < 6 ? s.bid.count : s.bid.count + 1) : 1;
  for (let count = from; count < from + ROWS && count <= total; count++) {
    for (let face = 1; face <= 6; face++) if (outbids({ count, face }, s.bid)) out.push({ count, face });
  }
  return out;
}

// ---- Moves --------------------------------------------------------------------------------------

/** The loser of a call gives up a die. True when that leaves one player with dice. */
function takeDie(s: LiarsDiceState, loser: number): boolean {
  s.hands[loser]!.pop();
  if (!alive(s, loser)) s.out.push(loser);
  return s.hands.filter((hand) => hand.length).length <= 1;
}

function apply(state: LiarsDiceState, seat: number, move: LiarsDiceMove): LiarsDiceState {
  if (move?.type !== "bid" && move?.type !== "liar" && move?.type !== "next") throw new GameError("That's not a move in Liar's Dice.");
  if (state.phase === "finished") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  const { rules } = state;

  if (move.type === "next") {
    if (state.phase !== "reveal") throw new GameError("There's nothing to move on from.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    // Everyone has looked: the loser's die goes, the cups go back down and everyone rolls again.
    const { loser } = s.called!;
    takeDie(s, loser);
    s.ready.fill(false);
    s.bid = null;
    s.round += 1;
    s.phase = "bidding";
    s.turn = alive(s, loser) ? loser : after(s, loser);
    rollAll(s);
    s.narration = `Round ${s.round}: ${who(s.turn)} bids first`;
    return s;
  }

  if (state.phase !== "bidding") throw new GameError("The cups are up: move on to the next round.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");

  if (move.type === "bid") {
    // A bid is how many and of what, and nothing else: anything more is a move meant for some other table.
    if (Object.keys(move).some((key) => key !== "type" && key !== "count" && key !== "face")) throw new GameError("That's not a bid.");
    const count = Number(move.count);
    const face = Number(move.face);
    if (!Number.isInteger(face) || face < 1 || face > 6) throw new GameError("Bid a number from one to six.");
    if (!Number.isInteger(count) || count < 1) throw new GameError("Bid at least one die.");
    if (count > totalDice(state)) throw new GameError(`There are only ${totalDice(state)} dice on the table.`);
    if (!outbids({ count, face }, state.bid)) throw new GameError(`You have to bid higher than ${say(state.bid!)}: more dice, or as many of a higher number.`);
    const s = clone(state);
    s.bid = { seat, count, face };
    s.turn = after(s, seat);
    s.narration = `${who(seat)} bids ${say(s.bid)}`;
    return s;
  }

  const bid = state.bid;
  if (!bid) throw new GameError("There's no bid to call yet.");
  const s = clone(state);
  const found = countOf(rules, s.hands, bid.face);
  const loser = found >= bid.count ? seat : bid.seat;
  s.called = { caller: seat, bid, found, loser, hands: clone(s.hands) };
  s.narration =
    `${who(seat)} calls ${who(bid.seat)} a liar on ${say(bid)}: there ${found === 1 ? "is" : "are"} ${found === 0 ? `no ${FACE_MANY[bid.face]}` : say({ count: found, face: bid.face })}, so ${who(loser)} loses a die` +
    (rules.drinking ? ` · ${drink(s.tally, [loser], 1)}` : "");
  // The last die of the last but one player: there is no next round to move on to.
  if (s.hands[loser]!.length === 1 && s.hands.filter((hand) => hand.length).length === 2) {
    takeDie(s, loser);
    s.phase = "finished";
    return s;
  }
  s.phase = "reveal";
  s.ready.fill(false);
  return s;
}

const winnersOf = (s: LiarsDiceState) => s.hands.flatMap((hand, seat) => (hand.length ? [seat] : []));

// ---- The computer player ------------------------------------------------------------------------
// It knows its own dice and how many the others hold, and nothing else: a bid is as likely as the
// dice it can't see are to make up the difference.

/** The chance that at least `need` of `dice` unseen dice count, each with chance `p`. */
function atLeast(dice: number, need: number, p: number): number {
  if (need <= 0) return 1;
  if (need > dice) return 0;
  let chance = 0;
  let ways = 1;
  for (let k = 0; k <= dice; k++) {
    if (k >= need) chance += ways * p ** k * (1 - p) ** (dice - k);
    ways = (ways * (dice - k)) / (k + 1);
  }
  return chance;
}

/** How likely a bid is to be true, as one seat sees it. */
export function liarsDiceChance(s: LiarsDiceState, seat: number, bid: Pick<LiarsDiceBid, "count" | "face">): number {
  const mine = s.hands[seat]!;
  const have = mine.filter((die) => counts(s.rules, die, bid.face)).length;
  return atLeast(totalDice(s) - mine.length, bid.count - have, s.rules.wild && bid.face !== 1 ? 1 / 3 : 1 / 6);
}

function bot(s: LiarsDiceState, seat: number, style: PlayStyle, rand: () => number = Math.random): LiarsDiceMove | null {
  if (s.phase === "reveal") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "bidding" || s.turn !== seat) return null;
  const offers = liarsDiceBids(s);
  if (!offers.length) return { type: "liar" };
  const bidding = (o: { count: number; face: number }): LiarsDiceMove => ({ type: "bid", count: o.count, face: o.face });
  // A careless moment: any bid from the lowest row, or a call out of nowhere.
  if (careless(style, rand)) return s.bid && rand() < 0.35 ? { type: "liar" } : bidding(pickRandom(offers.slice(0, 6), rand));
  // The safest raise there is, or, where several are a good bet, the one that asks most of the next player.
  const chances = offers.map((o) => liarsDiceChance(s, seat, o));
  const safest = Math.max(...chances);
  // A good bet is one more likely than not, with something to spare; of those it takes the most dice, and of those the surest.
  const pool = chances.some((c) => c >= 0.6) ? offers.filter((_, i) => chances[i]! >= 0.6) : offers.filter((_, i) => chances[i]! >= safest - 1e-9);
  const most = Math.max(...pool.map((o) => o.count));
  const best = pool.filter((o) => o.count === most).reduce((a, b) => (liarsDiceChance(s, seat, b) > liarsDiceChance(s, seat, a) + 1e-9 ? b : a));
  // Call when the bid that stands is less likely to be true than the best raise is.
  if (s.bid && 1 - liarsDiceChance(s, seat, s.bid) > liarsDiceChance(s, seat, best)) return { type: "liar" };
  return bidding(best);
}

// ---- What a seat sees ---------------------------------------------------------------------------

/** A hand laid out for everyone, lowest first: "1 2 2 5 6". */
const faces = (hand: readonly number[]) => (hand.length ? [...hand].sort((a, b) => a - b).join(" ") : "out");

function view(s: LiarsDiceState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const lifted = s.phase !== "bidding" && !!s.called;
  const mine = s.phase === "bidding" && s.turn === seat;
  const total = totalDice(s);
  // While the cups are up (and at the end) the dice shown are the ones that were called on.
  const hand = lifted ? s.called!.hands[seat]! : s.hands[seat]!;
  const offers = mine ? liarsDiceBids(s) : [];
  const options: Choice[] = [
    ...(mine && s.bid ? [{ label: "Liar!", move: { type: "liar" }, primary: true, hint: `Call ${say(s.bid)}` }] : []),
    ...offers.map((o) => ({ label: say(o), move: { type: "bid", count: o.count, face: o.face } })),
  ];
  return {
    game: "liarsdice",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "bidding" ? s.turn : null,
    grids: [],
    reserves: [],
    // This seat's own dice, and nobody else's view has them.
    dice: { dice: hand.map((value, id) => ({ id, value })), roll: s.round, sides: 6, tap: null, owner: seat },
    choices: mine
      ? { prompt: s.bid ? `${who(s.bid.seat)} bid ${say(s.bid)}. Bid higher, or call it` : "Bid how many of one number are under all the cups", options, layout: "grid" }
      : s.phase === "reveal"
        ? nextHandChoices(s.ready, seat, false, "Next round")
        : null,
    players: s.hands.map((dice, i) => ({
      // The cups are up: every hand is on the table.
      line: [lifted ? faces(s.called!.hands[i]!) : dice.length ? `${dice.length} ${dice.length === 1 ? "die" : "dice"}` : "out", ...(rules.drinking ? [`🍺 ${s.tally.drank[i]}`] : [])].join(" · "),
      out: !dice.length,
      badge: lifted && !over ? (s.called!.loser === i ? "Loses a die" : s.ready[i] ? "Ready" : undefined) : s.phase === "bidding" && s.bid?.seat === i ? say(s.bid) : undefined,
    })),
    info: [
      ...(over ? [] : [`${total} dice on the table`]),
      ...(over ? [] : [rules.wild ? "Ones are wild" : "No wild ones"]),
      ...(s.phase === "bidding" && s.bid ? [`The bid: ${say(s.bid)}`] : []),
      ...(rules.drinking && !over ? ["🍺 Lose a die: you drink"] : []),
    ],
    narration: s.narration,
    scores: s.hands.map((dice, i) => ({ seats: [i], value: dice.length })),
    result: null,
    over: over ? { winners: winnersOf(s), title: `${who(winnersOf(s)[0]!)} wins!` } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): LiarsDiceRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<LiarsDiceRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicLiarsDice;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), dice: DICE.includes(Number(r.dice)) ? Number(r.dice) : 5, wild: !!r.wild, drinking: !!r.drinking };
}

export const liarsDice: BoardGame<LiarsDiceRules, LiarsDiceState, LiarsDiceMove> = {
  id: "liarsdice",
  name: "Liar's Dice",
  emoji: "🤥",
  category: "dice",
  blurb: "Bid on dice you can't see, or call the bluff",
  tagline: "Everyone's dice are hidden. Bid how many of a number are under all the cups, raise the bid, or call the last bidder a liar. Lose a call, lose a die.",
  seats: { min: 2, max: 6, default: 3 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "dice", label: "Dice each", kind: "choice", options: DICE.map((n) => [n, `${n} dice`]) },
    { key: "wild", label: "Ones are wild", hint: "A one counts as whatever number was bid. When ones themselves are bid, only ones count.", kind: "toggle" },
    drinkingField<LiarsDiceRules>("Adults only. Lose a die and you take a drink (water counts)."),
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Everyone rolls ${r.dice} dice and looks only at their own.`,
      "In turn, bid how many dice of one number there are under all the cups together: \"four fives\". Every bid has to be higher than the last: more dice of any number, or the same number of dice of a higher number.",
      "Instead of bidding you can call the last bidder a liar. Every cup is lifted and the dice are counted. If there are at least as many as the bid said, the caller loses a die; if there are fewer, the bidder does.",
      r.wild ? "Ones are wild: a one counts as whatever number was bid. When ones themselves are bid, only ones count." : "Ones are not wild: only the number that was bid counts.",
      "Then everyone rolls again, and whoever lost the die bids first. A player with no dice left is out, and the last player with dice wins.",
      ...(r.drinking ? ["🍺 Drinking mode: lose a die and you take a drink."] : []),
    ];
  },
  newGame: newLiarsDice,
  apply,
  view,
  bot,
  // Moving on after a call is quick; a bid is weighed, and a call weighed longer.
  thinkingTime: (s) => (s.phase === "reveal" ? 2200 : s.bid ? 1600 : 1100),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "liarsdice",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      scoreLine: s.hands.map((hand) => hand.length).join(" · ") + (s.rules.drinking ? ` · 🍺 ${s.tally.drank.join(" · ")}` : ""),
      // The winner, then everyone else from the last to go out to the first.
      order: over ? [...winnersOf(s), ...[...s.out].reverse()] : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
