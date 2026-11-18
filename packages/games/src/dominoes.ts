// Dominoes, with the double-six set: 28 tiles, each with a number of pips from none to six at
// either end. Everyone draws a hand; the rest is the boneyard. Tiles are laid end to end in a line,
// and a tile can only go down with one of its ends against an end of the line that shows the same
// number. First to play their last tile wins the round, and scores the pips left in the other hands.
//
//   - Draw: if you can't play, you draw from the boneyard until you can; when it is empty, you pass.
//   - Block: there is no drawing: if you can't play, you pass.
//   - All Fives: as Draw, and whenever the two ends of the line add up to a multiple of five, the
//     player who made them so scores that many at once. (A double at an end counts both its halves.)
//
// If nobody can play, the round is blocked: the lightest hand wins it, and scores the pips in the
// others less its own. Rounds are played until someone reaches the target.
//
// The line is a grid of one row, a tile a cell, in order from one end to the other (a table that
// knows dominoes draws it as a line that winds; one that doesn't still has a row of tiles). A
// seat's hand is a second grid that is its own: in that seat's view and nobody else's. A tile
// that could go at either end is picked up first, and then the end is chosen with a button.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardGrid, BoardPiece, BoardView } from "./board.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, rankSeats, shuffled, thinkFor, who, type BaseRules, type Choice } from "./table.js";

export interface DominoesRules extends BaseRules {
  /** The score that wins the game. */
  target: number;
  /** Draw from the boneyard when you can't play. Off is the block game: you pass. */
  draw: boolean;
  /** All Fives: ends that add up to a multiple of five score at once. */
  fives: boolean;
}

export const drawDominoes: DominoesRules = { id: "dominoes-draw", name: "Draw", target: 100, draw: true, fives: false };
export const blockDominoes: DominoesRules = { id: "dominoes-block", name: "Block", target: 100, draw: false, fives: false };
export const fivesDominoes: DominoesRules = { id: "dominoes-fives", name: "All Fives", target: 150, draw: true, fives: true };
export const quickDominoes: DominoesRules = { id: "dominoes-quick", name: "Quick (to 50)", target: 50, draw: true, fives: false };
const PRESETS = [drawDominoes, blockDominoes, fivesDominoes, quickDominoes];
const TARGETS = [50, 100, 150, 200];

/** A tile: its two ends, the smaller first. A double has them the same. */
export type Domino = [number, number];
/** A tile in the line, the way it lies: `a` is towards the line's first end, `b` towards its last. */
export interface LaidDomino {
  a: number;
  b: number;
}
export type DominoEnd = "left" | "right";

