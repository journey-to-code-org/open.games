// Crokinole: a round wooden board with a hole in the middle, a ring of eight pegs round it, and
// discs flicked in from the edge. For two, or four as partners. A move is a flick of your next
// disc; the physics core plays it to rest, and the rules here look at what it touched and where
// everything stopped.
//
// The one rule that makes the game: while the other side has a disc on the board, your flick has to
// hit one of theirs (straight, or off one of your own). Miss, and your disc comes off, with any of
// your own it knocked. When they have nothing on the board, your disc has to finish in the middle
// ring, touching the 15 line at least, or it comes off.
//
// A disc that drops in the centre hole is lifted out and banked: 20. A disc touching the outer line
// goes in the ditch. When every disc has been flicked the board is counted: 15 inside the pegs,
// 10 in the next ring, 5 in the outer one, a disc on a line counting for the lower ring, plus the
// 20s. The better side scores the difference.
import { PHYSICS_VERSION, simulate, type Body, type World } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { angleTo, restOf, type ShotMove, type SportBody, type SportGhost, type SportGame, type SportLook, type SportShot, type SportView } from "./sport.js";
import { careless, clone, GameError, markReady, nextHandChoices, thinkFor, who, type BaseRules, type RoundResult, type RuleField } from "./table.js";

// ---- The board ----------------------------------------------------------------------------------
// Lengths are tenths of a millimetre. The board is a circle in the middle of a square.

const SIZE = 7200;
const C = SIZE / 2;
/** The outer line: the edge of the playing surface. Beyond it is the ditch. */
const OUTER = 3300;
/** The ring lines: inside the first is worth 15, inside the second 10, and the rest 5. */
const R15 = 1016;
const R10 = 2032;
/** A disc, a peg, and the hole as it is drawn. A disc drops when its centre is over the middle of the hole. */
const R = 160;
const PEG = 48;
const HOLE = 180;
const DROP = 90;
/** Each side flicks from a line of its own, just inside the outer line: one side from the bottom, the other from the top. */
const LINE = 2900;
const REACH = 1100;
const MIN_POWER = 50;
const MAX_POWER = 1000;
/** No more rounds than this. */
const MOST_ROUNDS = 10;
const TARGETS = [50, 100, 150];
const DISCS = [6, 8, 12];

/** Exact, where `Math.hypot` need not be: the rules must come out the same on every machine. */
const dist = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);
/** Eight pegs on the 15 line, evenly spaced, none of them straight in front of a player: written out as whole numbers. */
const PEG_AT: [number, number][] = [[939, 389], [389, 939], [-389, 939], [-939, 389], [-939, -389], [-389, -939], [389, -939], [939, -389]];
const pegs = (): Body[] => PEG_AT.map(([x, y], i) => ({ id: `peg${i + 1}`, x: C + x, y: C + y, r: PEG, fixed: true, restitution: 0.7 }));

/** The board with nothing on it but its pegs. */
export const CROKINOLE: World = {
  bounds: { x: 0, y: 0, w: SIZE, h: SIZE },
  tickRate: 120,
  maxTicks: 2400,
  friction: 4000,
  restSpeed: 40,
  restitution: 0.85,
  wallRestitution: 0.5,
  maxShotSpeed: 9000,
  bodies: pegs(),
  walls: [],
  // The 20. A disc going fast skips across it.
  pockets: [{ id: "twenty", x: C, y: C, r: DROP, maxSpeed: 1400 }],
  regions: [],
};

type Side = 0 | 1;
const PREFIX = ["k", "g"] as const;
const COLOUR = ["Black", "Gold"] as const;
const isDisc = (b: Body) => !b.fixed;
const sideOfDisc = (id: string): Side => (id[0] === "k" ? 0 : 1);
const live = (b: Body) => !b.fixed && b.pocketed === undefined && b.out === undefined;
const far = (b: { x: number; y: number }) => dist(b.x - C, b.y - C);
const lineY = (side: Side) => (side === 0 ? C + LINE : C - LINE);
const PLACE = { min: C - REACH, max: C + REACH };

/** What a disc lying this far from the middle is worth: the ring it is wholly inside. Touching the outer line: nothing, it is in the ditch. */
export function crokinoleWorth(distance: number): number {
  if (distance + R < R15) return 15;
  if (distance + R < R10) return 10;
  if (distance + R < OUTER) return 5;
  return 0;
}

// ---- Rules and state ---------------------------------------------------------------------------

