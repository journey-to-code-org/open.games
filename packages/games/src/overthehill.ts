// Over the Hill: tanks on a strip of hills, lobbing shells at each other a turn at a time. For two
// to four. Everyone has the same number of shells, and the game is over when the last one has
// landed: whoever did the most damage wins. Or, played as "Last tank standing", every tank has
// armour, a tank with none left is out, and the last one in wins.
//
// A turn is one shell: choose it, set the barrel's angle and the power, and fire. The shell flies
// (field.ts) and what it does to the land stays done: a hole is a hole for the rest of the game,
// and a tank whose ground is blown away drops to what is left. A hit scores what it took off the
// other tank; a shell that catches the tank that fired it costs that tank the points instead.
//
// The shells are chosen first: they are laid out, and the players take one each in turn until all
// are taken ("Pick your shells"). Or every player is simply handed the same bag. Before firing, a
// tank may drive a little way along the land, a few times a game.
//
// Replaying a game from its log gives the same game while FIELD_VERSION and the shells below are
// unchanged: a shell's numbers are part of the rules, so changing one changes old games.
import type { PlayStyle } from "@journey-to-code/rules";
import { FIELD_VERSION, PIECE_UP, flyField, landAt, type FieldGame, type FieldLand, type FieldLast, type FieldPiece, type FieldShell, type FieldStock, type FieldView, type FieldWorld, type FireMove } from "./field.js";
import { careless, clone, GameError, nextRandom, rankSeats, thinkFor, who, type BaseRules, type RoundResult, type RuleField, type ThinkBudget } from "./table.js";

// ---- The field ----------------------------------------------------------------------------------

const WIDE = 2000;
const HIGH = 1250;
const STEP = 10;
const COLUMNS = WIDE / STEP + 1;
/** How far a tank drives in one move, and how near to another it may come. */
const DRIVE = 120;
const APART = 160;
const EDGE = 60;
const MIN_POWER = 1;
const MAX_POWER = 100;
/** What a tank can take before it is out, in a game played to the last tank. */
const ARMOUR = 150;
/** Armour as a view shows it: what is left, in hundredths of what it started with. */
const armourLeft = (tank: Tank) => Math.ceil((tank.armour * 100) / ARMOUR);

/** Which bags a shell goes into: the plain ones, the loud ones, the odd ones, and the ones that move earth. */
export type HillShellKind = "classic" | "bang" | "trick" | "earth";

