// Shuffleboard, the long table: a slick board with three scoring zones at the far end, four red
// pucks and four blue, slid from the near end one at a time. For two, or four as partners. A move
// is a shot at your next puck; the physics core plays it to rest, and the rules here look at where
// everything stopped.
//
// The board has no rails. A puck that slides off the far end or a side is gone, and so is one that
// stops short of the foul line, or is knocked back behind it. What is left when all eight have
// been slid is counted: only the side with the puck furthest down the board scores, and only for
// its pucks that lie beyond the other side's best. A puck is worth the zone it lies wholly inside:
// 3 at the far end, then 2, then 1; one on a line counts for the lower zone, and one hanging over
// the far edge is a hanger, worth 4.
//
// Whoever scored slides first in the next round, which gives the other side the last puck, the
// hammer. Rounds are played until a side reaches the target.
import { PHYSICS_VERSION, simulate, type Body, type World } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { angleTo, restOf, type ShotMove, type SportBody, type SportGame, type SportGhost, type SportLook, type SportShot, type SportView } from "./sport.js";
import { careless, clone, GameError, markReady, nextHandChoices, thinkFor, who, type BaseRules, type RoundResult, type RuleField } from "./table.js";

// ---- The board ----------------------------------------------------------------------------------
// Lengths are tenths of a millimetre. The board runs up the screen: slid from the bottom (a large
// y) toward the scoring end at the top (y = 0).

const WIDE = 4000;
const LONG = 12000;
/** A puck. */
const R = 250;
/** Where the zones end, measured from the far edge: the 3, the 2, and the 1, which ends at the foul line. */
const Z3 = 1200;
const Z2 = 2400;
const FOUL = 5600;
/** Where a puck is put down to be slid, and how far along that line it may go. */
const LAUNCH = 11200;
const PLACE = { min: 500, max: WIDE - 500 };
const MIN_POWER = 50;
const MAX_POWER = 1000;
const PUCKS = 4;
/** No more rounds than this, so two poor players can't go on for ever. */
const MOST_ROUNDS = 12;
const TARGETS = [11, 15, 21];

/** The board with nothing on it: slick, and with nothing round the edge to stop a puck. */
export const SHUFFLEBOARD: World = {
  // A puck whose centre passes an edge has fallen off.
  bounds: { x: 0, y: 0, w: WIDE, h: LONG },
  tickRate: 120,
  maxTicks: 2400,
  friction: 3500,
  restSpeed: 40,
  restitution: 0.85,
  wallRestitution: 0.5,
  maxShotSpeed: 11000,
  bodies: [],
  walls: [],
  pockets: [],
  regions: [],
};

type Side = 0 | 1;
const PREFIX = ["r", "b"] as const;
const COLOUR = ["Red", "Blue"] as const;
const sideOfPuck = (id: string): Side => (id[0] === "r" ? 0 : 1);
const live = (b: Body) => b.pocketed === undefined && b.out === undefined;
/** Where a side's pucks wait to be slid: in a row beside the near end, red on the left and blue on the right. */
const trayOf = (side: Side, n: number) => ({ x: side === 0 ? -520 : WIDE + 520, y: LAUNCH - n * 560 });

/**
 * What a puck lying at `y` is worth: the zone it is wholly inside, 4 for one hanging over the far
 * edge, and 0 for one that has not wholly cleared the foul line (which is taken off the board).
 */
export function shuffleboardZone(y: number, hangers = true): number {
  if (y < R) return hangers ? 4 : 3;
  if (y + R <= Z3) return 3;
  if (y + R <= Z2) return 2;
  if (y + R <= FOUL) return 1;
  return 0;
}

// ---- Rules and state ---------------------------------------------------------------------------

export interface ShuffleboardRules extends BaseRules {
  /** The score that wins. */
  target: number;
  /** A puck hanging over the far edge is worth 4. Off: it is a 3 like any other. */
  hangers: boolean;
}

export const shuffleboard15: ShuffleboardRules = { id: "to15", name: "To 15", target: 15, hangers: true };
export const shuffleboard21: ShuffleboardRules = { id: "to21", name: "To 21", target: 21, hangers: true };
export const shuffleboard11: ShuffleboardRules = { id: "to11", name: "Quick: to 11", target: 11, hangers: true };
const PRESETS = [shuffleboard15, shuffleboard21, shuffleboard11];

