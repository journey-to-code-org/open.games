// Mahjong Shanghai: the tile-matching solitaire. The tiles are stacked in a layout; a tile is free
// when nothing lies on top of it and it can slide out sideways (one of its two sides is open). Take
// two free tiles that match and they leave; clear every tile to win. Any flower goes with any flower
// and any season with any season; every other tile needs its twin.
//
// Every deal can be cleared: the layout is filled backwards, two free places at a time, so there is
// always a way through (it is the player's choices that can paint them into a corner, and a shuffle
// deals what is left again the same way). Alone it is a solitaire with undo. With two to four, every
// seat races on its own copy of the same deal; the first to clear the board wins, and if nobody
// can, the fewest tiles left does.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, nextRandom, shuffled, who, type BaseRules, type CardGame, type KitView, type Choices } from "./kit.js";
import { fullTileSet, matchKey, tileGlyph, tileName, type MahjongTile } from "./mahjongtiles.js";

// ---- Layouts -----------------------------------------------------------------------------------
// A place is { x, y, z } in half-tile units: a tile is two wide and two tall, so a tile sitting
// half a tile across the ones below it has an odd coordinate. z is the layer, from 0 on the table.

export type LayoutId = "starter" | "pyramid" | "turtle";
interface Place {
  x: number;
  y: number;
  z: number;
}
const span = (from: number, to: number) => Array.from({ length: (to - from) / 2 + 1 }, (_, i) => from + i * 2);
const block = (z: number, xs: number[], ys: number[]): Place[] => ys.flatMap((y) => xs.map((x) => ({ x, y, z })));

const PLACES: Record<LayoutId, () => Place[]> = {
  // Two layers, 52 tiles: a short game to learn on.
  starter: () => [...block(0, span(2, 20), span(0, 6)), ...block(1, span(6, 16), span(2, 4))],
  // Three layers, 104 tiles: a stepped pyramid.
  pyramid: () => [...block(0, span(2, 20), span(0, 10)), ...block(1, span(4, 18), span(2, 8)), ...block(2, span(6, 16), span(4, 6))],
  // The traditional turtle, 144 tiles: five layers, and a tile out on each side.
  turtle: () => [
    ...[0, 2, 4, 6, 8, 10, 12, 14].flatMap((y, row) => {
      const xs = [span(2, 24), span(6, 20), span(4, 22), span(2, 24), span(2, 24), span(4, 22), span(6, 20), span(2, 24)][row]!;
      return xs.map((x) => ({ x, y, z: 0 }));
    }),
    { x: 0, y: 7, z: 0 },
    { x: 26, y: 7, z: 0 },
    { x: 28, y: 7, z: 0 },
    ...block(1, span(8, 18), span(2, 12)),
    ...block(2, span(10, 16), span(4, 10)),
    ...block(3, [12, 14], [6, 8]),
    { x: 13, y: 7, z: 4 },
  ],
};

export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: "starter", name: "Starter (52 tiles)" },
  { id: "pyramid", name: "Pyramid (104 tiles)" },
  { id: "turtle", name: "Turtle (144 tiles)" },
];

interface Layout {
  places: Place[];
  /** The places that lie on top of this one. */
  covers: number[][];
  /** The places touching its left side, and its right side. */
  left: number[][];
  right: number[][];
  width: number;
  height: number;
  layers: number;
}

const layouts = new Map<LayoutId, Layout>();
function layoutOf(id: LayoutId): Layout {
  let l = layouts.get(id);
  if (l) return l;
  const places = PLACES[id]();
  const near = (a: Place, b: Place) => Math.abs(a.y - b.y) < 2;
  l = {
    places,
    covers: places.map((p) => places.flatMap((q, i) => (q.z === p.z + 1 && Math.abs(q.x - p.x) < 2 && near(p, q) ? [i] : []))),
    left: places.map((p) => places.flatMap((q, i) => (q.z === p.z && q.x === p.x - 2 && near(p, q) ? [i] : []))),
    right: places.map((p) => places.flatMap((q, i) => (q.z === p.z && q.x === p.x + 2 && near(p, q) ? [i] : []))),
    width: Math.max(...places.map((p) => p.x)) + 2,
    height: Math.max(...places.map((p) => p.y)) + 2,
    layers: Math.max(...places.map((p) => p.z)) + 1,
  };
  layouts.set(id, l);
  return l;
}

const isFreeAt = (l: Layout, here: (i: number) => boolean, i: number) => !l.covers[i]!.some(here) && !(l.left[i]!.some(here) && l.right[i]!.some(here));

// ---- The deal ----------------------------------------------------------------------------------