/** Every shell in the game. `often` is how many of each go into the mix the players' shells are drawn from. */
export const HILL_SHELLS: (FieldShell & { often: number; kind: HillShellKind })[] = [
  // The plain ones.
  { id: "shot", name: "Plain Shot", blurb: "An honest shell. Goes where you send it.", blast: 70, damage: 30, often: 6, kind: "classic" },
  { id: "big", name: "Big Shot", blurb: "The same, with a wider bang.", blast: 115, damage: 44, often: 4, kind: "classic" },
  { id: "three", name: "Three of a Kind", blurb: "Three small shells, fanned out.", blast: 52, damage: 20, count: 3, spread: 4, often: 3, kind: "classic" },
  { id: "five", name: "Full House", blurb: "Five little shells in a wide fan.", blast: 44, damage: 15, count: 5, spread: 5, often: 2, kind: "classic" },
  { id: "sniper", name: "Needle", blurb: "A tiny blast that hurts. Has to land right on them.", blast: 26, damage: 62, often: 3, kind: "classic" },
  { id: "peas", name: "Peashooter", blurb: "Seven peas, close together. Each one stings.", blast: 26, damage: 9, count: 7, spread: 1, often: 2, kind: "classic" },
  { id: "tracer", name: "Tracer", blurb: "No bang at all. Fire it to find your range.", blast: 8, damage: 0, often: 1, kind: "classic" },
  // The loud ones.
  { id: "whopper", name: "Whopper", blurb: "The big one. Stand well back.", blast: 175, damage: 58, often: 2, kind: "bang" },
  { id: "slam", name: "Grand Slam", blurb: "Bigger than the big one. Stand further back.", blast: 240, damage: 72, often: 1, kind: "bang" },
  { id: "cluster", name: "Popcorn", blurb: "Bursts where it lands and throws out five more.", blast: 40, damage: 10, split: { at: "land", into: 5, blast: 46, damage: 14 }, often: 3, kind: "bang" },
  { id: "volcano", name: "Volcano", blurb: "Erupts where it lands: nine go high and wide.", blast: 60, damage: 14, split: { at: "land", into: 9, blast: 44, damage: 12, fan: 190 }, often: 2, kind: "bang" },
  { id: "hail", name: "Hailstorm", blurb: "Breaks into five at the top of its flight.", blast: 46, damage: 14, split: { at: "top", into: 5, blast: 46, damage: 15 }, often: 3, kind: "bang" },
  { id: "carpet", name: "Carpet", blurb: "Breaks into eight at the top, spread well out.", blast: 40, damage: 12, split: { at: "top", into: 8, blast: 42, damage: 12, fan: 260 }, often: 2, kind: "bang" },
  { id: "napalm", name: "Hot Sauce", blurb: "Bursts into flames that run downhill. No hole.", blast: 50, damage: 12, scorch: true, split: { at: "land", into: 5, blast: 40, damage: 7, roll: true, scorch: true, fan: 60 }, often: 2, kind: "bang" },
  { id: "march", name: "Marching Band", blurb: "Bursts, then five more march on the way it was going.", blast: 60, damage: 22, walk: { steps: 5, gap: 70, blast: 52, damage: 16 }, often: 2, kind: "bang" },
  { id: "fireworks", name: "Fireworks", blurb: "Breaks into six at the top, and those skip.", blast: 40, damage: 12, split: { at: "top", into: 6, blast: 40, damage: 12, bounces: 1, fan: 150 }, often: 2, kind: "bang" },
  // The odd ones.
  { id: "skipper", name: "Skipper", blurb: "Skips off the ground twice before it bursts.", blast: 75, damage: 34, bounces: 2, often: 3, kind: "trick" },
  { id: "pinball", name: "Pinball", blurb: "Skips five times. Where it ends up is anyone's guess.", blast: 82, damage: 40, bounces: 5, often: 1, kind: "trick" },
  { id: "roller", name: "Roller", blurb: "Rolls downhill from where it lands until something stops it.", blast: 80, damage: 36, roll: true, often: 3, kind: "trick" },
  { id: "marbles", name: "Bag of Marbles", blurb: "Bursts and spills five that roll downhill.", blast: 36, damage: 8, split: { at: "land", into: 5, blast: 44, damage: 13, roll: true, fan: 70 }, often: 2, kind: "trick" },
  { id: "seeker", name: "Homing Pigeon", blurb: "Leans toward the nearest tank as it flies.", blast: 64, damage: 30, seek: 100, often: 2, kind: "trick" },
  { id: "laser", name: "Ruler", blurb: "Flies dead straight and bores through what is in the way.", blast: 40, damage: 40, weight: 0, dig: 420, often: 2, kind: "trick" },
  { id: "feather", name: "Feather", blurb: "Hardly falls at all. Sails a very long way.", blast: 70, damage: 32, weight: 35, often: 1, kind: "trick" },
  { id: "anvil", name: "Anvil", blurb: "Falls like one. Fire it high and hard.", blast: 90, damage: 54, weight: 240, often: 1, kind: "trick" },
  { id: "jump", name: "Jump Jets", blurb: "No bang: your tank is set down where it lands.", blast: 10, damage: 0, carry: true, often: 1, kind: "trick" },
  // The ones that move earth.
  { id: "digger", name: "Mole", blurb: "Bores on through the earth before it bursts.", blast: 62, damage: 32, dig: 260, often: 3, kind: "earth" },
  { id: "buster", name: "Bunker Buster", blurb: "Bores deep, then goes off like a Big Shot.", blast: 120, damage: 46, dig: 160, weight: 150, often: 2, kind: "earth" },
  { id: "pit", name: "Excavator", blurb: "A huge hole and a small hurt.", blast: 170, damage: 14, often: 2, kind: "earth" },
  { id: "dirt", name: "Dirt Heap", blurb: "No bang: a hill of earth where it lands.", blast: 110, damage: 0, dirt: true, often: 2, kind: "earth" },
  { id: "wall", name: "Garden Wall", blurb: "No bang: a tall, narrow wall of earth.", blast: 120, damage: 0, dirt: true, tall: true, often: 2, kind: "earth" },
  { id: "slide", name: "Landslide", blurb: "Breaks into four loads of earth at the top.", blast: 30, damage: 0, dirt: true, split: { at: "top", into: 4, blast: 70, damage: 0, dirt: true, fan: 130 }, often: 1, kind: "earth" },
];
const SHELLS: FieldShell[] = HILL_SHELLS.map(({ often: _often, kind: _kind, ...shell }) => shell);
const shellOf = (id: unknown) => SHELLS.find((s) => s.id === id);
const TONES = ["red", "blue", "green", "gold"] as const;

// ---- Rules and state ---------------------------------------------------------------------------

export type HillLand = "any" | "hills" | "valley" | "peak" | "flats" | "canyon" | "steps";
type Shape = Exclude<HillLand, "any">;
const LANDS: [HillLand, string][] = [
  ["any", "Any"],
  ["hills", "Rolling hills"],
  ["valley", "A valley"],
  ["peak", "A mountain between"],
  ["canyon", "A canyon between"],
  ["steps", "Terraces"],
  ["flats", "Flat country"],
];
const SHAPES: Shape[] = ["hills", "valley", "peak", "canyon", "steps", "flats"];
const LAND_NAMES: Record<Shape, string> = { hills: "Rolling hills", valley: "The valley", peak: "The mountain", flats: "Flat country", canyon: "The canyon", steps: "The terraces" };

export type HillScene = "any" | "meadow" | "desert" | "snow" | "dusk" | "moon";
type Place = Exclude<HillScene, "any">;
const SCENES: [HillScene, string][] = [
  ["any", "Any (but the moon)"],
  ["meadow", "A meadow at noon"],
  ["dusk", "The hills at dusk"],
  ["desert", "The desert"],
  ["snow", "The snow"],
  ["moon", "The moon (things fall slowly)"],
];
const EARTHLY: Place[] = ["meadow", "dusk", "desert", "snow"];
/** How hard things fall, in hundredths of the usual. */
const GRAVITY: Record<Place, number> = { meadow: 100, dusk: 100, desert: 100, snow: 100, moon: 45 };