export interface ShuffleboardState {
  game: "shuffleboard";
  rules: ShuffleboardRules;
  seats: number;
  rng: number;
  /** The round being played, from 1. */
  hand: number;
  dealer: 0;
  phase: "playing" | "round" | "finished";
  turn: number;
  /** The board at rest, as the next shot will find it: the shooter's next puck on the line. Pucks not on the board are `out`. */
  world: World;
  /** How many pucks each side has slid this round. */
  thrown: [number, number];
  /** The side that slid first this round. */
  first: Side;
  /** Who slides next for each side, so partners take turns. */
  rot: [number, number];
  /** Shots in the whole game: each is animated once. */
  shots: number;
  points: [number, number];
  last: SportShot | null;
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
  over: string | null;
}

export type ShuffleboardMove = ShotMove | { type: "next" };

const teamOf = (seat: number) => (seat % 2) as Side;
const teamSeatsOf = (seats: number, team: number) => Array.from({ length: seats }, (_, i) => i).filter((i) => teamOf(i) === team);
const everyone = (seats: number) => Array.from({ length: seats }, (_, i) => i);
const puckId = (side: Side, n: number) => `${PREFIX[side]}${n}`;
/** The puck a side slides next, or null when it has slid them all. */
const nextPuck = (s: ShuffleboardState, side: Side) => (s.thrown[side] < PUCKS ? puckId(side, s.thrown[side] + 1) : null);

/** All eight pucks in their trays, off the board. */
function trays(): Body[] {
  const bodies: Body[] = [];
  for (const side of [0, 1] as const) for (let n = 1; n <= PUCKS; n++) bodies.push({ id: puckId(side, n), ...trayOf(side, n), r: R, out: "tray" });
  return bodies;
}

/** Put a side's next puck on the line, ready to be slid. */
function setDown(s: ShuffleboardState, side: Side) {
  const id = nextPuck(s, side);
  const puck = s.world.bodies.find((b) => b.id === id);
  if (!puck) return;
  delete puck.out;
  puck.x = WIDE / 2;
  puck.y = LAUNCH;
}

/** The seat that slides next for a side, taking partners in turn. */
function seatFor(s: ShuffleboardState, side: Side): number {
  const list = teamSeatsOf(s.seats, side);
  const seat = list[s.rot[side] % list.length]!;
  s.rot[side] += 1;
  return seat;
}

