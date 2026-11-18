// Over the Hill: tanks on a strip of hills, lobbing shells at each other a turn at a time. For two
// to four. Everyone has the same number of shells, and the game is over when the last one has
// landed: whoever did the most damage wins. Nobody is knocked out, so everyone plays to the end.
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
import { FIELD_VERSION, PIECE_UP, flyField, landAt, type FieldGame, type FieldLand, type FieldLast, type FieldPiece, type FieldShell, type FieldStock, type FieldView, type FireMove } from "./field.js";
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

/** Every shell in the game. `often` is how many of each go into the mix the players' shells are drawn from. */
export const HILL_SHELLS: (FieldShell & { often: number })[] = [
  { id: "shot", name: "Plain Shot", blurb: "An honest shell. Goes where you send it.", blast: 70, damage: 30, often: 5 },
  { id: "big", name: "Big Shot", blurb: "The same, with a wider bang.", blast: 115, damage: 44, often: 3 },
  { id: "three", name: "Three of a Kind", blurb: "Three small shells, fanned out.", blast: 52, damage: 20, count: 3, spread: 4, often: 3 },
  { id: "sniper", name: "Needle", blurb: "A tiny blast that hurts. Has to land right on them.", blast: 26, damage: 62, often: 2 },
  { id: "skipper", name: "Skipper", blurb: "Skips off the ground twice before it bursts.", blast: 75, damage: 34, bounces: 2, often: 2 },
  { id: "roller", name: "Roller", blurb: "Rolls downhill from where it lands until something stops it.", blast: 80, damage: 36, roll: true, often: 2 },
  { id: "cluster", name: "Popcorn", blurb: "Bursts where it lands and throws out five more.", blast: 40, damage: 10, split: { at: "land", into: 5, blast: 46, damage: 14 }, often: 2 },
  { id: "hail", name: "Hailstorm", blurb: "Breaks into five at the top of its flight.", blast: 46, damage: 14, split: { at: "top", into: 5, blast: 46, damage: 15 }, often: 2 },
  { id: "digger", name: "Mole", blurb: "Bores on through the earth before it bursts.", blast: 62, damage: 32, dig: 260, often: 2 },
  { id: "dirt", name: "Dirt Heap", blurb: "No bang: a hill of earth where it lands.", blast: 110, damage: 0, dirt: true, often: 1 },
  { id: "pit", name: "Excavator", blurb: "A huge hole and a small hurt.", blast: 170, damage: 14, often: 1 },
  { id: "whopper", name: "Whopper", blurb: "The big one. Stand well back.", blast: 175, damage: 58, often: 1 },
];
const SHELLS: FieldShell[] = HILL_SHELLS.map(({ often: _often, ...shell }) => shell);
const shellOf = (id: unknown) => SHELLS.find((s) => s.id === id);
const TONES = ["red", "blue", "green", "gold"] as const;

// ---- Rules and state ---------------------------------------------------------------------------

export type HillLand = "any" | "hills" | "valley" | "peak" | "flats";
const LANDS: [HillLand, string][] = [
  ["any", "Any"],
  ["hills", "Rolling hills"],
  ["valley", "A valley"],
  ["peak", "A mountain between"],
  ["flats", "Flat country"],
];
const LAND_NAMES: Record<Exclude<HillLand, "any">, string> = { hills: "Rolling hills", valley: "The valley", peak: "The mountain", flats: "Flat country" };

export interface OverTheHillRules extends BaseRules {
  /** How many shells each player fires. */
  shells: number;
  /** The players choose their shells in turn from the ones laid out. Off: everyone is handed the same bag. */
  draft: boolean;
  /** How many times in a game a tank may drive along the land. */
  moves: number;
  /** A wind that changes with every shot. */
  wind: boolean;
  land: HillLand;
}

export const hillStandard: OverTheHillRules = { id: "standard", name: "Ten shells", shells: 10, draft: false, moves: 4, wind: false, land: "any" };
export const hillDraft: OverTheHillRules = { id: "draft", name: "Pick your shells", shells: 10, draft: true, moves: 4, wind: false, land: "any" };
export const hillQuick: OverTheHillRules = { id: "quick", name: "Quick: five shells", shells: 5, draft: false, moves: 2, wind: false, land: "any" };
export const hillWindy: OverTheHillRules = { id: "windy", name: "A windy day", shells: 10, draft: false, moves: 4, wind: true, land: "any" };
const PRESETS = [hillStandard, hillDraft, hillQuick, hillWindy];
const SHELL_COUNTS = [5, 8, 10, 15];