export type HillWind = "none" | "breeze" | "gale";
const WINDS: [HillWind, string][] = [
  ["none", "None"],
  ["breeze", "A breeze"],
  ["gale", "A gale"],
];
const WIND_MOST: Record<HillWind, number> = { none: 0, breeze: 5, gale: 10 };

export type HillMix = "all" | "classic" | "bangs" | "tricks" | "earth";
const MIXES: [HillMix, string][] = [
  ["all", "Everything"],
  ["classic", "The plain ones"],
  ["bangs", "Big bangs"],
  ["tricks", "Odd ones"],
  ["earth", "Earth movers"],
];
const MIX_KIND: Record<Exclude<HillMix, "all">, HillShellKind> = { classic: "classic", bangs: "bang", tricks: "trick", earth: "earth" };

export interface OverTheHillRules extends BaseRules {
  /** How many shells each player fires. */
  shells: number;
  /** Which shells are in the mix. */
  mix: HillMix;
  /** The players choose their shells in turn from the ones laid out. Off: everyone is handed the same bag. */
  draft: boolean;
  /** Most damage done wins, or the last tank with any armour does. */
  win: "points" | "knockout";
  /** How many times in a game a tank may drive along the land. */
  moves: number;
  /** A wind that changes with every shot. */
  wind: HillWind;
  land: HillLand;
  scene: HillScene;
}

const base = { shells: 10, mix: "all", draft: false, win: "points", moves: 4, wind: "none", land: "any", scene: "any" } as const;
export const hillStandard: OverTheHillRules = { id: "standard", name: "Ten shells", ...base };
export const hillDraft: OverTheHillRules = { id: "draft", name: "Pick your shells", ...base, draft: true };
export const hillQuick: OverTheHillRules = { id: "quick", name: "Quick: five shells", ...base, shells: 5, moves: 2 };
export const hillKnockout: OverTheHillRules = { id: "knockout", name: "Last tank standing", ...base, shells: 15, win: "knockout" };
export const hillBangs: OverTheHillRules = { id: "bangs", name: "Big bangs", ...base, mix: "bangs" };
export const hillWindy: OverTheHillRules = { id: "windy", name: "A windy day", ...base, wind: "breeze" };
export const hillMoon: OverTheHillRules = { id: "moon", name: "Moon shot", ...base, scene: "moon" };
const PRESETS = [hillStandard, hillDraft, hillQuick, hillKnockout, hillBangs, hillWindy, hillMoon];
const SHELL_COUNTS = [5, 8, 10, 15, 20];

interface Tank {
  x: number;
  /** The ground under it. */
  y: number;
  /** Where the barrel and the power were left. */
  angle: number;
  power: number;
  /** Moves left. */
  moves: number;
  /** What it can still take, in a game played to the last tank. */
  armour: number;
  out: boolean;
}

export interface OverTheHillState {
  game: "overthehill";
  rules: OverTheHillRules;
  seats: number;
  rng: number;
  hand: 1;
  dealer: 0;
  phase: "draft" | "playing" | "finished";
  turn: number;
  /** Which land and which place this is, once "any" has been settled. */
  shape: Shape;
  scene: Place;
  land: number[];
  wind: number;
  tanks: Tank[];
  /** What each seat has left to fire: how many of each shell, by id. */
  bags: Record<string, number>[];
  /** The shells still on the table to be chosen, while they are being chosen. */
  pool: Record<string, number> | null;
  points: number[];
  /** Each seat's best single shot. */
  best: number[];
  /** Shots in the whole game: each is animated once. */
  shots: number;
  last: FieldLast | null;
  winners: number[] | null;
  narration: string | null;
  over: string | null;
}

export type OverTheHillMove = FireMove | { type: "pick"; shell: string } | { type: "move"; way: -1 | 1 };

const everyone = (seats: number) => Array.from({ length: seats }, (_, i) => i);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const tankId = (seat: number) => `tank${seat}`;
const seatOf = (id: string) => Number(id.slice(4));
const count = (bag: Record<string, number>) => Object.values(bag).reduce((a, b) => a + b, 0);
/** A bag as a list, in the order the shells are listed above. */
const stock = (bag: Record<string, number>): FieldStock[] => SHELLS.filter((s) => (bag[s.id] ?? 0) > 0).map((s) => ({ shell: s.id, left: bag[s.id]! }));
const landOf = (s: Pick<OverTheHillState, "land">): FieldLand => ({ width: WIDE, step: STEP, heights: s.land });
/** The tanks still in the game, as a flight sees them. */
const piecesOf = (s: Pick<OverTheHillState, "tanks">): FieldPiece[] => s.tanks.flatMap((t, i) => (t.out ? [] : [{ id: tankId(i), x: t.x, y: t.y }]));
const worldOf = (s: OverTheHillState): FieldWorld => ({ land: landOf(s), pieces: piecesOf(s), wind: s.wind, gravity: GRAVITY[s.scene] });