export interface CrokinoleRules extends BaseRules {
  /** The score that wins. */
  target: number;
  /** Discs a side flicks each round. */
  discs: number;
}

export const crokinole100: CrokinoleRules = { id: "to100", name: "To 100", target: 100, discs: 8 };
export const crokinole50: CrokinoleRules = { id: "to50", name: "Quick: to 50", target: 50, discs: 6 };
export const crokinole150: CrokinoleRules = { id: "to150", name: "Long: twelve discs, to 150", target: 150, discs: 12 };
const PRESETS = [crokinole100, crokinole50, crokinole150];

export interface CrokinoleState {
  game: "crokinole";
  rules: CrokinoleRules;
  seats: number;
  rng: number;
  /** The round being played, from 1. */
  hand: number;
  dealer: 0;
  phase: "playing" | "round" | "finished";
  turn: number;
  /** The board at rest, as the next flick will find it: the shooter's next disc on their line. Discs not on the board are `out` or `pocketed`. */
  world: World;
  /** How many discs each side has flicked this round. */
  thrown: [number, number];
  /** 20s each side has banked this round. */
  twenties: [number, number];
  /** The side that flicked first this round. */
  first: Side;
  /** Who flicks next for each side, so partners take turns. */
  rot: [number, number];
  shots: number;
  points: [number, number];
  last: SportShot | null;
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
  over: string | null;
}

export type CrokinoleMove = ShotMove | { type: "next" };

const teamOf = (seat: number) => (seat % 2) as Side;
const teamSeatsOf = (seats: number, team: number) => Array.from({ length: seats }, (_, i) => i).filter((i) => teamOf(i) === team);
const everyone = (seats: number) => Array.from({ length: seats }, (_, i) => i);
const discId = (side: Side, n: number) => `${PREFIX[side]}${n}`;
const nextDisc = (s: CrokinoleState, side: Side) => (s.thrown[side] < s.rules.discs ? discId(side, s.thrown[side] + 1) : null);
/** Where a side's discs wait: stacked in a corner of the table beside its line. */
const trayOf = (side: Side, n: number) => {
  const col = (n - 1) % 4;
  const row = Math.floor((n - 1) / 4);
  return side === 0 ? { x: 220 + col * 340, y: SIZE - 220 - row * 340 } : { x: SIZE - 220 - col * 340, y: 220 + row * 340 };
};

function fresh(rules: CrokinoleRules): World {
  const bodies = pegs();
  for (const side of [0, 1] as const) for (let n = 1; n <= rules.discs; n++) bodies.push({ id: discId(side, n), ...trayOf(side, n), r: R, out: "tray" });
  return { ...CROKINOLE, bodies };
}

/** Put a side's next disc on its line, ready to be flicked. */
function setDown(s: CrokinoleState, side: Side) {
  const id = nextDisc(s, side);
  const disc = s.world.bodies.find((b) => b.id === id);
  if (!disc) return;
  delete disc.out;
  disc.x = C;
  disc.y = lineY(side);
}

function seatFor(s: CrokinoleState, side: Side): number {
  const list = teamSeatsOf(s.seats, side);
  const seat = list[s.rot[side] % list.length]!;
  s.rot[side] += 1;
  return seat;
}