export interface DominoesState {
  game: "dominoes";
  rules: DominoesRules;
  seats: number;
  rng: number;
  /** Which round, from 1. */
  round: number;
  /** Who leads this round. */
  lead: number;
  turn: number;
  hands: Domino[][];
  boneyard: Domino[];
  /** The line, from its left end to its right. */
  line: LaidDomino[];
  /** The tile the leader has to open the first round with (the highest double dealt, or the heaviest tile), until it is played. */
  opener: Domino | null;
  /** The tile the mover has picked up while choosing an end for it: an index into their hand. */
  held: number | null;
  /** Turns passed in a row: when everyone has, the round is blocked. */
  passes: number;
  /** The tile laid last, as an index into the line. */
  last: number | null;
  /** What each seat did on its last turn this round, for a badge: "drew", "passed". */
  did: (string | null)[];
  scores: number[];
  /** The round just scored: who won it (null for a blocked round nobody won), what they scored, and the pips everyone was left with. */
  scored: { winner: number | null; points: number; pips: number[]; blocked: boolean } | null;
  phase: "playing" | "scored" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type DominoesMove = { type: "play"; cell: number; grid?: string } | { type: "end"; end: DominoEnd } | { type: "back" } | { type: "draw" } | { type: "pass" } | { type: "next" };

// ---- The tiles ----------------------------------------------------------------------------------

const NUMBER = ["blank", "one", "two", "three", "four", "five", "six"];
/** "double six", "five and three", "four and blank". */
export const dominoName = ([lo, hi]: readonly [number, number]): string => (lo === hi ? `double ${NUMBER[lo]}` : `${NUMBER[hi]} and ${NUMBER[lo]}`);
const pipsOf = (hand: readonly Domino[]) => hand.reduce((n, [a, b]) => n + a + b, 0);
const fullSet = (): Domino[] => Array.from({ length: 7 }, (_, lo) => Array.from({ length: 7 - lo }, (_, i): Domino => [lo, lo + i])).flat();
/** How many tiles everyone draws: seven for two players, five for more. */
const handSize = (seats: number) => (seats <= 2 ? 7 : 5);

/** The numbers showing at the two ends of the line; null while nothing has been played. */
export const dominoEnds = (line: readonly LaidDomino[]): [number, number] | null => (line.length ? [line[0]!.a, line.at(-1)!.b] : null);

/** The ends a tile could go on: both for the first tile of a round (it has no end to match). */
function fits(s: Pick<DominoesState, "line" | "opener">, tile: Domino): DominoEnd[] {
  if (s.opener) return tile[0] === s.opener[0] && tile[1] === s.opener[1] ? ["right"] : [];
  const ends = dominoEnds(s.line);
  if (!ends) return ["right"];
  const out: DominoEnd[] = [];
  if (tile.includes(ends[0])) out.push("left");
  // The same number at both ends: either end is the same play.
  if (tile.includes(ends[1]) && !(out.length && ends[0] === ends[1])) out.push("right");
  return out;
}
/** The tiles in the mover's hand that can be played, as indexes. */
const playable = (s: DominoesState, seat: number) => s.hands[seat]!.flatMap((tile, i) => (fits(s, tile).length ? [i] : []));

/** What the ends of a line add up to, a double counting both its halves: what All Fives scores on. */
export function dominoEndSum(line: readonly LaidDomino[]): number {
  if (!line.length) return 0;
  const first = line[0]!;
  const last = line.at(-1)!;
  if (line.length === 1) return first.a + first.b;
  return (first.a === first.b ? first.a * 2 : first.a) + (last.a === last.b ? last.b * 2 : last.b);
}

/** The line with a tile added at an end, turned so the matching number meets it. */
function laid(line: readonly LaidDomino[], tile: Domino, end: DominoEnd): LaidDomino[] {
  const ends = dominoEnds(line);
  if (!ends) return [{ a: tile[0], b: tile[1] }];
  if (end === "left") return [{ a: tile[0] === ends[0] ? tile[1] : tile[0], b: ends[0] }, ...line];
  return [...line, { a: ends[1], b: tile[0] === ends[1] ? tile[1] : tile[0] }];
}

// ---- A round ------------------------------------------------------------------------------------

function deal(s: DominoesState, first: boolean) {
  const tiles = shuffled(fullSet(), nextRandom(s));
  const each = handSize(s.seats);
  s.hands = Array.from({ length: s.seats }, (_, seat) => tiles.slice(seat * each, (seat + 1) * each).sort((p, q) => p[0] - q[0] || p[1] - q[1]));
  s.boneyard = tiles.slice(s.seats * each);
  s.line = [];
  s.held = null;
  s.passes = 0;
  s.last = null;
  s.did = Array<string | null>(s.seats).fill(null);
  s.scored = null;
  s.opener = null;
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  if (first) {
    // The first round is opened by the highest double anyone was dealt; with no double out, by the heaviest tile.
    const worth = ([lo, hi]: Domino) => (lo === hi ? 100 + lo : lo + hi + hi / 10);
    let best: Domino = s.hands[0]![0]!;
    for (const [seat, hand] of s.hands.entries()) {
      for (const tile of hand) {
        if (worth(tile) >= worth(best)) {
          best = tile;
          s.lead = seat;
        }
      }
    }
    s.opener = best;
  }
  s.turn = s.lead;
  s.narration = first ? `${who(s.lead)} leads with the ${dominoName(s.opener!)}` : `Round ${s.round}: ${who(s.lead)} leads`;
}

export function newDominoes(rules: DominoesRules, seats: number, seed: number): DominoesState {
  const s = { game: "dominoes", rules, seats, rng: seed >>> 0, round: 1, lead: 0 } as DominoesState;
  s.scores = Array<number>(seats).fill(0);
  deal(s, true);
  return s;
}

/** To the nearest five, as All Fives scores a round. */
const toFive = (n: number) => Math.round(n / 5) * 5;

/** The round is over: score it, and end the game if that reaches the target. */
function settle(s: DominoesState, blocked: boolean) {
  const pips = s.hands.map(pipsOf);
  const least = Math.min(...pips);
  const lightest = pips.flatMap((p, seat) => (p === least ? [seat] : []));
  // Whoever is out of tiles; or (blocked) the lightest hand, and nobody if two hands are as light.
  const out = s.hands.findIndex((hand) => !hand.length);
  const winner = !blocked && out >= 0 ? out : lightest.length === 1 ? lightest[0]! : null;
  let points = 0;
  if (winner !== null) {
    points = pips.reduce((n, p) => n + p, 0) - pips[winner]! * 2;
    if (s.rules.fives) points = toFive(points);
    s.scores[winner]! += points;
  }
  s.scored = { winner, points, pips, blocked };
  s.held = null;
  const line = winner === null ? `The line is blocked and ${lightest.map(who).join(" and ")} are level on ${least}: nobody scores` : blocked ? `The line is blocked. ${who(winner)} has the lightest hand and scores ${points}` : `${who(winner)} is out and scores ${points}`;
  s.narration = s.narration && !blocked ? `${s.narration}. ${line}` : line;
  s.phase = s.scores.some((n) => n >= s.rules.target) ? "finished" : "scored";
}

// ---- Moves --------------------------------------------------------------------------------------

/** Put a tile from the mover's hand on an end of the line, and see what that does. */
function place(s: DominoesState, seat: number, index: number, end: DominoEnd) {
  const [tile] = s.hands[seat]!.splice(index, 1) as [Domino];
  s.line = laid(s.line, tile, end);
  s.last = end === "left" ? 0 : s.line.length - 1;
  s.opener = null;
  s.held = null;
  s.passes = 0;
  s.did[seat] = null;
  s.narration = `${who(seat)} plays the ${dominoName(tile)}`;
  if (s.rules.fives) {
    const sum = dominoEndSum(s.line);
    if (sum > 0 && sum % 5 === 0) {
      s.scores[seat]! += sum;
      s.narration += `: the ends make ${sum}, and ${who(seat)} scores ${sum}`;
      if (s.scores[seat]! >= s.rules.target) {
        // Enough to win, there and then.
        s.scored = { winner: seat, points: sum, pips: s.hands.map(pipsOf), blocked: false };
        s.phase = "finished";
        return;
      }
    }
  }
  if (!s.hands[seat]!.length) return settle(s, false);
  s.turn = (seat + 1) % s.seats;
}

function apply(state: DominoesState, seat: number, move: DominoesMove): DominoesState {
  const type = move?.type;
  if (type !== "play" && type !== "end" && type !== "back" && type !== "draw" && type !== "pass" && type !== "next") throw new GameError("That's not a move in Dominoes.");
  if (state.phase === "finished") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");

  if (type === "next") {
    if (state.phase !== "scored") throw new GameError("There's a round going on.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // Whoever won the round leads the next; after a round nobody won, the lead moves on one.
      s.lead = s.scored!.winner ?? (s.lead + 1) % s.seats;
      s.round += 1;
      deal(s, false);
    }
    return s;
  }
  if (state.phase !== "playing") throw new GameError("The round is over: move on to the next.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const hand = state.hands[seat]!;

  if (type === "play") {
    const cell = Number(move.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell >= hand.length) throw new GameError("That's not one of your tiles.");
    if (move.grid !== undefined && move.grid !== "hand") throw new GameError("Play a tile from your hand.");
    const ends = fits(state, hand[cell]!);
    if (!ends.length) throw new GameError(state.opener ? `The first tile has to be the ${dominoName(state.opener)}.` : `The ${dominoName(hand[cell]!)} doesn't match either end of the line.`);
    const s = clone(state);
    // A tile that could go at either end is picked up, and the end asked for; picked up already, it goes back.
    if (ends.length > 1) s.held = s.held === cell ? null : cell;
    else place(s, seat, cell, ends[0]!);
    return s;
  }
  if (type === "end") {
    if (state.held === null) throw new GameError("Pick a tile first.");
    if (move.end !== "left" && move.end !== "right") throw new GameError("Choose an end of the line.");
    if (!fits(state, hand[state.held]!).includes(move.end)) throw new GameError("That tile doesn't match that end.");
    const s = clone(state);
    place(s, seat, state.held, move.end);
    return s;
  }
  if (type === "back") {
    if (state.held === null) throw new GameError("You aren't holding a tile.");
    return { ...clone(state), held: null };
  }

  if (playable(state, seat).length) throw new GameError("You have a tile that can be played.");
  if (type === "draw") {
    if (!state.rules.draw) throw new GameError("There's no drawing in the block game: pass.");
    if (!state.boneyard.length) throw new GameError("The boneyard is empty: pass.");
    const s = clone(state);
    s.hands[seat]!.push(s.boneyard.pop()!);
    s.did[seat] = "Drew";
    s.narration = `${who(seat)} draws a tile`;
    return s;
  }
  if (state.rules.draw && state.boneyard.length) throw new GameError("Draw from the boneyard first.");
  const s = clone(state);
  s.passes += 1;
  s.did[seat] = "Passed";
  s.narration = `${who(seat)} passes`;
  if (s.passes >= s.seats) settle(s, true);
  else s.turn = (seat + 1) % s.seats;
  return s;
}

const winnersOf = (s: DominoesState) => {
  const best = Math.max(...s.scores);
  return s.scores.flatMap((n, seat) => (n === best ? [seat] : []));
};

// ---- The computer player ------------------------------------------------------------------------
// It knows its own tiles, the line, and how many tiles everyone holds. A play is judged by what it
// gets rid of (heavy tiles and doubles first: they are what costs you if someone else goes out),
// by how many of its other tiles could follow on the ends it leaves, and in All Fives by what it scores.

function worthOf(s: DominoesState, seat: number, index: number, end: DominoEnd): number {
  const hand = s.hands[seat]!;
  const tile = hand[index]!;
  const line = laid(s.line, tile, end);
  const ends = dominoEnds(line)!;
  const rest = hand.filter((_, i) => i !== index);
  let worth = tile[0] + tile[1] + (tile[0] === tile[1] ? 4 : 0);
  // Tiles it could play next turn if the ends stay as it leaves them.
  worth += rest.filter((t) => t.includes(ends[0]) || t.includes(ends[1])).length * 3;
  if (s.rules.fives) {
    const sum = dominoEndSum(line);
    if (sum % 5 === 0) worth += sum * 2;
  }
  // Going out beats everything.
  if (!rest.length) worth += 1000;
  return worth;
}

/** The best play for a seat: which tile and which end. Null when it has nothing to play. */
export function bestDominoPlay(s: DominoesState, seat: number): { index: number; end: DominoEnd } | null {
  let best: { index: number; end: DominoEnd; worth: number } | null = null;
  for (const index of playable(s, seat)) {
    for (const end of fits(s, s.hands[seat]![index]!)) {
      const worth = worthOf(s, seat, index, end);
      if (!best || worth > best.worth) best = { index, end, worth };
    }
  }
  return best && { index: best.index, end: best.end };
}

function bot(s: DominoesState, seat: number, style: PlayStyle, rand: () => number = Math.random): DominoesMove | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  if (s.held !== null) {
    // Holding a tile: the better end for it.
    const ends = fits(s, s.hands[seat]![s.held]!);
    const end = ends.reduce((a, b) => (worthOf(s, seat, s.held!, b) > worthOf(s, seat, s.held!, a) ? b : a));
    return { type: "end", end };
  }
  const can = playable(s, seat);
  if (!can.length) return s.rules.draw && s.boneyard.length ? { type: "draw" } : { type: "pass" };
  const index = careless(style, rand) ? pickRandom(can, rand) : bestDominoPlay(s, seat)!.index;
  return { type: "play", cell: index, grid: "hand" };
}

// ---- What a seat sees ---------------------------------------------------------------------------

const pieceOf = (a: number, b: number): BoardPiece => {
  const tile: Domino = a <= b ? [a, b] : [b, a];
  // The glyph is the tile as it lies ("3|5"): a table that draws dominoes reads the two numbers from it.
  return { owner: null, kind: "domino", glyph: `${a}|${b}`, label: dominoName(tile), id: `domino-${tile[0]}-${tile[1]}` };
};
const tiles = (n: number) => `${n} tile${n === 1 ? "" : "s"}`;

function overTitle(s: DominoesState): string {
  const w = winnersOf(s);
  const best = s.scores[w[0]!]!;
  return w.length > 1 ? `${w.map(who).join(" and ")} tie on ${best}!` : `${who(w[0]!)} wins with ${best}!`;
}

function view(s: DominoesState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const hand = s.hands[seat]!;
  const ends = dominoEnds(s.line);
  const can = mine ? playable(s, seat) : [];
  const line: BoardGrid = {
    id: "line",
    label: "The line",
    rows: 1,
    cols: Math.max(1, s.line.length),
    cells: s.line.length ? s.line.map((t) => pieceOf(t.a, t.b)) : [null],
    names: s.line.length ? s.line.map((_, i) => (i === 0 ? "the left end" : i === s.line.length - 1 ? "the right end" : `tile ${i + 1} of the line`)) : ["the table"],
    marks: s.last !== null && s.line.length ? [{ cell: s.last, mark: "last" }] : [],
    tap: null,
  };
  const grids: BoardGrid[] = [line];
  if (hand.length) {
    grids.push({
      id: "hand",
      label: "Your tiles",
      owner: seat,
      rows: 1,
      cols: hand.length,
      cells: hand.map(([lo, hi]) => pieceOf(lo, hi)),
      names: hand.map((tile) => `the ${dominoName(tile)}`),
      marks: mine && s.held !== null ? [{ cell: s.held, mark: "from" }] : [],
      tap: mine && can.length ? { type: "play", cells: can } : null,
    });
  }
  const held = mine && s.held !== null ? hand[s.held]! : null;
  const options: Choice[] = held
    ? [
        { label: `Next to the ${NUMBER[ends![0]]} (left end)`, move: { type: "end", end: "left" } },
        { label: `Next to the ${NUMBER[ends![1]]} (right end)`, move: { type: "end", end: "right" } },
        { label: "Put it back", move: { type: "back" } },
      ]
    : mine && !can.length
      ? rules.draw && s.boneyard.length
        ? [{ label: `Draw a tile (${s.boneyard.length} left)`, move: { type: "draw" }, primary: true }]
        : [{ label: "Pass", move: { type: "pass" }, primary: true }]
      : [];
  const round = s.scored;
  return {
    game: "dominoes",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing ? s.turn : null,
    grids,
    reserves: [],
    choices: mine
      ? {
          prompt: held ? `Which end for the ${dominoName(held)}?` : !can.length ? "None of your tiles matches an end" : s.opener ? `Lead with the ${dominoName(s.opener)}` : "",
          options,
        }
      : s.phase === "scored"
        ? nextHandChoices(s.ready, seat, false, "Next round")
        : null,
    players: s.hands.map((tilesHeld, i) => ({
      // Once a round is scored the hands are on the table: what everyone was left with.
      line: [playing ? tiles(tilesHeld.length) : tilesHeld.length ? `left with ${round?.pips[i] ?? pipsOf(tilesHeld)}` : "out", `${s.scores[i]} points`].join(" · "),
      badge: playing ? (s.did[i] ?? (s.line.length === 0 && i === s.lead ? "Leads" : undefined)) : round?.winner === i && !over ? "Won the round" : s.phase === "scored" && s.ready[i] ? "Ready" : undefined,
    })),
    info: [
      `First to ${rules.target}`,
      ...(over ? [] : [rules.draw ? `Boneyard: ${tiles(s.boneyard.length)}` : "Block game: no drawing"]),
      ...(rules.fives && !over ? ["Ends that add up to a multiple of 5 score"] : []),
      ...(playing && ends ? [rules.fives ? `Ends: ${ends[0]} and ${ends[1]}, making ${dominoEndSum(s.line)}` : `Ends: ${ends[0]} and ${ends[1]}`] : []),
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      !playing && round
        ? {
            key: `round-${s.round}`,
            title: over ? overTitle(s) : round.winner === null ? `Round ${s.round} is blocked: nobody scores` : `${who(round.winner)} wins round ${s.round}`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Pips left", values: round.pips.map(String) },
              { label: "This round", values: s.scores.map((_, i) => (i === round.winner ? `+${round.points}` : "")), tone: "score" as const },
              { label: "Total", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: over ? { winners: winnersOf(s), title: overTitle(s) } : null,
  };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): DominoesRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<DominoesRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? drawDominoes;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), target: TARGETS.includes(Number(r.target)) ? Number(r.target) : 100, draw: r.draw !== false, fives: !!r.fives };
}

export const dominoes: BoardGame<DominoesRules, DominoesState, DominoesMove> = {
  id: "dominoes",
  name: "Dominoes",
  emoji: "⚅",
  category: "board",
  blurb: "Match the ends of the line and play out your tiles",
  tagline: "Lay your tiles end to end, matching the numbers. Play your last tile to win the round and score the pips left in everyone else's hand.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "target", label: "Play to", kind: "choice", options: TARGETS.map((t) => [t, `${t} points`]) },
    { key: "draw", label: "Draw from the boneyard", hint: "When you can't play, draw until you can. Off is the block game: you pass instead.", kind: "toggle" },
    { key: "fives", label: "All Fives", hint: "Whenever the two ends of the line add up to a multiple of five, whoever played scores that many.", kind: "toggle" },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "The 28 tiles of a double-six set are mixed face down. With two players everyone draws seven; with three or four, five. The rest is the boneyard.",
      "The first round is opened with the highest double anyone drew. After that, the winner of a round leads the next with any tile.",
      "In turn, lay a tile at either end of the line, with one of its numbers against the same number there.",
      r.draw ? "If none of your tiles matches, draw from the boneyard until one does. When the boneyard is empty, you pass." : "If none of your tiles matches, you pass: there is no drawing.",
      ...(r.fives ? ["All Fives: whenever the two ends of the line add up to a multiple of five, the player who made them so scores that many at once. A double at an end counts both its halves."] : []),
      `Play your last tile and you win the round, scoring the pips left in the other hands${r.fives ? ", to the nearest five" : ""}. If nobody can play, the lightest hand wins the round and scores the pips in the others less its own.`,
      `The first to ${r.target} points wins.`,
    ];
  },
  newGame: newDominoes,
  apply,
  view,
  bot,
  // Drawing and moving on are quick; choosing a tile takes longer the more there are to choose from.
  thinkingTime: (s, seat) => (s.phase !== "playing" ? 2000 : s.held !== null ? 500 : playable(s, seat).length ? thinkFor(playable(s, seat).length) : 700),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "dominoes",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