const SET = fullTileSet();
const keyOf = (index: number) => matchKey(SET[index]!);

/** Every tile in the set, paired off with one it matches: 72 pairs, in a fixed order. */
function allPairs(): [number, number][] {
  const groups = new Map<string, number[]>();
  SET.forEach((t, i) => groups.set(matchKey(t), [...(groups.get(matchKey(t)) ?? []), i]));
  const pairs: [number, number][] = [];
  for (const g of groups.values()) for (let i = 0; i + 1 < g.length; i += 2) pairs.push([g[i]!, g[i + 1]!]);
  return pairs;
}

/** Pairs up whatever tiles are left, in a fixed order. Each kind is always left in an even number. */
function pairUp(tiles: number[]): [number, number][] {
  const groups = new Map<string, number[]>();
  for (const t of [...tiles].sort((a, b) => a - b)) groups.set(keyOf(t), [...(groups.get(keyOf(t)) ?? []), t]);
  const pairs: [number, number][] = [];
  for (const g of groups.values()) for (let i = 0; i + 1 < g.length; i += 2) pairs.push([g[i]!, g[i + 1]!]);
  return pairs;
}

/**
 * Lay pairs onto places backwards: each pair goes on two places that are free once the earlier pairs
 * have gone, so taking them in the order they were laid always works. Null when it paints itself
 * into a corner (one free place left with tiles to go), and the caller tries again.
 */
function lay(l: Layout, places: number[], pairs: [number, number][], rand: () => number, order: [number, number][] = []): (number | null)[] | null {
  const left = new Set(places);
  const board: (number | null)[] = l.places.map(() => null);
  order.length = 0;
  for (const [a, b] of pairs) {
    const free = [...left].filter((i) => isFreeAt(l, (j) => left.has(j), i));
    if (free.length < 2) return null;
    const first = free.splice(Math.floor(rand() * free.length), 1)[0]!;
    const second = free[Math.floor(rand() * free.length)]!;
    board[first] = a;
    board[second] = b;
    order.push([first, second]);
    left.delete(first);
    left.delete(second);
  }
  return board;
}

function deal(l: Layout, places: number[], pairs: [number, number][], rand: () => number, order?: [number, number][]): (number | null)[] | null {
  for (let tries = 0; tries < 200; tries++) {
    const board = lay(l, places, shuffled(pairs, rand), rand, order);
    if (board) return board;
  }
  return null;
}

// ---- Rules and state ---------------------------------------------------------------------------

export interface ShanghaiRules extends BaseRules {
  layout: LayoutId;
  /** Times a seat may deal what is left again. */
  shuffles: number;
  /** Alone, a pair can be put back. */
  undo: boolean;
}

export const shanghaiTurtle: ShanghaiRules = { id: "turtle", name: "Turtle", layout: "turtle", shuffles: 3, undo: true };
export const shanghaiPyramid: ShanghaiRules = { id: "pyramid", name: "Pyramid", layout: "pyramid", shuffles: 3, undo: true };
export const shanghaiStarter: ShanghaiRules = { id: "starter", name: "Starter", layout: "starter", shuffles: 3, undo: true };
export const shanghaiRace: ShanghaiRules = { id: "race", name: "Race", layout: "turtle", shuffles: 1, undo: false };

interface Board {
  /** The tile (an index into the set) at each place, or null once it has gone. */
  tiles: (number | null)[];
  left: number;
  /** The place picked up and waiting for its match. */
  selected: number | null;
  shuffles: number;
  /** Pairs taken, most recent last (for undo): the two places and the two tiles. */
  history: { a: number; b: number; ta: number; tb: number }[];
  moves: number;
  /** Cleared the board, got stuck, or gave up. */
  done: boolean;
  cleared: boolean;
  /** When (the state's step) this seat last took a pair: the tie-break for a race. */
  lastAt: number;
}

export interface ShanghaiState {
  game: "mahjongshanghai";
  rules: ShanghaiRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "finished";
  boards: Board[];
  step: number;
  narration: string | null;
}

type Move = { type: "pick"; tile: number } | { type: "match"; a: number; b: number } | { type: "shuffle" } | { type: "undo" } | { type: "giveup" };

/** The tiles at each place for a seed, and the order of pairs they were laid in (which clears them). */
function build(rules: ShanghaiRules, s: { rng: number }) {
  const rand = nextRandom(s);
  const l = layoutOf(rules.layout);
  const all = l.places.map((_, i) => i);
  // A smaller layout uses some of the pairs, picked from the whole set.
  const pairs = shuffled(allPairs(), rand).slice(0, l.places.length / 2);
  const order: [number, number][] = [];
  const tiles = deal(l, all, pairs, rand, order) ?? lay(l, all, pairs, () => 0.5, order)!;
  return { tiles, order: [...order] };
}