export function newCrokinole(rules: CrokinoleRules, seats: number, seed: number): CrokinoleState {
  const s: CrokinoleState = {
    game: "crokinole",
    rules,
    seats,
    rng: seed,
    hand: 1,
    dealer: 0,
    phase: "playing",
    turn: 0,
    world: fresh(rules),
    thrown: [0, 0],
    twenties: [0, 0],
    first: 0,
    rot: [0, 0],
    shots: 0,
    points: [0, 0],
    last: null,
    ready: Array<boolean>(seats).fill(false),
    result: null,
    winners: null,
    narration: null,
    over: null,
  };
  s.turn = seatFor(s, 0);
  setDown(s, 0);
  s.narration = `${who(s.turn)} to flick first.`;
  return s;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What each side has now: its discs on the board by the ring they lie in, and its 20s. The disc waiting on a line is not counted. */
export function crokinoleCount(bodies: readonly Body[], twenties: readonly [number, number], waiting: string | null = null): [number, number] {
  const total: [number, number] = [twenties[0] * 20, twenties[1] * 20];
  for (const b of bodies) if (live(b) && b.id !== waiting) total[sideOfDisc(b.id)] += crokinoleWorth(far(b));
  return total;
}

function endRound(s: CrokinoleState, said: string) {
  const [a, b] = crokinoleCount(s.world.bodies, s.twenties);
  const side: Side | null = a === b ? null : a > b ? 0 : 1;
  const gain = Math.abs(a - b);
  if (side !== null) s.points[side] += gain;
  const sides = [0, 1].map((t) => teamSeatsOf(s.seats, t));
  const name = (t: number) => `${who(teamSeatsOf(s.seats, t)[0]!)}${s.seats > 2 ? "'s side" : ""}`;
  const why = side === null ? `${said} ${a} each: nobody scores.` : `${said} ${name(side)} wins the round ${Math.max(a, b)} to ${Math.min(a, b)}, and scores ${gain}.`;
  s.result = {
    key: `crokinole/${s.hand}`,
    title: side === null ? `Round ${s.hand}: level` : `Round ${s.hand} to ${COLOUR[side]}`,
    sides,
    rows: [
      { label: "20s", values: s.twenties.map(String) },
      { label: "On the board", values: [a - s.twenties[0] * 20, b - s.twenties[1] * 20].map(String) },
      { label: "This round", values: [0, 1].map((t) => (t === side ? `+${gain}` : "")), tone: "score" },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
  const [p, q] = s.points;
  if (Math.max(p, q) >= s.rules.target || s.hand >= MOST_ROUNDS) {
    const lead = p === q ? null : p > q ? 0 : 1;
    s.phase = "finished";
    s.winners = lead === null ? everyone(s.seats) : teamSeatsOf(s.seats, lead);
    s.over = lead === null ? `${why} All square at ${p}.` : `${why} ${name(lead)} wins, ${Math.max(p, q)} to ${Math.min(p, q)}!`;
    s.narration = s.over;
    return;
  }
  s.phase = "round";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = why;
}

function apply(state: CrokinoleState, seat: number, move: CrokinoleMove): CrokinoleState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "round") throw new GameError("The round isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    // The sides take turns to flick first.
    const first = (1 - s.first) as Side;
    s.hand += 1;
    s.phase = "playing";
    s.world = fresh(s.rules);
    s.thrown = [0, 0];
    s.twenties = [0, 0];
    s.first = first;
    s.result = null;
    s.turn = seatFor(s, first);
    setDown(s, first);
    s.narration = `Round ${s.hand}: ${who(s.turn)} to flick first.`;
    return s;
  }
  if (move?.type !== "shot") throw new GameError("That's not a move in Crokinole.");
  if (state.phase !== "playing") throw new GameError(state.phase === "round" ? "The round is finished: move on to the next." : "This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your flick.");
  const side = teamOf(seat);
  const id = nextDisc(state, side);
  if (id === null || move.body !== id) throw new GameError("You flick your own next disc.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a flick: too soft or too hard.");
  if (move.spin !== undefined && move.spin !== 0) throw new GameError("There's no spin on a crokinole disc.");
  const s = clone(state);
  const disc = s.world.bodies.find((b) => b.id === id)!;
  if (move.at !== undefined) {
    if (!Number.isInteger(move.at) || move.at < PLACE.min || move.at > PLACE.max) throw new GameError("Put the disc down on your line.");
    // Another disc may be lying on the line: the new one can't be put down on top of it.
    if (s.world.bodies.some((b) => b !== disc && (live(b) || b.fixed) && dist(b.x - move.at!, b.y - disc.y) < b.r + R)) throw new GameError("There's a disc in the way there: put yours down beside it.");
    disc.x = move.at;
  }

  const before = s.world;
  const shot = { body: id, angle: move.angle, power: move.power };
  const played = simulate(before, shot);
  s.shots += 1;
  s.thrown[side] += 1;
  s.last = { n: s.shots, seat, shot, from: before.bodies, rest: restOf(played.world), ticks: played.ticks, physics: PHYSICS_VERSION };
  s.world = played.world;
  const bodies = s.world.bodies;
  const was = (b: Body) => before.bodies.find((x) => x.id === b.id)!;
  const me = who(seat);
  const say: string[] = [];
  const mine = bodies.find((b) => b.id === id)!;
  const ours = (x: string) => !x.startsWith("peg") && sideOfDisc(x) === side;
  const theirsId = (x: string) => !x.startsWith("peg") && sideOfDisc(x) !== side;

  // What touched what. Their discs on the board before the flick decide which rule it is judged by.
  const hits = played.events.filter((e): e is Extract<typeof e, { type: "hit" }> => e.type === "hit");
  const theyHad = before.bodies.some((b) => live(b) && sideOfDisc(b.id) !== side);
  const struck = hits.some((e) => (ours(e.a) && theirsId(e.b)) || (ours(e.b) && theirsId(e.a)));
  /** Our own discs that took part: the one flicked, and any of ours it (or another of ours) knocked. */
  const moved = new Set<string>([id]);
  for (const e of hits) for (const x of [e.a, e.b]) if (ours(x)) moved.add(x);
  const inMiddle = (b: Body) => b.pocketed !== undefined || (live(b) && far(b) - R <= R15);
  const good = theyHad ? struck : [...moved].some((x) => inMiddle(bodies.find((b) => b.id === x)!));

  // Into the ditch: off the board altogether, or touching the outer line.
  for (const b of bodies) if (live(b) && crokinoleWorth(far(b)) === 0) b.out = "ditch";
  const ditched = bodies.filter((b) => isDisc(b) && b.out !== undefined && live(was(b)));
  const dropped = bodies.filter((b) => isDisc(b) && b.pocketed !== undefined && was(b).pocketed === undefined);

  if (!good) {
    // A foul: the flicked disc comes off, with any of our own it knocked while missing theirs. A 20 made this way doesn't count.
    const off = theyHad ? [...moved] : [id];
    let taken = 0;
    for (const x of off) {
      const b = bodies.find((y) => y.id === x)!;
      if (live(b)) {
        b.out = "foul";
        taken += 1;
      } else if (b.pocketed !== undefined && was(b).pocketed === undefined) {
        delete b.pocketed;
        b.out = "foul";
        taken += 1;
      }
    }
    say.push(theyHad ? `${me} misses ${COLOUR[1 - side]!.toLowerCase()}: ${taken > 1 ? `${plural(taken, "disc")} come off` : "the disc comes off"}.` : mine.out === "foul" ? `${me}'s disc stops outside the 15 line and comes off.` : `${me}'s disc is gone.`);
  }
  for (const b of dropped) {
    if (b.pocketed === undefined) continue;
    const owner = sideOfDisc(b.id);
    s.twenties[owner] += 1;
    say.push(b === mine ? `${me} drops it in the hole: 20!` : owner === side ? `One of ${me}'s own drops in the hole: 20!` : `A ${COLOUR[owner].toLowerCase()} disc is knocked into the hole: 20 to ${COLOUR[owner]}.`);
  }
  if (good) {
    const gone = ditched.filter((b) => b.out !== "foul");
    const theirs = gone.filter((b) => sideOfDisc(b.id) !== side).length;
    const own = gone.length - theirs;
    if (mine.pocketed === undefined && !gone.includes(mine)) say.push(`${me}'s disc stops in the ${crokinoleWorth(far(mine))}.`);
    if (theirs) say.push(`${plural(theirs, `${COLOUR[1 - side]!.toLowerCase()} disc`)} ${theirs === 1 ? "goes" : "go"} in the ditch.`);
    if (own) say.push(`${plural(own, "of their own")} ${own === 1 ? "goes" : "go"} in the ditch.`);
  }
  s.narration = say.join(" ");

  if (s.thrown[0] + s.thrown[1] >= s.rules.discs * 2) {
    endRound(s, s.narration);
    return s;
  }
  const next = (nextDisc(s, (1 - side) as Side) !== null ? 1 - side : side) as Side;
  s.turn = seatFor(s, next);
  setDown(s, next);
  // A disc lying where the next one is put down: the new one goes beside it.
  const put = s.world.bodies.find((b) => b.id === nextDisc(s, next))!;
  for (let step = 0; step <= REACH && s.world.bodies.some((b) => b !== put && live(b) && dist(b.x - put.x, b.y - put.y) < b.r + R + 1); step += 20) {
    put.x = C + (step % 40 === 0 ? step : -step);
  }
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONE = ["black", "gold"] as const;
const lookOf = (id: string): SportBody => {
  if (id.startsWith("peg")) return { id, owner: null, kind: "peg", tone: "white", label: "a peg", height: 260 };
  const side = sideOfDisc(id);
  return { id, owner: null, kind: "puck", tone: TONE[side], label: `a ${COLOUR[side].toLowerCase()} disc`, height: 90 };
};

const ring = (r: number, surface: "wood" | "lane" | "soil" | "deck") => ({ shape: { x: C, y: C, r }, surface });
const LOOK: SportLook = {
  frame: { x: -200, y: -200, w: SIZE + 400, h: SIZE + 400 },
  base: "felt",
  ground: [
    // The ditch, then the board, with each ring's line drawn as a thin band under the ring inside it.
    ring(C, "soil"),
    ring(OUTER + 30, "wood"),
    ring(OUTER, "lane"),
    ring(R10 + 25, "soil"),
    ring(R10 - 25, "lane"),
    ring(R15 + 25, "soil"),
    ring(R15 - 25, "lane"),
    ring(HOLE, "soil"),
  ],
  regions: [],
  rails: [],
  blocks: [],
  ledges: [],
  tunnels: [],
  pockets: "pocket",
  decor: [],
  marks: [
    { x: C, y: C + (R15 + HOLE) / 2 + 40, text: "15", size: 380 },
    { x: C, y: C + (R15 + R10) / 2, text: "10", size: 380 },
    { x: C + (R10 + OUTER) / 2, y: C, text: "5", size: 380 },
    { x: C - (R10 + OUTER) / 2, y: C, text: "5", size: 380 },
  ],
};

function seatLine(s: CrokinoleState, seat: number): string {
  const side = teamOf(seat);
  const twenties = s.twenties[side];
  return `${COLOUR[side]} · ${plural(s.rules.discs - s.thrown[side], "disc")} left${twenties ? ` · ${plural(twenties, "20")}` : ""}`;
}

function view(s: CrokinoleState, seat: number): SportView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const side = teamOf(seat);
  const shooting = playing ? nextDisc(s, teamOf(s.turn)) : null;
  const ghosts: SportGhost[] = s.world.bodies.filter((b) => b.out === "tray").map((b) => ({ ...lookOf(b.id), id: `tray-${b.id}`, x: b.x, y: b.y, r: b.r }));
  const [a, b] = crokinoleCount(s.world.bodies, s.twenties, shooting);
  const theyHave = s.world.bodies.some((x) => live(x) && x.id !== shooting && sideOfDisc(x.id) !== side);
  return {
    game: "crokinole",
    seats: s.seats,
    me: seat,
    teams: s.seats > 2,
    phase: s.phase,
    turn: playing ? s.turn : null,
    table: {
      key: `crokinole/${s.hand}`,
      name: `Round ${s.hand}`,
      world: s.world,
      look: LOOK,
      bodies: s.world.bodies.map((x) => lookOf(x.id)),
      ghosts,
    },
    shoot: mine && shooting ? { body: shooting, minPower: MIN_POWER, maxPower: MAX_POWER, place: { y: lineY(side), ...PLACE } } : null,
    last: s.last,
    card: null,
    choices: s.phase === "round" ? nextHandChoices(s.ready, seat, false, "Next round") : null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: seatLine(s, i),
      team: s.seats > 2 ? teamOf(i) : undefined,
      done: !playing,
      badge: playing && s.turn === i ? "Flicking" : undefined,
    })),
    info: [`To ${s.rules.target}`, ...(playing ? [`On the board: Black ${a} · Gold ${b}`] : [])],
    narration: s.narration ?? (mine ? (theyHave ? "You have to hit one of theirs." : "Nothing of theirs to hit: finish inside the 15 line.") : null),
    scores: [0, 1].map((t) => ({ seats: teamSeatsOf(s.seats, t), value: s.points[t]! })).filter((x) => x.seats.length),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.over ?? "Game over" } : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