/**
 * The land for a seed: a base shape with three sizes of bump laid over it, each a row of random
 * heights joined by a smooth curve. Only arithmetic that every engine does alike.
 */
export function hillLand(shape: Shape, rand: () => number): number[] {
  const rough = shape === "flats" ? 0.22 : shape === "peak" || shape === "canyon" ? 0.6 : shape === "steps" ? 0.3 : 1;
  const layers = [
    { every: 50, tall: 210 },
    { every: 20, tall: 90 },
    { every: 8, tall: 28 },
  ].map((layer) => ({ ...layer, at: Array.from({ length: Math.ceil(COLUMNS / layer.every) + 2 }, () => rand() - 0.5) }));
  // Terraces: a handful of levels, each a random height, with short slopes between.
  const levels = Array.from({ length: 7 }, () => 220 + Math.floor(rand() * 5) * 110);
  const heights: number[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const t = (2 * i) / (COLUMNS - 1) - 1;
    const bell = (1 - t * t) * (1 - t * t);
    let h = 390;
    if (shape === "valley") h = 250 + 350 * t * t;
    else if (shape === "peak") h = 250 + 460 * bell;
    else if (shape === "canyon") h = 620 - 430 * bell * bell;
    else if (shape === "flats") h = 350;
    else if (shape === "steps") {
      const at = (i / (COLUMNS - 1)) * (levels.length - 1);
      const k = Math.min(levels.length - 2, Math.floor(at));
      const f = Math.min(1, Math.max(0, (at - k - 0.35) / 0.3));
      h = levels[k]! + (levels[k + 1]! - levels[k]!) * f * f * (3 - 2 * f);
    }
    for (const layer of layers) {
      const k = Math.floor(i / layer.every);
      const f = (i - k * layer.every) / layer.every;
      const ease = f * f * (3 - 2 * f);
      h += (layer.at[k]! + (layer.at[k + 1]! - layer.at[k]!) * ease) * 2 * layer.tall * rough;
    }
    heights.push(Math.max(120, Math.min(860, Math.round(h))));
  }
  return heights;
}

/** Level a little ground under a tank, so it starts on a footing. */
function pad(heights: number[], x: number) {
  const mid = Math.round(x / STEP);
  const level = heights[mid]!;
  for (let i = Math.max(0, mid - 4); i <= Math.min(COLUMNS - 1, mid + 4); i++) heights[i] = level;
}

/** A bag of `n` shells drawn from the mix: always some plain shots, so nobody is left with only oddities. */
function drawShells(n: number, mix: HillMix, rand: () => number): Record<string, number> {
  const from = HILL_SHELLS.filter((s) => mix === "all" || s.kind === MIX_KIND[mix]);
  const all = from.flatMap((s) => Array<string>(s.often).fill(s.id));
  const bag: Record<string, number> = {};
  const plain = Math.max(1, Math.round(n / 5));
  for (let i = 0; i < n; i++) {
    const id = i < plain ? "shot" : all[Math.floor(rand() * all.length)]!;
    bag[id] = (bag[id] ?? 0) + 1;
  }
  return bag;
}

export function newOverTheHill(rules: OverTheHillRules, seats: number, seed: number): OverTheHillState {
  const carry = { rng: seed };
  const rand = nextRandom(carry);
  const shape = rules.land === "any" ? SHAPES[Math.floor(rand() * SHAPES.length)]! : rules.land;
  const scene = rules.scene === "any" ? EARTHLY[Math.floor(rand() * EARTHLY.length)]! : rules.scene;
  const land = hillLand(shape, rand);
  // The tanks are spread across the field, each a little off its mark.
  const tanks: Tank[] = everyone(seats).map((i) => {
    const mark = seats === 1 ? WIDE / 2 : WIDE * 0.12 + (WIDE * 0.76 * i) / (seats - 1);
    const x = Math.round((mark + (rand() - 0.5) * WIDE * (seats > 2 ? 0.06 : 0.1)) / STEP) * STEP;
    pad(land, x);
    return { x, y: land[x / STEP]!, angle: x < WIDE / 2 ? 60 : 120, power: 60, moves: rules.moves, armour: ARMOUR, out: false };
  });
  const first = Math.floor(rand() * seats);
  const bag = drawShells(rules.shells, rules.mix, rand);
  const pool = rules.draft ? everyone(seats).reduce<Record<string, number>>((all) => {
    for (const [id, n] of Object.entries(drawShells(rules.shells, rules.mix, rand))) all[id] = (all[id] ?? 0) + n;
    return all;
  }, {}) : null;
  const s: OverTheHillState = {
    game: "overthehill",
    rules,
    seats,
    rng: carry.rng,
    hand: 1,
    dealer: 0,
    phase: rules.draft ? "draft" : "playing",
    turn: first,
    shape,
    scene,
    land,
    wind: 0,
    tanks,
    bags: everyone(seats).map(() => (rules.draft ? {} : { ...bag })),
    pool,
    points: Array<number>(seats).fill(0),
    best: Array<number>(seats).fill(0),
    shots: 0,
    last: null,
    winners: null,
    narration: null,
    over: null,
  };
  s.wind = newWind(s);
  s.narration = rules.draft ? `${who(first)} to choose first.` : `${who(first)} to fire first.`;
  return s;
}