interface Tank {
  x: number;
  /** The ground under it. */
  y: number;
  /** Where the barrel and the power were left. */
  angle: number;
  power: number;
  /** Moves left. */
  moves: number;
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
  /** Which land this is, once "any" has been settled. */
  shape: Exclude<HillLand, "any">;
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
const count = (bag: Record<string, number>) => Object.values(bag).reduce((a, b) => a + b, 0);
/** A bag as a list, in the order the shells are listed above. */
const stock = (bag: Record<string, number>): FieldStock[] => SHELLS.filter((s) => (bag[s.id] ?? 0) > 0).map((s) => ({ shell: s.id, left: bag[s.id]! }));
const landOf = (s: Pick<OverTheHillState, "land">): FieldLand => ({ width: WIDE, step: STEP, heights: s.land });
const piecesOf = (s: Pick<OverTheHillState, "tanks">): FieldPiece[] => s.tanks.map((t, i) => ({ id: tankId(i), x: t.x, y: t.y }));

/**
 * The land for a seed: a base shape with three sizes of bump laid over it, each a row of random
 * heights joined by a smooth curve. Only arithmetic that every engine does alike.
 */
export function hillLand(shape: Exclude<HillLand, "any">, rand: () => number): number[] {
  const rough = shape === "flats" ? 0.22 : shape === "peak" ? 0.7 : 1;
  const layers = [
    { every: 50, tall: 210 },
    { every: 20, tall: 90 },
    { every: 8, tall: 28 },
  ].map((layer) => ({ ...layer, at: Array.from({ length: Math.ceil(COLUMNS / layer.every) + 2 }, () => rand() - 0.5) }));
  const heights: number[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const t = (2 * i) / (COLUMNS - 1) - 1;
    let h = shape === "valley" ? 250 + 350 * t * t : shape === "peak" ? 250 + 460 * (1 - t * t) * (1 - t * t) : shape === "flats" ? 350 : 390;
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
function drawShells(n: number, rand: () => number): Record<string, number> {
  const mix = HILL_SHELLS.flatMap((s) => Array<string>(s.often).fill(s.id));
  const bag: Record<string, number> = {};
  const plain = Math.max(1, Math.round(n / 5));
  for (let i = 0; i < n; i++) {
    const id = i < plain ? "shot" : mix[Math.floor(rand() * mix.length)]!;
    bag[id] = (bag[id] ?? 0) + 1;
  }
  return bag;
}

export function newOverTheHill(rules: OverTheHillRules, seats: number, seed: number): OverTheHillState {
  const carry = { rng: seed };
  const rand = nextRandom(carry);
  const shapes = ["hills", "valley", "peak", "flats"] as const;
  const shape = rules.land === "any" ? shapes[Math.floor(rand() * shapes.length)]! : rules.land;
  const land = hillLand(shape, rand);
  // The tanks are spread across the field, each a little off its mark.
  const tanks: Tank[] = everyone(seats).map((i) => {
    const mark = seats === 1 ? WIDE / 2 : WIDE * 0.12 + (WIDE * 0.76 * i) / (seats - 1);
    const x = Math.round((mark + (rand() - 0.5) * WIDE * (seats > 2 ? 0.06 : 0.1)) / STEP) * STEP;
    pad(land, x);
    return { x, y: land[x / STEP]!, angle: x < WIDE / 2 ? 60 : 120, power: 60, moves: rules.moves };
  });
  const first = Math.floor(rand() * seats);
  const bag = drawShells(rules.shells, rand);
  const pool = rules.draft ? everyone(seats).reduce<Record<string, number>>((all) => {
    for (const [id, n] of Object.entries(drawShells(rules.shells, rand))) all[id] = (all[id] ?? 0) + n;
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
  if (rules.wind) s.wind = newWind(s);
  s.narration = rules.draft ? `${who(first)} to choose first.` : `${who(first)} to fire first.`;
  return s;
}

function newWind(s: OverTheHillState): number {
  return Math.floor(nextRandom(s)() * 17) - 8;
}

/** Which ways a tank may drive: not off the field, and not up against another tank. */
function waysOpen(s: OverTheHillState, seat: number): (-1 | 1)[] {
  const tank = s.tanks[seat]!;
  if (tank.moves <= 0) return [];
  return ([-1, 1] as const).filter((way) => {
    const x = tank.x + way * DRIVE;
    return x >= EDGE && x <= WIDE - EDGE && s.tanks.every((other, i) => i === seat || Math.abs(other.x - x) >= APART);
  });
}

function finish(s: OverTheHillState, said: string) {
  const top = Math.max(...s.points);
  s.winners = everyone(s.seats).filter((i) => s.points[i] === top);
  s.phase = "finished";
  const tied = s.winners.length > 1;
  s.over = tied ? `All square at ${top}.` : `${who(s.winners[0]!)} wins with ${top}!`;
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
  const from = { land: s.land, pieces: piecesOf(s), wind: s.wind };
  const flight = flyField({ land: landOf(s), pieces: from.pieces, wind: s.wind }, { piece: tankId(seat), shell, angle: move.angle, power: move.power });
  s.shots += 1;
  s.bags[seat]![shell.id]! -= 1;
  s.land = flight.land;
  flight.pieces.forEach((p, i) => (s.tanks[i]!.y = p.y));
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
  else if (shell.dirt) say.push(`${me}'s ${shell.name} lands.`);
  else if (!own) say.push(`${me}'s ${shell.name} misses.`);
  if (own) say.push(struck.length ? `And catches ${me} for ${own}.` : `${me}'s ${shell.name} catches ${me} for ${own}.`);
  s.narration = say.join(" ");

  if (s.bags.every((bag) => count(bag) === 0)) {
    finish(s, s.narration);
    return s;
  }
  // Everyone has the same number of shells, so the turn simply goes round.
  let next = (seat + 1) % s.seats;
  while (count(s.bags[next]!) === 0) next = (next + 1) % s.seats;
  s.turn = next;
  if (s.rules.wind) s.wind = newWind(s);
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
      { label: "Best shot", values: s.best.map(String) },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
}

function view(s: OverTheHillState, seat: number): FieldView {
  const playing = s.phase === "playing";
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
      key: `overthehill/${s.shape}/${s.tanks.length}`,
      name: LAND_NAMES[s.shape],
      width: WIDE,
      height: HIGH,
      step: STEP,
      land: s.land,
      wind: s.wind,
      pieces: s.tanks.map((t, i) => ({ id: tankId(i), x: t.x, y: t.y, owner: i, kind: "tank", tone: TONES[i % TONES.length]!, label: `${who(i)}'s tank`, angle: t.angle })),
    },
    shells: SHELLS,
    pool: s.pool ? stock(s.pool) : null,
    pick: mine && s.phase === "draft" && s.pool ? { prompt: "Choose a shell", options: stock(s.pool) } : null,
    aim: mine && playing ? { piece: tankId(seat), shells: stock(s.bags[seat]!), minAngle: 0, maxAngle: 180, minPower: MIN_POWER, maxPower: MAX_POWER, angle: tank.angle, power: tank.power, move: s.rules.moves > 0 ? { left: tank.moves, ways: waysOpen(s, seat) } : null } : null,
    last: s.last,
    choices: null,
    players: everyone(s.seats).map((i) => {
      const left = count(s.bags[i]!);
      return {
        line: s.phase === "draft" ? `${plural(left, "shell")} chosen` : `${plural(left, "shell")} left`,
        tone: TONES[i % TONES.length]!,
        shells: stock(s.bags[i]!),
        done: playing && left === 0,
        badge: s.phase !== "finished" && s.turn === i ? (s.phase === "draft" ? "Choosing" : "Aiming") : undefined,
      };
    }),
    info: [LAND_NAMES[s.shape], ...(s.rules.wind && playing ? [windWords(s.wind)] : []), ...(s.phase === "draft" && s.pool ? [`${plural(count(s.pool), "shell")} to choose`] : [])],
    narration: s.narration,
    scores: everyone(s.seats).map((i) => ({ seats: [i], value: s.points[i]! })),
    result: s.phase === "finished" ? resultOf(s) : null,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.over ?? "Game over" } : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

/** How much a shell is worth having, roughly: what it can take off someone, with a little for a wide blast. */
const worth = (shell: FieldShell) => shell.damage * (shell.count ?? 1) + (shell.split ? shell.split.damage * shell.split.into * 0.6 : 0) + shell.blast / 6;

/** How good a shot would be: what it takes off the others, less what it costs, or failing a hit, how near it came. */
function tryShot(s: OverTheHillState, seat: number, shell: FieldShell, angle: number, power: number): number {
  const flight = flyField({ land: landOf(s), pieces: piecesOf(s), wind: s.wind }, { piece: tankId(seat), shell, angle, power });
  let score = 0;
  for (const [id, took] of Object.entries(flight.damage)) score += id === tankId(seat) ? -1.5 * took : took;
  if (score !== 0) return score;
  // A miss: nearer to somebody is better, and nowhere near yourself.
  let near = 4000;
  for (const e of flight.events) {
    if (e.kind !== "burst" && e.kind !== "heap") continue;
    for (let i = 0; i < s.seats; i++) {
      if (i === seat) continue;
      const t = s.tanks[i]!;
      near = Math.min(near, Math.abs(t.x - e.x) + Math.abs(t.y + PIECE_UP - e.y));
    }
  }
  return -near / 4000;
}

/** A shot worked out on the back of an envelope: forty-five degrees at whoever is nearest, and about hard enough. */
function roughShot(s: OverTheHillState, seat: number): { angle: number; power: number } {
  const me = s.tanks[seat]!;
  const target = s.tanks.filter((_, i) => i !== seat).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
  if (!target) return { angle: 90, power: 50 };
  const far = Math.abs(target.x - me.x);
  // Range at 45° is speed² over gravity: 0.25² / 0.25 a point of power, squared.
  const power = Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(Math.sqrt(far / 0.25))));
  return { angle: target.x >= me.x ? 45 : 135, power };
}

function bot(s: OverTheHillState, seat: number, style: PlayStyle, rand: () => number = Math.random, budget?: ThinkBudget): OverTheHillMove | null {
  if (s.phase === "finished" || s.turn !== seat) return null;
  const sloppy = careless(style, rand);
  if (s.phase === "draft") {
    const open = stock(s.pool ?? {}).map((o) => shellOf(o.shell)!);
    if (!open.length) return null;
    const pick = sloppy ? open[Math.floor(rand() * open.length)]! : [...open].sort((a, b) => worth(b) - worth(a))[Math.floor(rand() * Math.min(2, open.length))]!;
    return { type: "pick", shell: pick.id };
  }
  const held = stock(s.bags[seat]!).map((o) => shellOf(o.shell)!);
  if (!held.length) return null;
  // Which shell: any of them when careless, else one of the better ones it has.
  const shell = sloppy ? held[Math.floor(rand() * held.length)]! : [...held].sort((a, b) => worth(b) - worth(a))[Math.floor(rand() * Math.min(3, held.length))]!;
  const rough = roughShot(s, seat);
  let best = { ...rough, score: -Infinity };
  // Asked for an answer at once: the envelope will do.
  if (!(budget && budget.ms <= 10)) {
    const consider = (angle: number, power: number) => {
      if (angle < 0 || angle > 180 || power < MIN_POWER || power > MAX_POWER) return;
      const score = tryShot(s, seat, shell, angle, power);
      if (score > best.score) best = { angle, power, score };
    };
    // A sweep of the whole range, then a closer look round the best of it.
    for (let angle = 15; angle <= 165; angle += 6) for (let power = 25; power <= 100; power += 5) consider(angle, power);
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

function normalize(rules: unknown): OverTheHillRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<OverTheHillRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? hillStandard;
  const moves = Number(given.moves);
  return {
    id: base.id,
    name: base.name,
    shells: SHELL_COUNTS.includes(Number(given.shells)) ? Number(given.shells) : base.shells,
    draft: given.draft === undefined ? base.draft : given.draft === true,
    moves: Number.isInteger(moves) && moves >= 0 && moves <= 8 ? moves : base.moves,
    wind: given.wind === undefined ? base.wind : given.wind === true,
    land: LANDS.some(([id]) => id === given.land) ? given.land! : base.land,
  };
}

const FIELDS: RuleField<OverTheHillRules>[] = [
  { key: "shells", label: "Shells each", kind: "choice", options: SHELL_COUNTS.map((n) => [n, String(n)]) },
  { key: "draft", label: "Pick your shells", hint: "The shells are laid out and you take one each in turn. Off: everyone is handed the same bag.", kind: "toggle" },
  { key: "moves", label: "Moves", hint: "How many times in a game a tank may drive a little way along the land.", kind: "number", min: 0, max: 8 },
  { key: "wind", label: "Wind", hint: "It pushes every shell, and changes with every shot.", kind: "toggle" },
  { key: "land", label: "The land", kind: "choice", options: LANDS },
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
    return [
      "Tanks on a strip of hills take turns to fire one shell each. Choose the shell, set the barrel's angle and the power, and fire.",
      "A hit scores what it takes off the other tank: more the nearer the middle of the blast. Catch yourself in your own blast and you lose those points instead.",
      "What a shell does to the land stays done. A tank whose ground is blown away drops to what is left, and nobody is ever knocked out.",
      r.draft ? `The shells are laid out first, and you take one each in turn until everyone has ${r.shells}.` : `Everyone is handed the same bag of ${r.shells} shells.`,
      ...(r.moves > 0 ? [`Before firing you may drive a little way left or right, ${plural(r.moves, "time")} in the game. It doesn't use your turn.`] : []),
      ...(r.wind ? ["There is a wind, which pushes every shell and changes with every shot."] : []),
      "When the last shell has landed, whoever has the most points wins.",
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
    return {
      game: "overthehill",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.seats === 2 ? `${s.points[0]} to ${s.points[1]}` : s.points.map((p, i) => `${who(i)} ${p}`).join(" · "),
      order: over ? rankSeats(everyone(s.seats).map((i) => ({ seats: [i], score: s.points[i]! }))) : null,
      winners: over ? s.winners : null,
      teams: false,
      seats: s.seats,
    };
  },
};