/** How hard to flick so a disc stops `distance` away. */
const powerFor = (distance: number) => (Math.sqrt(2 * CROKINOLE.friction * Math.max(0, distance)) / CROKINOLE.maxShotSpeed) * 1000;
const wrap = (a: number) => ((Math.round(a) % 36000) + 36000) % 36000;
/** How near the straight path from `a` to `b` comes to `p`. */
function nearPath(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return dist(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

function bot(s: CrokinoleState, seat: number, style: PlayStyle, rand: () => number = Math.random): CrokinoleMove | null {
  if (s.phase === "round") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const side = teamOf(seat);
  const id = nextDisc(s, side);
  if (!id) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2.2 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const y = lineY(side);
  const others = s.world.bodies.filter((b) => b.id !== id && (live(b) || b.fixed));
  const spots: number[] = [];
  for (let x = PLACE.min; x <= PLACE.max; x += 100) if (!others.some((b) => dist(b.x - x, b.y - y) < b.r + R + 1)) spots.push(x);
  if (!spots.length) spots.push(C);
  /** How much room the straight path to `to` has, past everything but `but`. */
  const room = (x: number, to: { x: number; y: number }, but: Body | null) => Math.min(...others.filter((b) => b !== but).map((b) => nearPath({ x, y }, to, b) - b.r - R), 2000);
  const send = (at: number, to: { x: number; y: number }, power: number): CrokinoleMove => ({
    type: "shot",
    body: id,
    angle: wrap(angleTo({ x: at, y }, to) + wobble() * (400 + (1 - skill) * 500) * slip),
    power: Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(power * (1 + wobble() * (0.06 + (1 - skill) * 0.1) * slip)))),
    at,
  });
  const theirs = others.filter((b) => !b.fixed && sideOfDisc(b.id) !== side);
  if (theirs.length) {
    // Something of theirs has to be hit: the best of them that there is a clear path to, hard enough to send it on its way.
    let best: { at: number; to: Body; score: number } | null = null;
    for (const to of theirs) {
      for (const at of spots) {
        const clear = room(at, to, to);
        const score = crokinoleWorth(far(to)) * 20 + Math.min(clear, 400) * (clear < 0 ? 10 : 1) - Math.abs(at - to.x) / 10;
        if (!best || score > best.score) best = { at, to, score };
      }
    }
    const { at, to } = best!;
    return send(at, to, powerFor(dist(to.x - at, to.y - y)) * 1.25 + 90);
  }
  // Nothing of theirs: the hole, from wherever the path to it is clearest, to die just past the middle.
  const middle = { x: C, y: C };
  let at = spots[0]!;
  let clearest = -Infinity;
  for (const x of spots) {
    const clear = room(x, middle, null) - Math.abs(x - C) / 8;
    if (clear > clearest) {
      clearest = clear;
      at = x;
    }
  }
  return send(at, middle, powerFor(dist(C - at, C - y) + 70));
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): CrokinoleRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CrokinoleRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? crokinole100;
  return {
    id: base.id,
    name: base.name,
    target: TARGETS.includes(Number(given.target)) ? Number(given.target) : base.target,
    discs: DISCS.includes(Number(given.discs)) ? Number(given.discs) : base.discs,
  };
}