function newWind(s: OverTheHillState): number {
  const most = WIND_MOST[s.rules.wind];
  return most ? Math.floor(nextRandom(s)() * (2 * most + 1)) - most : 0;
}

/** Which ways a tank may drive: not off the field, and not up against another tank. */
function waysOpen(s: OverTheHillState, seat: number): (-1 | 1)[] {
  const tank = s.tanks[seat]!;
  if (tank.moves <= 0) return [];
  return ([-1, 1] as const).filter((way) => {
    const x = tank.x + way * DRIVE;
    return x >= EDGE && x <= WIDE - EDGE && s.tanks.every((other, i) => i === seat || other.out || Math.abs(other.x - x) >= APART);
  });
}

function finish(s: OverTheHillState, said: string) {
  const knockout = s.rules.win === "knockout";
  const standing = everyone(s.seats).filter((i) => !s.tanks[i]!.out);
  // To the last tank: whoever is left, and of several left, whoever has most armour. Else (and
  // when nobody is left at all) the most points.
  const field = knockout && standing.length ? standing : everyone(s.seats);
  const measure = (i: number) => (knockout && standing.length ? s.tanks[i]!.armour * 10000 + s.points[i]! : s.points[i]!);
  const top = Math.max(...field.map(measure));
  s.winners = field.filter((i) => measure(i) === top);
  s.phase = "finished";
  const tied = s.winners.length > 1;
  const first = s.winners[0]!;
  if (knockout && standing.length === 1) s.over = `${who(first)} is the last tank standing!`;
  else if (knockout && standing.length) s.over = tied ? "All square: nobody could finish it." : `${who(first)} wins with the most armour left!`;
  else s.over = tied ? `All square at ${s.points[first]}.` : `${who(first)} wins with ${s.points[first]}!`;
  s.narration = `${said} ${s.over}`;
}