export function newShuffleboard(rules: ShuffleboardRules, seats: number, seed: number): ShuffleboardState {
  const s: ShuffleboardState = {
    game: "shuffleboard",
    rules,
    seats,
    rng: seed,
    hand: 1,
    dealer: 0,
    phase: "playing",
    turn: 0,
    world: { ...SHUFFLEBOARD, bodies: trays() },
    thrown: [0, 0],
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
  s.narration = `${who(s.turn)} to slide first.`;
  return s;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** How a round counts: the side whose puck is furthest down scores for each of its pucks beyond the other side's best. */
export function shuffleboardCount(bodies: readonly Body[], hangers = true): { side: Side | null; pucks: { id: string; worth: number }[]; points: number } {
  // The puck on the line, waiting to be slid, is not on the board yet: only what lies past the foul line counts.
  const on = bodies.filter((b) => live(b) && shuffleboardZone(b.y, hangers) > 0);
  const best = (side: Side) => Math.min(...on.filter((b) => sideOfPuck(b.id) === side).map((b) => b.y));
  const [red, blue] = [best(0), best(1)];
  // Nothing on the board, or the two best exactly level: nobody scores.
  if (red === blue) return { side: null, pucks: [], points: 0 };
  const side: Side = red < blue ? 0 : 1;
  const beat = side === 0 ? blue : red;
  const pucks = on
    .filter((b) => sideOfPuck(b.id) === side && b.y < beat)
    .sort((a, b) => a.y - b.y)
    .map((b) => ({ id: b.id, worth: shuffleboardZone(b.y, hangers) }));
  return { side, pucks, points: pucks.reduce((sum, p) => sum + p.worth, 0) };
}

/** All eight are slid: count the board, and either the game ends or everyone is asked to move on. */
function endRound(s: ShuffleboardState, said: string) {
  const count = shuffleboardCount(s.world.bodies, s.rules.hangers);
  if (count.side !== null) s.points[count.side] += count.points;
  const sides = [0, 1].map((t) => teamSeatsOf(s.seats, t));
  const scorer = count.side === null ? null : who(teamSeatsOf(s.seats, count.side)[0]!);
  const why = count.side === null ? `${said} Nobody scores.` : `${said} ${scorer}${s.seats > 2 ? "'s side scores" : " scores"} ${count.points}.`;
  s.result = {
    key: `shuffleboard/${s.hand}`,
    title: count.side === null ? `Round ${s.hand}: nobody scores` : `Round ${s.hand} to ${COLOUR[count.side]}`,
    sides,
    rows: [
      { label: "Pucks that count", values: [0, 1].map((t) => (t === count.side ? count.pucks.map((p) => p.worth).join(" + ") : "")) },
      { label: "This round", values: [0, 1].map((t) => (t === count.side ? `+${count.points}` : "")), tone: "score" },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
  const [a, b] = s.points;
  if (Math.max(a, b) >= s.rules.target || s.hand >= MOST_ROUNDS) {
    const lead = a === b ? null : a > b ? 0 : 1;
    s.phase = "finished";
    s.winners = lead === null ? everyone(s.seats) : teamSeatsOf(s.seats, lead);
    s.over = lead === null ? `${why} All square at ${a}.` : `${why} ${who(teamSeatsOf(s.seats, lead)[0]!)}${s.seats > 2 ? "'s side wins" : " wins"}, ${Math.max(a, b)} to ${Math.min(a, b)}!`;
    s.narration = s.over;
    return;
  }
  s.phase = "round";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = why;
}

function apply(state: ShuffleboardState, seat: number, move: ShuffleboardMove): ShuffleboardState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "round") throw new GameError("The round isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    // Whoever scored slides first, so the other side has the last puck. Nobody scored: the other side goes first this time.
    const scored = shuffleboardCount(s.world.bodies, s.rules.hangers).side;
    const first = scored ?? ((1 - s.first) as Side);
    s.hand += 1;
    s.phase = "playing";
    s.world = { ...SHUFFLEBOARD, bodies: trays() };
    s.thrown = [0, 0];
    s.first = first;
    s.result = null;
    s.turn = seatFor(s, first);
    setDown(s, first);
    s.narration = `Round ${s.hand}: ${who(s.turn)} to slide first.`;
    return s;
  }
  if (move?.type !== "shot") throw new GameError("That's not a move in Shuffleboard.");
  if (state.phase !== "playing") throw new GameError(state.phase === "round" ? "The round is finished: move on to the next." : "This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your slide.");
  const side = teamOf(seat);
  const id = nextPuck(state, side);
  if (id === null || move.body !== id) throw new GameError("You slide your own next puck.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a slide: too soft or too hard.");
  if (move.spin !== undefined && move.spin !== 0) throw new GameError("There's no spin on a shuffleboard puck.");
  const s = clone(state);
  const puck = s.world.bodies.find((b) => b.id === id)!;
  if (move.at !== undefined) {
    if (!Number.isInteger(move.at) || move.at < PLACE.min || move.at > PLACE.max) throw new GameError("Put the puck down on the line.");
    puck.x = move.at;
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

  // Off the end or a side: the physics has already taken those. Short of the foul line, or knocked back behind it: taken off now.
  const off = bodies.filter((b) => b.out !== undefined && live(was(b)));
  for (const b of bodies) if (live(b) && shuffleboardZone(b.y, s.rules.hangers) === 0) b.out = "short";
  const short = bodies.filter((b) => b.out === "short" && live(was(b)));
  const mine = bodies.find((b) => b.id === id)!;
  if (off.includes(mine)) say.push(`${me}'s puck slides off the board.`);
  else if (short.includes(mine)) say.push(`${me}'s puck stops short of the foul line and is taken off.`);
  else {
    const worth = shuffleboardZone(mine.y, s.rules.hangers);
    say.push(mine.y < R && s.rules.hangers ? `${me} leaves a hanger on the far edge!` : `${me}'s puck stops in the ${worth}.`);
  }
  const knocked = [...off, ...short].filter((b) => b !== mine);
  const theirs = knocked.filter((b) => sideOfPuck(b.id) !== side).length;
  const own = knocked.length - theirs;
  if (theirs) say.push(`${plural(theirs, `${COLOUR[1 - side]!.toLowerCase()} puck`)} ${theirs === 1 ? "is" : "are"} knocked off.`);
  if (own) say.push(`${plural(own, "of their own")} ${own === 1 ? "goes" : "go"} with it.`);
  s.narration = say.join(" ");

  if (s.thrown[0] + s.thrown[1] >= PUCKS * 2) {
    endRound(s, s.narration);
    return s;
  }
  // The other side slides next, while it has a puck left.
  const next = (nextPuck(s, (1 - side) as Side) !== null ? 1 - side : side) as Side;
  s.turn = seatFor(s, next);
  setDown(s, next);
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONE = ["red", "blue"] as const;
const lookOf = (id: string): SportBody => {
  const side = sideOfPuck(id);
  return { id, owner: null, kind: "puck", tone: TONE[side], label: `a ${COLOUR[side].toLowerCase()} puck`, height: 110 };
};

const EDGE = 1100;
/** A strip across the board: a painted line, as wide as it is drawn. */
const line = (y: number) => ({ shape: { points: [[0, y - 25], [WIDE, y - 25], [WIDE, y + 25], [0, y + 25]] as [number, number][] }, surface: "soil" as const });
const LOOK: SportLook = {
  frame: { x: -EDGE, y: -500, w: WIDE + 2 * EDGE, h: LONG + 900 },
  base: "felt",
  ground: [
    // The cradle the board lies in, then the board, then its lines: the ends of the 3 and the 2, and the foul line.
    { shape: { points: [[-EDGE + 250, -250], [WIDE + EDGE - 250, -250], [WIDE + EDGE - 250, LONG + 250], [-EDGE + 250, LONG + 250]] }, surface: "wood" },
    { shape: { points: [[0, 0], [WIDE, 0], [WIDE, LONG], [0, LONG]] }, surface: "lane" },
    line(Z3),
    line(Z2),
    line(FOUL),
  ],
  regions: [],
  rails: [],
  blocks: [],
  ledges: [],
  tunnels: [],
  pockets: "pocket",
  decor: [],
};

function seatLine(s: ShuffleboardState, seat: number): string {
  const side = teamOf(seat);
  return `${COLOUR[side]} · ${plural(PUCKS - s.thrown[side], "puck")} left`;
}

function view(s: ShuffleboardState, seat: number): SportView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const side = teamOf(seat);
  const shooting = playing ? nextPuck(s, teamOf(s.turn)) : null;
  // The pucks still waiting in their trays are drawn there, under names of their own: they are no part of the board.
  const ghosts: SportGhost[] = s.world.bodies.filter((b) => b.out === "tray").map((b) => ({ ...lookOf(b.id), id: `tray-${b.id}`, x: b.x, y: b.y, r: b.r }));
  const count = shuffleboardCount(s.world.bodies, s.rules.hangers);
  const holder = count.side === null ? null : `${COLOUR[count.side]} holds ${count.points}`;
  return {
    game: "shuffleboard",
    seats: s.seats,
    me: seat,
    teams: s.seats > 2,
    phase: s.phase,
    turn: playing ? s.turn : null,
    table: {
      key: `shuffleboard/${s.hand}`,
      name: `Round ${s.hand}`,
      world: s.world,
      look: LOOK,
      bodies: s.world.bodies.map((b) => lookOf(b.id)),
      ghosts,
    },
    shoot: mine && shooting ? { body: shooting, minPower: MIN_POWER, maxPower: MAX_POWER, place: { y: LAUNCH, ...PLACE } } : null,
    last: s.last,
    card: null,
    choices: s.phase === "round" ? nextHandChoices(s.ready, seat, false, "Next round") : null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: seatLine(s, i),
      team: s.seats > 2 ? teamOf(i) : undefined,
      done: !playing,
      badge: playing && s.turn === i ? (s.thrown[0] + s.thrown[1] === PUCKS * 2 - 1 ? "The hammer" : "Sliding") : undefined,
    })),
    info: [`To ${s.rules.target}`, "Far end 3 · then 2 · then 1", ...(playing && holder ? [holder] : [])],
    narration: s.narration ?? (playing ? (mine ? `Put your ${COLOUR[side].toLowerCase()} puck on the line, aim and slide.` : null) : null),
    scores: [0, 1].map((t) => ({ seats: teamSeatsOf(s.seats, t), value: s.points[t]! })).filter((x) => x.seats.length),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.over ?? "Game over" } : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

/** How hard to slide so a puck stops `distance` away: the board slows it by `friction`, so it needs v² = 2·friction·distance. */
const powerFor = (distance: number) => (Math.sqrt(2 * SHUFFLEBOARD.friction * Math.max(0, distance)) / SHUFFLEBOARD.maxShotSpeed) * 1000;
const wrap = (a: number) => ((Math.round(a) % 36000) + 36000) % 36000;

function bot(s: ShuffleboardState, seat: number, style: PlayStyle, rand: () => number = Math.random): ShuffleboardMove | null {
  if (s.phase === "round") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const side = teamOf(seat);
  const id = nextPuck(s, side);
  if (!id) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2.2 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const on = s.world.bodies.filter((b) => live(b) && b.id !== id);
  const send = (at: number, angle: number, power: number): ShuffleboardMove => ({
    type: "shot",
    body: id,
    angle: wrap(angle + wobble() * (15 + (1 - skill) * 180) * slip),
    power: Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(power * (1 + wobble() * (0.012 + (1 - skill) * 0.09) * slip)))),
    at: Math.max(PLACE.min, Math.min(PLACE.max, Math.round(at))),
  });
  // The other side is ahead on the board: knock their best puck off, straight up the board from below it.
  const count = shuffleboardCount(s.world.bodies, s.rules.hangers);
  const theirs = on.filter((b) => sideOfPuck(b.id) !== side).sort((a, b) => a.y - b.y)[0];
  // Only one worth the trouble, though: a puck in the 1 is beaten by sliding past it.
  if (theirs && count.side !== null && count.side !== side && shuffleboardZone(theirs.y, s.rules.hangers) >= 2 && theirs.x >= PLACE.min && theirs.x <= PLACE.max) {
    const inTheWay = on.some((b) => b !== theirs && b.y > theirs.y && Math.abs(b.x - theirs.x) < 2 * R);
    if (!inTheWay) {
      // Enough to reach it and carry it off the end, with a little to spare.
      return send(theirs.x, angleTo({ x: theirs.x, y: LAUNCH }, theirs), powerFor(LAUNCH - theirs.y) * 1.22 + 40);
    }
  }
  // Otherwise lag one up the clearest lane to the middle of the 3.
  let lane = WIDE / 2;
  let room = -1;
  for (let x = PLACE.min + 300; x <= PLACE.max - 300; x += 300) {
    const clear = Math.min(...on.map((b) => Math.abs(b.x - x)), 4000) - Math.abs(x - WIDE / 2) / 20;
    if (clear > room) {
      room = clear;
      lane = x;
    }
  }
  return send(lane, 27000, powerFor(LAUNCH - Z3 / 2));
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): ShuffleboardRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ShuffleboardRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? shuffleboard15;
  return {
    id: base.id,
    name: base.name,
    target: TARGETS.includes(Number(given.target)) ? Number(given.target) : base.target,
    hangers: given.hangers === undefined ? base.hangers : given.hangers === true,
  };
}