/** A way to clear the deal this seed makes: the pairs of places to take, in order. For tests and hints. */
export const shanghaiSolution = (rules: ShanghaiRules, seed: number): [number, number][] => build(rules, { rng: seed }).order;

export function newShanghai(rules: ShanghaiRules, seats: number, seed: number): ShanghaiState {
  const s = { game: "mahjongshanghai", rules, seats, rng: seed, hand: 1, dealer: 0, phase: "playing", step: 0, narration: null } as unknown as ShanghaiState;
  const { tiles } = build(rules, s);
  s.boards = Array.from({ length: seats }, () => ({ tiles: [...tiles], left: tiles.length, selected: null, shuffles: rules.shuffles, history: [], moves: 0, done: false, cleared: false, lastAt: 0 }));
  s.narration = seats > 1 ? "Clear the board first." : null;
  return s;
}

const layoutFor = (s: ShanghaiState) => layoutOf(s.rules.layout);
const here = (b: Board) => (i: number) => b.tiles[i] !== null;
const freeOf = (s: ShanghaiState, b: Board): number[] => {
  const l = layoutFor(s);
  const present = here(b);
  return b.tiles.flatMap((t, i) => (t !== null && isFreeAt(l, present, i) ? [i] : []));
};

/** Every pair of free tiles that match. */
function matchesOf(s: ShanghaiState, b: Board): [number, number][] {
  const free = freeOf(s, b);
  const out: [number, number][] = [];
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) if (keyOf(b.tiles[free[i]!]!) === keyOf(b.tiles[free[j]!]!)) out.push([free[i]!, free[j]!]);
  return out;
}

/** A seat that has cleared the board, or can't go on, is finished. */
function settle(s: ShanghaiState, b: Board) {
  if (b.left === 0) {
    b.done = true;
    b.cleared = true;
  } else if (!b.done && b.shuffles === 0 && !matchesOf(s, b).length) b.done = true;
  if (s.boards.some((x) => x.cleared) || s.boards.every((x) => x.done)) {
    s.phase = "finished";
    for (const x of s.boards) x.done = true;
  }
}

function take(s: ShanghaiState, seat: number, b: Board, a: number, c: number) {
  const ta = b.tiles[a]!;
  const tb = b.tiles[c]!;
  b.history.push({ a, b: c, ta, tb });
  b.tiles[a] = null;
  b.tiles[c] = null;
  b.left -= 2;
  b.moves++;
  b.selected = null;
  s.step++;
  b.lastAt = s.step;
  const tile = SET[ta]!;
  s.narration = s.seats > 1 ? `${who(seat)} took a pair (${b.left} left).` : `Took a pair: ${tile.family === "flower" || tile.family === "season" ? `two ${tile.family}s` : tileName(tile)}.`;
}

function checkTile(b: Board, free: number[], i: unknown): number {
  if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= b.tiles.length || b.tiles[i] === null) throw new GameError("There's no tile there.");
  if (!free.includes(i)) throw new GameError("That tile is blocked: it needs nothing on top and one side open.");
  return i;
}

function apply(state: ShanghaiState, seat: number, move: Move): ShanghaiState {
  const s = clone(state);
  const b = s.boards[seat];
  if (s.phase !== "playing") throw new GameError("The game is over.");
  if (!b) throw new GameError("You're not at this table.");
  if (b.done) throw new GameError("You're finished here. Waiting for the others.");
  const m = move as Record<string, unknown>;
  if (m.type === "pick") {
    const free = freeOf(s, b);
    const i = checkTile(b, free, m.tile);
    if (b.selected === null || !free.includes(b.selected)) b.selected = i;
    else if (b.selected === i) b.selected = null;
    else if (keyOf(b.tiles[b.selected]!) === keyOf(b.tiles[i]!)) take(s, seat, b, b.selected, i);
    else b.selected = i;
    s.step++;
  } else if (m.type === "match") {
    const free = freeOf(s, b);
    const a = checkTile(b, free, m.a);
    const c = checkTile(b, free, m.b);
    if (a === c) throw new GameError("Pick two different tiles.");
    if (keyOf(b.tiles[a]!) !== keyOf(b.tiles[c]!)) throw new GameError("Those two don't match.");
    take(s, seat, b, a, c);
  } else if (m.type === "shuffle") {
    if (b.shuffles <= 0) throw new GameError("No shuffles left.");
    const l = layoutFor(s);
    const places = b.tiles.flatMap((t, i) => (t !== null ? [i] : []));
    const rand = nextRandom(s);
    const dealt = deal(l, places, pairUp(places.map((i) => b.tiles[i]!)), rand);
    if (dealt) b.tiles = dealt;
    b.shuffles--;
    b.selected = null;
    b.history = [];
    s.step++;
    s.narration = s.seats > 1 ? `${who(seat)} shuffled.` : "Shuffled what's left.";
  } else if (m.type === "undo") {
    if (s.seats !== 1 || !s.rules.undo) throw new GameError("There's no undo here.");
    const last = b.history.pop();
    if (!last) throw new GameError("Nothing to take back.");
    b.tiles[last.a] = last.ta;
    b.tiles[last.b] = last.tb;
    b.left += 2;
    b.selected = null;
    s.step++;
    s.narration = "Put the pair back.";
  } else if (m.type === "giveup") {
    b.done = true;
    s.narration = s.seats > 1 ? `${who(seat)} gave up.` : "You gave up.";
  } else throw new GameError("That's not a move in Mahjong Shanghai.");
  settle(s, b);
  return s;
}