function apply(state: OverTheHillState, seat: number, move: OverTheHillMove): OverTheHillState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (state.phase === "finished") throw new GameError("This game is over.");
  if (move?.type !== "pick" && move?.type !== "fire" && move?.type !== "move") throw new GameError("That's not a move in Over the Hill.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");

  if (move.type === "pick") {
    if (state.phase !== "draft" || !state.pool) throw new GameError("The shells have all been chosen.");
    const shell = shellOf(move.shell);
    if (!shell || !(state.pool[shell.id]! > 0)) throw new GameError("That shell has gone.");
    const s = clone(state);
    s.pool![shell.id]! -= 1;
    s.bags[seat]![shell.id] = (s.bags[seat]![shell.id] ?? 0) + 1;
    s.turn = (seat + 1) % s.seats;
    if (count(s.pool!) === 0) {
      s.pool = null;
      s.phase = "playing";
      s.narration = `${who(seat)} takes the last one, a ${shell.name}. ${who(s.turn)} to fire first.`;
    } else s.narration = `${who(seat)} takes a ${shell.name}.`;
    return s;
  }
  if (state.phase !== "playing") throw new GameError("Choose your shells first.");

  if (move.type === "move") {
    if (move.way !== -1 && move.way !== 1) throw new GameError("Drive left or right.");
    if (state.tanks[seat]!.moves <= 0) throw new GameError("You have no moves left.");
    if (!waysOpen(state, seat).includes(move.way)) throw new GameError("There's no room that way.");
    const s = clone(state);
    const tank = s.tanks[seat]!;
    tank.x += move.way * DRIVE;
    tank.y = Math.round(landAt(landOf(s), tank.x));
    tank.moves -= 1;
    s.narration = `${who(seat)} moves ${move.way < 0 ? "left" : "right"}.`;
    return s;
  }

  const shell = shellOf(move.shell);
  if (!shell || !(state.bags[seat]![shell.id]! > 0)) throw new GameError("You have none of those left.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle > 180) throw new GameError("Aim somewhere between flat left and flat right.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a shot: too soft or too hard.");
  const s = clone(state);
  const world = worldOf(s);
  const from = { land: s.land, pieces: world.pieces, wind: s.wind };
  const flight = flyField(world, { piece: tankId(seat), shell, angle: move.angle, power: move.power });
  s.shots += 1;
  s.bags[seat]![shell.id]! -= 1;
  s.land = flight.land;
  // Jump Jets may have set the tank down somewhere new; every tank, wrecks too, is on what ground is left.
  for (const p of flight.pieces) s.tanks[seatOf(p.id)]!.x = p.x;
  for (const tank of s.tanks) tank.y = Math.round(landAt(landOf(s), tank.x));
  s.tanks[seat]!.angle = move.angle;
  s.tanks[seat]!.power = move.power;
  const hits = everyone(s.seats)
    .map((i) => ({ piece: tankId(i), damage: flight.damage[tankId(i)] ?? 0 }))
    .filter((h) => h.damage > 0);
  s.last = { n: s.shots, seat, piece: tankId(seat), shell: shell.id, angle: move.angle, power: move.power, from, rest: flight.pieces, hits, version: FIELD_VERSION };

  // A hit on someone else scores what it took; one on yourself costs you that, down to nothing.
  const own = flight.damage[tankId(seat)] ?? 0;
  const scored = hits.filter((h) => h.piece !== tankId(seat)).reduce((sum, h) => sum + h.damage, 0);
  s.points[seat] = Math.max(0, s.points[seat]! + scored - own);
  s.best[seat] = Math.max(s.best[seat]!, scored);
  const me = who(seat);
  const struck = everyone(s.seats).filter((i) => i !== seat && (flight.damage[tankId(i)] ?? 0) > 0);
  const say: string[] = [];
  if (struck.length) say.push(`${me}'s ${shell.name} ${struck.map((i) => `hits ${who(i)} for ${flight.damage[tankId(i)]}`).join(" and ")}.`);
  else if (shell.carry) say.push(`${me}'s ${shell.name} ${flight.events.some((e) => e.kind === "carry") ? "set the tank down somewhere new" : "found no room to land"}.`);
  else if (shell.dirt) say.push(`${me}'s ${shell.name} lands.`);
  else if (!own) say.push(`${me}'s ${shell.name} misses.`);
  if (own) say.push(struck.length ? `And catches ${me} for ${own}.` : `${me}'s ${shell.name} catches ${me} for ${own}.`);

  // To the last tank: armour comes off, and a tank with none is out, with whatever shells it had.
  if (s.rules.win === "knockout") {
    for (const hit of hits) {
      const tank = s.tanks[seatOf(hit.piece)]!;
      tank.armour = Math.max(0, tank.armour - hit.damage);
      if (tank.armour === 0 && !tank.out) {
        tank.out = true;
        s.bags[seatOf(hit.piece)] = {};
        say.push(`${who(seatOf(hit.piece))} is out!`);
      }
    }
  }
  s.narration = say.join(" ");

  const standing = s.tanks.filter((t) => !t.out).length;
  if (s.bags.every((bag) => count(bag) === 0) || (s.rules.win === "knockout" && standing <= 1)) {
    finish(s, s.narration);
    return s;
  }
  // The turn goes round to the next tank with anything to fire.
  let next = (seat + 1) % s.seats;
  while (count(s.bags[next]!) === 0) next = (next + 1) % s.seats;
  s.turn = next;
  s.wind = newWind(s);
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const windWords = (wind: number) => (wind === 0 ? "No wind" : `Wind ${Math.abs(wind)} ${wind < 0 ? "←" : "→"}`);

function resultOf(s: OverTheHillState): RoundResult {
  return {
    key: "overthehill/final",
    title: "How it went",
    sides: everyone(s.seats).map((i) => [i]),
    rows: [
      ...(s.rules.win === "knockout" ? [{ label: "Armour left", values: s.tanks.map((t) => (t.out ? "Out" : `${armourLeft(t)}%`)) }] : []),
      { label: "Best shot", values: s.best.map(String) },
      { label: "Points", values: s.points.map(String), tone: "total" as const },
    ],
  };
}

function view(s: OverTheHillState, seat: number): FieldView {
  const playing = s.phase === "playing";
  const knockout = s.rules.win === "knockout";
  const mine = s.phase !== "finished" && s.turn === seat;
  const tank = s.tanks[seat]!;
  return {
    game: "overthehill",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "finished" ? null : s.turn,
    field: {
      key: `overthehill/${s.shape}/${s.scene}/${s.tanks.length}`,
      name: LAND_NAMES[s.shape],
      scene: s.scene,
      gravity: GRAVITY[s.scene],
      width: WIDE,
      height: HIGH,
      step: STEP,
      land: s.land,
      wind: s.wind,
      pieces: s.tanks.map((t, i) => ({ id: tankId(i), x: t.x, y: t.y, owner: i, kind: "tank", tone: TONES[i % TONES.length]!, label: `${who(i)}'s tank`, angle: t.angle, ...(knockout ? { armour: armourLeft(t) } : {}), ...(t.out ? { out: true } : {}) })),
    },
    shells: SHELLS,
    pool: s.pool ? stock(s.pool) : null,
    pick: mine && s.phase === "draft" && s.pool ? { prompt: "Choose a shell", options: stock(s.pool) } : null,
    aim: mine && playing ? { piece: tankId(seat), shells: stock(s.bags[seat]!), minAngle: 0, maxAngle: 180, minPower: MIN_POWER, maxPower: MAX_POWER, angle: tank.angle, power: tank.power, move: s.rules.moves > 0 ? { left: tank.moves, ways: waysOpen(s, seat) } : null } : null,
    last: s.last,
    choices: null,
    players: everyone(s.seats).map((i) => {
      const left = count(s.bags[i]!);
      const t = s.tanks[i]!;
      return {
        line: t.out ? "Out" : s.phase === "draft" ? `${plural(left, "shell")} chosen` : knockout ? `Armour ${armourLeft(t)}% · ${plural(left, "shell")}` : `${plural(left, "shell")} left`,
        tone: TONES[i % TONES.length]!,
        shells: stock(s.bags[i]!),
        done: t.out || (playing && left === 0),
        badge: s.phase !== "finished" && s.turn === i ? (s.phase === "draft" ? "Choosing" : "Aiming") : undefined,
      };
    }),
    info: [LAND_NAMES[s.shape], ...(s.scene === "moon" ? ["Low gravity"] : []), ...(s.rules.wind !== "none" && playing ? [windWords(s.wind)] : []), ...(s.phase === "draft" && s.pool ? [`${plural(count(s.pool), "shell")} to choose`] : [])],
    narration: s.narration,
    scores: everyone(s.seats).map((i) => ({ seats: [i], value: s.points[i]! })),
    result: s.phase === "finished" ? resultOf(s) : null,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.over ?? "Game over" } : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

/** How much a shell is worth having, roughly: what it can take off someone, with a little for a wide blast. */
const worth = (shell: FieldShell) =>
  shell.damage * Math.min(3, shell.count ?? 1) + (shell.split ? shell.split.damage * shell.split.into * 0.5 : 0) + (shell.walk ? shell.walk.damage * shell.walk.steps * 0.4 : 0) + shell.blast / 6 + (shell.seek ? 12 : 0);

/** How good a shot would be: what it takes off the others, less what it costs, or failing a hit, how near it came. */
function tryShot(s: OverTheHillState, world: FieldWorld, seat: number, shell: FieldShell, angle: number, power: number): number {
  const flight = flyField(world, { piece: tankId(seat), shell, angle, power });
  let score = 0;
  for (const [id, took] of Object.entries(flight.damage)) score += id === tankId(seat) ? -1.5 * took : took;
  if (score !== 0) return score;
  // A miss: nearer to somebody is better, and nowhere near yourself.
  let near = 4000;
  for (const e of flight.events) {
    if (e.kind !== "burst" && e.kind !== "heap" && e.kind !== "fire") continue;
    for (let i = 0; i < s.seats; i++) {
      const t = s.tanks[i]!;
      if (i === seat || t.out) continue;
      near = Math.min(near, Math.abs(t.x - e.x) + Math.abs(t.y + PIECE_UP - e.y));
    }
  }
  return -near / 4000;
}

/** A shot worked out on the back of an envelope: forty-five degrees at whoever is nearest, and about hard enough. */
function roughShot(s: OverTheHillState, seat: number): { angle: number; power: number } {
  const me = s.tanks[seat]!;
  const target = s.tanks.filter((t, i) => i !== seat && !t.out).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
  if (!target) return { angle: 90, power: 50 };
  const far = Math.abs(target.x - me.x);
  // Range at 45° is speed² over gravity: a quarter of a unit a point of power, squared, on the earth.
  const power = Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(Math.sqrt((far * 4 * GRAVITY[s.scene]) / 100))));
  return { angle: target.x >= me.x ? 45 : 135, power };
}