const FIELDS: RuleField<ShuffleboardRules>[] = [
  { key: "target", label: "Points to win", hint: `No more than ${MOST_ROUNDS} rounds: whoever is ahead then wins.`, kind: "choice", options: TARGETS.map((t) => [String(t), String(t)]) },
  { key: "hangers", label: "Hangers score 4", hint: "A puck left hanging over the far edge is worth 4. Off: it is a 3 like any other.", kind: "toggle" },
];

export const shuffleboard: SportGame<ShuffleboardRules, ShuffleboardState, ShuffleboardMove> = {
  id: "shuffleboard",
  name: "Shuffleboard",
  emoji: "🥌",
  category: "sports",
  blurb: "Slide your pucks down the long board, and knock theirs off",
  tagline: "Four pucks each, slid in turn. Stop in the far zones, and send theirs off the end.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "A long, slick board with no rails. Red and blue have four pucks each and slide them in turn from the near end.",
      "Put your puck anywhere on the line, aim and slide. A puck that goes off the far end or a side is gone, and so is one that stops short of the foul line or is knocked back behind it.",
      `When all eight have been slid, only the side with the puck furthest down the board scores, for each of its pucks beyond the other side's best: 3 at the far end, then 2, then 1. A puck on a line counts for the lower zone.${r.hangers ? " One hanging over the far edge is worth 4." : ""}`,
      "Whoever scored slides first next round, so the other side has the last puck.",
      `First to ${r.target} wins.`,
      "Two players, or four as partners: the partners take turns with their side's pucks.",
    ];
  },
  newGame: newShuffleboard,
  apply,
  view,
  bot,
  thinkingTime: () => thinkFor(6, 1),
  summary(s) {
    const over = s.phase === "finished";
    const winners = s.winners ?? [];
    const [a, b] = s.points;
    return {
      game: "shuffleboard",
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