const FIELDS: RuleField<CrokinoleRules>[] = [
  { key: "target", label: "Points to win", hint: `No more than ${MOST_ROUNDS} rounds: whoever is ahead then wins.`, kind: "choice", options: TARGETS.map((t) => [String(t), String(t)]) },
  { key: "discs", label: "Discs a side", hint: "How many each side flicks in a round.", kind: "choice", options: DISCS.map((t) => [String(t), String(t)]) },
];

export const crokinole: SportGame<CrokinoleRules, CrokinoleState, CrokinoleMove> = {
  id: "crokinole",
  name: "Crokinole",
  emoji: "🎯",
  category: "sports",
  blurb: "Flick discs at the hole in the middle, and theirs into the ditch",
  tagline: "A round board, a ring of pegs, and one rule: if they have a disc out there, you have to hit it.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `A round board with a hole in the middle and eight pegs round it. Black and gold have ${r.discs} discs each and flick them in turn, each from a line on their own side.`,
      "While the other side has a disc on the board, your flick has to hit one of theirs, straight or off one of your own. Miss, and your disc comes off, with any of your own it knocked.",
      "When they have nothing on the board, your disc has to finish inside the pegs, touching the 15 line at least, or it comes off.",
      "A disc that drops in the hole is banked for its owner: 20. A disc touching the outer line goes in the ditch.",
      "When every disc has been flicked the board is counted: 15 inside the pegs, 10 in the next ring, 5 in the outer one, and a disc on a line counts for the lower ring. The better side scores the difference.",
      `First to ${r.target} wins.`,
      "Two players, or four as partners: the partners take turns with their side's discs.",
    ];
  },
  newGame: newCrokinole,
  apply,
  view,
  bot,
  thinkingTime: () => thinkFor(6, 1),
  summary(s) {
    const over = s.phase === "finished";
    const winners = s.winners ?? [];
    const [a, b] = s.points;
    return {
      game: "crokinole",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand,
      scoreLine: s.seats === 2 ? `${a} to ${b}` : `Team 1: ${a} · Team 2: ${b}`,
      order: over ? [...winners, ...everyone(s.seats).filter((i) => !winners.includes(i))] : null,
      winners: over ? winners : null,
      teams: s.seats > 2,
      seats: s.seats,
    };
  },
};