/** Seats best first: the board cleared, then the fewest tiles left, then who took their last pair first. */
function ranking(s: ShanghaiState): number[] {
  return s.boards.map((_, i) => i).sort((a, b) => Number(s.boards[b]!.cleared) - Number(s.boards[a]!.cleared) || s.boards[a]!.left - s.boards[b]!.left || s.boards[a]!.lastAt - s.boards[b]!.lastAt || a - b);
}

function winnersOf(s: ShanghaiState): number[] {
  if (s.seats === 1) return s.boards[0]!.cleared ? [0] : [];
  return [ranking(s)[0]!];
}

function view(s: ShanghaiState, seat: number): KitView {
  const b = s.boards[seat]!;
  const l = layoutFor(s);
  const over = s.phase === "finished";
  const free = over || b.done ? [] : freeOf(s, b);
  const choices: Choices | null =
    over || b.done
      ? null
      : {
          prompt: "",
          options: [
            ...(b.shuffles > 0 ? [{ label: `Shuffle (${b.shuffles})`, move: { type: "shuffle" }, hint: "Deal the tiles that are left again. There is always a way through." }] : []),
            ...(s.seats === 1 && s.rules.undo && b.history.length ? [{ label: "Undo", move: { type: "undo" } }] : []),
            { label: "Give up", move: { type: "giveup" }, confirm: "Give up this game?" },
          ],
          layout: "row",
        };
  const order = ranking(s);
  const winners = winnersOf(s);
  const total = l.places.length;
  return {
    game: "mahjongshanghai",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    dealer: 0,
    hand: [],
    handHidden: "none",
    tap: null,
    pick: null,
    choices,
    players: s.boards.map((x) => ({
      cards: 0,
      line: x.cleared ? "Cleared the board" : `${x.left} tile${x.left === 1 ? "" : "s"} left${x.done ? " · finished" : ""}`,
      badge: x.cleared ? "Cleared" : x.done && !over ? "Finished" : undefined,
    })),
    center: {
      kind: "tiles",
      width: l.width,
      height: l.height,
      layers: l.layers,
      tiles: b.tiles.flatMap((t, i) => (t === null ? [] : [{ id: i, x: l.places[i]!.x, y: l.places[i]!.y, z: l.places[i]!.z, tile: SET[t]!, glyph: tileGlyph(SET[t]!), name: tileName(SET[t]!), free: free.includes(i), selected: b.selected === i }])),
      tap: free.length ? { type: "pick", tiles: free } : null,
      matches: free.length ? matchesOf(s, b).length : 0,
    },
    melds: [],
    info: [LAYOUTS.find((x) => x.id === s.rules.layout)!.name, `${b.moves} pair${b.moves === 1 ? "" : "s"} taken`, ...(b.shuffles > 0 ? [`${b.shuffles} shuffle${b.shuffles === 1 ? "" : "s"} left`] : [])],
    narration: s.narration,
    scores: s.boards.map((x, i) => ({ seats: [i], value: total - x.left })),
    result: null,
    over: over
      ? {
          winners,
          title: s.seats === 1 ? (b.cleared ? `Cleared the board in ${b.moves} pairs!` : `${b.left} tiles left`) : `${who(order[0]!)} ${s.boards[order[0]!]!.cleared ? "cleared the board first!" : `finished with the fewest tiles left (${s.boards[order[0]!]!.left})`}`,
        }
      : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

/** How many places a pair would free up, so a bot digs where it opens most. */
function opens(s: ShanghaiState, b: Board, a: number, c: number): number {
  const l = layoutFor(s);
  const after = (i: number) => b.tiles[i] !== null && i !== a && i !== c;
  const before = new Set(freeOf(s, b));
  let n = 0;
  b.tiles.forEach((t, i) => {
    if (t !== null && i !== a && i !== c && !before.has(i) && isFreeAt(l, after, i)) n++;
  });
  return n;
}

function bot(s: ShanghaiState, seat: number, style: PlayStyle, rand: () => number = Math.random): Move | null {
  const b = s.boards[seat];
  if (!b || b.done || s.phase !== "playing") return null;
  const matches = matchesOf(s, b);
  if (!matches.length) return b.shuffles > 0 ? { type: "shuffle" } : { type: "giveup" };
  const l = layoutFor(s);
  const careless = rand() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
  if (careless) {
    const [a, c] = matches[Math.floor(rand() * matches.length)]!;
    return { type: "match", a, b: c };
  }
  // Prefer the pair that opens the most, and the higher layer when it's even.
  let best = matches[0]!;
  let bestScore = -1;
  for (const [a, c] of matches) {
    const score = opens(s, b, a, c) * 10 + l.places[a]!.z + l.places[c]!.z;
    if (score > bestScore) {
      bestScore = score;
      best = [a, c];
    }
  }
  return { type: "match", a: best[0], b: best[1] };
}

export const mahjongShanghai: CardGame<ShanghaiRules, ShanghaiState, Move> = {
  id: "mahjongshanghai",
  name: "Mahjong Shanghai",
  emoji: "🀄",
  category: "cards",
  blurb: "Match the free tiles and clear the stack",
  tagline: "Take pairs of free tiles off the stack. Alone, or racing the family on the same deal.",
  seats: { min: 1, max: 4, default: 1 },
  teams: false,
  presets: [shanghaiTurtle, shanghaiPyramid, shanghaiStarter, shanghaiRace],
  fields: [
    { key: "layout", label: "Layout", hint: "How the tiles are stacked.", kind: "choice", options: LAYOUTS.map((x) => [x.id, x.name] as [string, string]) },
    { key: "shuffles", label: "Shuffles", hint: "Times you can deal the tiles that are left again. A shuffle always leaves a way through.", kind: "number", min: 0, max: 9 },
    { key: "undo", label: "Undo", hint: "Playing alone, put the last pair back.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ShanghaiRules>;
    const base = [shanghaiTurtle, shanghaiPyramid, shanghaiStarter, shanghaiRace].find((p) => p.id === given.id) ?? shanghaiTurtle;
    const layout = LAYOUTS.some((x) => x.id === given.layout) ? given.layout! : base.layout;
    const shuffles = given.shuffles === undefined ? base.shuffles : Math.max(0, Math.min(9, Math.round(Number(given.shuffles) || 0)));
    return { ...base, ...given, layout, shuffles, undo: given.undo === undefined ? base.undo : !!given.undo, id: given.id ?? base.id, name: given.name ?? base.name };
  },
  validate: (r) => [...(LAYOUTS.some((x) => x.id === r.layout) ? [] : ["Pick one of the layouts."]), ...(r.shuffles >= 0 && r.shuffles <= 9 ? [] : ["Shuffles go from 0 to 9."])],
  describe(r) {
    return [
      `The tiles are stacked in the ${LAYOUTS.find((x) => x.id === r.layout)!.name.replace(/ \(.*/, "")} layout. A tile is free when nothing is on top of it and its left or its right side is open.`,
      "Tap a free tile, then a free tile that matches it, and both leave. Any flower goes with any flower and any season with any season; every other tile needs its twin.",
      "Clear every tile to win. Every deal can be cleared, but a pair taken early can get in the way later.",
      r.shuffles ? `${r.shuffles} shuffle${r.shuffles === 1 ? "" : "s"}: deal the tiles that are left again, always leaving a way through.` : "No shuffles: when there is no pair left, the game is over.",
      "With two to four players everyone races on their own copy of the same deal: first to clear it wins, or the fewest tiles left. Alone, " + (r.undo ? "Undo puts the last pair back." : "there is no undo."),
    ];
  },
  newGame: newShanghai,
  apply,
  view,
  bot,
  thinkingTime: () => 500,
  summary(s) {
    const over = s.phase === "finished";
    const order = ranking(s);
    return {
      game: "mahjongshanghai",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.seats === 1 ? `${s.boards[0]!.left} tiles left` : s.boards.map((b, i) => `${who(i)} ${b.left}`).join(" · "),
      order: over ? order : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