function bot(s: OverTheHillState, seat: number, style: PlayStyle, rand: () => number = Math.random, budget?: ThinkBudget): OverTheHillMove | null {
  if (s.phase === "finished" || s.turn !== seat) return null;
  const sloppy = careless(style, rand);
  if (s.phase === "draft") {
    const open = stock(s.pool ?? {}).map((o) => shellOf(o.shell)!);
    if (!open.length) return null;
    const pick = sloppy ? open[Math.floor(rand() * open.length)]! : [...open].sort((a, b) => worth(b) - worth(a))[Math.floor(rand() * Math.min(3, open.length))]!;
    return { type: "pick", shell: pick.id };
  }
  const held = stock(s.bags[seat]!).map((o) => shellOf(o.shell)!);
  if (!held.length) return null;
  // Which shell: any of them when careless, else one of the better ones it has.
  const shell = sloppy ? held[Math.floor(rand() * held.length)]! : [...held].sort((a, b) => worth(b) - worth(a))[Math.floor(rand() * Math.min(4, held.length))]!;
  const rough = roughShot(s, seat);
  let best = { ...rough, score: -Infinity };
  // Asked for an answer at once: the envelope will do. So it will for a shell that only moves its own tank.
  if (!(budget && budget.ms <= 10) && !shell.carry) {
    const world = worldOf(s);
    const consider = (angle: number, power: number) => {
      if (angle < 0 || angle > 180 || power < MIN_POWER || power > MAX_POWER) return;
      const score = tryShot(s, world, seat, shell, angle, power);
      if (score > best.score) best = { angle, power, score };
    };
    // A sweep of the whole range, then a closer look round the best of it. A shell that flies
    // dead straight is all angle: it gets a finer sweep of that at one power.
    if (shell.weight === 0) for (let angle = 0; angle <= 180; angle += 2) consider(angle, 80);
    else for (let angle = 15; angle <= 165; angle += 6) for (let power = 25; power <= 100; power += 5) consider(angle, power);
    const { angle: a, power: p } = best;
    for (let da = -4; da <= 4; da += 2) for (let dp = -4; dp <= 4; dp += 2) if (da || dp) consider(a + da, p + dp);
  }
  // Then it is fired about as well as this player can: nobody's hand is perfectly steady.
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = sloppy ? 2.2 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const angle = Math.max(0, Math.min(180, Math.round(best.angle + wobble() * (1.5 + (1 - skill) * 10) * slip)));
  const power = Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(best.power + wobble() * (3 + (1 - skill) * 12) * slip)));
  return { type: "fire", shell: shell.id, angle, power };
}

// ---- The game -----------------------------------------------------------------------------------

function among<T>(options: readonly (readonly [T, string])[], value: unknown, otherwise: T): T {
  return options.some(([id]) => id === value) ? (value as T) : otherwise;
}

function normalize(rules: unknown): OverTheHillRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<Record<keyof OverTheHillRules, unknown>>;
  const preset = PRESETS.find((p) => p.id === given.id) ?? hillStandard;
  const moves = Number(given.moves);
  return {
    id: preset.id,
    name: preset.name,
    shells: SHELL_COUNTS.includes(Number(given.shells)) ? Number(given.shells) : preset.shells,
    mix: among(MIXES, given.mix, preset.mix),
    draft: given.draft === undefined ? preset.draft : given.draft === true,
    win: given.win === "knockout" || given.win === "points" ? given.win : preset.win,
    moves: Number.isInteger(moves) && moves >= 0 && moves <= 8 ? moves : preset.moves,
    wind: among(WINDS, given.wind, preset.wind),
    land: among(LANDS, given.land, preset.land),
    scene: among(SCENES, given.scene, preset.scene),
  };
}

const FIELDS: RuleField<OverTheHillRules>[] = [
  {
    key: "win",
    label: "To win",
    kind: "choice",
    options: [
      ["points", "Do the most damage"],
      ["knockout", "Be the last tank standing"],
    ],
  },
  { key: "shells", label: "Shells each", kind: "choice", options: SHELL_COUNTS.map((n) => [n, String(n)]) },
  { key: "mix", label: "Which shells", hint: "What goes into the bags. There is always some plain shot.", kind: "choice", options: MIXES },
  { key: "draft", label: "Pick your shells", hint: "The shells are laid out and you take one each in turn. Off: everyone is handed the same bag.", kind: "toggle" },
  { key: "moves", label: "Moves", hint: "How many times in a game a tank may drive a little way along the land.", kind: "number", min: 0, max: 8 },
  { key: "wind", label: "Wind", hint: "It pushes every shell, and changes with every shot.", kind: "choice", options: WINDS },
  { key: "land", label: "The land", kind: "choice", options: LANDS },
  { key: "scene", label: "The place", kind: "choice", options: SCENES },
];

export const overTheHill: FieldGame<OverTheHillRules, OverTheHillState, OverTheHillMove> = {
  id: "overthehill",
  name: "Over the Hill",
  emoji: "💥",
  category: "arcade",
  blurb: "Tanks, hills and a bag of odd shells: lob one over",
  tagline: "Pick a shell, set the angle and the power, and fire. Most damage done wins.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    const mix = r.mix === "all" ? "" : r.mix === "classic" ? " of the plain kinds" : r.mix === "bangs" ? " of the loudest kinds" : r.mix === "tricks" ? " of the oddest kinds" : " that move earth";
    return [
      "Tanks on a strip of hills take turns to fire one shell each. Choose the shell, set the barrel's angle and the power, and fire.",
      r.win === "knockout"
        ? `Every tank has ${ARMOUR} armour, and a hit takes off more the nearer the middle of the blast. A tank with none left is out. The last tank standing wins; if the shells run out first, whoever has most armour left does.`
        : "A hit scores what it takes off the other tank: more the nearer the middle of the blast. Catch yourself in your own blast and you lose those points instead.",
      r.win === "knockout" ? "What a shell does to the land stays done, and a tank whose ground is blown away drops to what is left." : "What a shell does to the land stays done. A tank whose ground is blown away drops to what is left, and nobody is ever knocked out.",
      r.draft ? `The shells${mix} are laid out first, and you take one each in turn until everyone has ${r.shells}.` : `Everyone is handed the same bag of ${r.shells} shells${mix}.`,
      ...(r.moves > 0 ? [`Before firing you may drive a little way left or right, ${plural(r.moves, "time")} in the game. It doesn't use your turn.`] : []),
      ...(r.wind !== "none" ? [`There is ${r.wind === "gale" ? "a gale" : "a breeze"}, which pushes every shell and changes with every shot.`] : []),
      ...(r.scene === "moon" ? ["This is the moon: everything falls slowly, so a shell goes more than twice as far."] : []),
      ...(r.win === "knockout" ? [] : ["When the last shell has landed, whoever has the most points wins."]),
    ];
  },
  newGame: newOverTheHill,
  apply,
  view,
  bot,
  // Trying a few hundred shots in its head is a moment's work, but not one for the table's own thread.
  heavy: (s, seat) => s.phase === "playing" && s.turn === seat,
  thinkingTime: (s) => thinkFor(s.phase === "draft" ? 3 : 8, 1),
  summary(s) {
    const over = s.phase === "finished";
    const knockout = s.rules.win === "knockout";
    return {
      game: "overthehill",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.seats === 2 ? `${s.points[0]} to ${s.points[1]}` : s.points.map((p, i) => `${who(i)} ${p}`).join(" · "),
      order: over ? rankSeats(everyone(s.seats).map((i) => ({ seats: [i], score: (knockout ? (s.winners?.includes(i) ? 2e6 : 0) + s.tanks[i]!.armour * 10000 : 0) + s.points[i]! }))) : null,
      winners: over ? s.winners : null,
      teams: false,
      seats: s.seats,
    };
  },
};
