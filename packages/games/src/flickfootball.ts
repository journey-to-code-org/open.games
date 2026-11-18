// Flick Football: the folded paper football of a school desk. Two players at the two ends of a
// table take turns flicking the one football from wherever it lies. A move is a flick; the physics
// core plays it to rest, and the rules here look at where it stopped.
//
// A touchdown is the football stopped hanging over the far edge: still on the table, with part of
// it over the end. That is 6, and a kick at the posts for 1 more. A football flicked off the table
// is a strike against whoever flicked it, and the other player kicks off from their own end; three
// strikes give the other player a kick at the posts for 3.
//
// The football is a disc as far as the physics goes: it slides and stops, and is off the table when
// its middle passes an edge.
import { PHYSICS_VERSION, simulate, type Body, type World } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { angleTo, restOf, type ShotMove, type SportBody, type SportGame, type SportLook, type SportShot, type SportView } from "./sport.js";
import { careless, clone, GameError, thinkFor, who, type BaseRules, type RuleField } from "./table.js";

// ---- The table ----------------------------------------------------------------------------------
// Lengths are tenths of a millimetre. The table runs up the screen: seat 0 sits at the bottom and
// scores at the top (y = 0), seat 1 the other way.

const WIDE = 4500;
const LONG = 9000;
const MID = WIDE / 2;
/** The football. */
const R = 260;
const BALL = "ball";
/** How far in from your own end a kickoff is taken, and how far along that line the football may be put. */
const KICKOFF = 700;
const PLACE = { min: 600, max: WIDE - 600 };
/** A kick at the posts is taken this far from them, from anywhere on a short line. */
const KICK_FROM = 5000;
const KICK_PLACE = { min: MID - 900, max: MID + 900 };
/** The posts: how far in from the end they stand, how far each is from the middle, and how thick. */
const POST_IN = 120;
const POST_OUT = 480;
const POST_R = 70;
const MIN_POWER = 50;
const MAX_POWER = 1000;
const STRIKES = 3;
/** No more flicks than this in a game, kicks at the posts aside. */
const MOST_FLICKS = 60;
const TARGETS = [14, 21, 35];

export const FLICK_FOOTBALL: World = {
  bounds: { x: 0, y: 0, w: WIDE, h: LONG },
  tickRate: 120,
  maxTicks: 2400,
  friction: 3500,
  restSpeed: 40,
  restitution: 0.6,
  wallRestitution: 0.5,
  maxShotSpeed: 9000,
  bodies: [],
  walls: [],
  pockets: [],
  regions: [],
};

type Side = 0 | 1;
const other = (side: Side) => (1 - side) as Side;
/** The end a side scores at, and the one it defends. */
const farY = (side: Side) => (side === 0 ? 0 : LONG);
const kickoffY = (side: Side) => (side === 0 ? LONG - KICKOFF : KICKOFF);
const kickY = (side: Side) => (side === 0 ? KICK_FROM : LONG - KICK_FROM);
const postY = (side: Side) => (side === 0 ? POST_IN : LONG - POST_IN);

/** Is a football lying at `y` a touchdown for `side`: on the table, and hanging over the end that side scores at? */
export function flickFootballTouchdown(y: number, side: 0 | 1): boolean {
  return side === 0 ? y >= 0 && y < R : y <= LONG && y > LONG - R;
}

// ---- Rules and state ---------------------------------------------------------------------------

export interface FlickFootballRules extends BaseRules {
  /** The score that wins. */
  target: number;
}

export const flickFootball21: FlickFootballRules = { id: "to21", name: "To 21", target: 21 };
export const flickFootball14: FlickFootballRules = { id: "to14", name: "Quick: to 14", target: 14 };
export const flickFootball35: FlickFootballRules = { id: "to35", name: "Long: to 35", target: 35 };
const PRESETS = [flickFootball21, flickFootball14, flickFootball35];

export interface FlickFootballState {
  game: "flickfootball";
  rules: FlickFootballRules;
  seats: 2;
  rng: number;
  hand: 1;
  dealer: 0;
  phase: "playing" | "finished";
  turn: number;
  /**
   * What the next shot is: a kickoff from your own end, a flick from where the football lies, or a
   * kick at the posts (after a touchdown for 1, after the other player's third strike for 3).
   */
  mode: "kickoff" | "flick" | "kick";
  /** What a kick at the posts is worth, while one is being taken. */
  worth: 0 | 1 | 3;
  /** The table at rest, as the next shot will find it. For a kick, the posts stand at the far end. */
  world: World;
  /** Times each player has flicked the football off the table since their last three. */
  strikes: [number, number];
  /** Flicks so far, kicks at the posts not counted. */
  flicks: number;
  shots: number;
  points: [number, number];
  last: SportShot | null;
  winners: number[] | null;
  narration: string | null;
  over: string | null;
}

export type FlickFootballMove = ShotMove;

const ball = (x: number, y: number): Body => ({ id: BALL, x, y, r: R });
const posts = (side: Side): Body[] => [
  { id: "post-l", x: MID - POST_OUT, y: postY(side), r: POST_R, fixed: true },
  { id: "post-r", x: MID + POST_OUT, y: postY(side), r: POST_R, fixed: true },
];

function kickoff(s: FlickFootballState, side: Side) {
  s.mode = "kickoff";
  s.worth = 0;
  s.turn = side;
  s.world = { ...FLICK_FOOTBALL, bodies: [ball(MID, kickoffY(side))] };
}

function kick(s: FlickFootballState, side: Side, worth: 1 | 3) {
  s.mode = "kick";
  s.worth = worth;
  s.turn = side;
  s.world = { ...FLICK_FOOTBALL, bodies: [ball(MID, kickY(side)), ...posts(side)] };
}

export function newFlickFootball(rules: FlickFootballRules, _seats: number, seed: number): FlickFootballState {
  const s: FlickFootballState = {
    game: "flickfootball",
    rules,
    seats: 2,
    rng: seed,
    hand: 1,
    dealer: 0,
    phase: "playing",
    turn: 0,
    mode: "kickoff",
    worth: 0,
    world: FLICK_FOOTBALL,
    strikes: [0, 0],
    flicks: 0,
    shots: 0,
    points: [0, 0],
    last: null,
    winners: null,
    narration: null,
    over: null,
  };
  kickoff(s, 0);
  s.narration = `${who(0)} to kick off.`;
  return s;
}

/** The game ends when someone has the target, or the flicks have run out. Returns true when it has. */
function finishIfDone(s: FlickFootballState, said: string): boolean {
  const [a, b] = s.points;
  const reached = Math.max(a, b) >= s.rules.target;
  if (!reached && s.flicks < MOST_FLICKS) return false;
  const lead = a === b ? null : a > b ? 0 : 1;
  s.phase = "finished";
  s.winners = lead === null ? [0, 1] : [lead];
  const how = reached ? "" : " That's the last flick.";
  s.over = lead === null ? `${said}${how} All square at ${a}.` : `${said}${how} ${who(lead)} wins, ${Math.max(a, b)} to ${Math.min(a, b)}!`;
  s.narration = s.over;
  return true;
}

function apply(state: FlickFootballState, seat: number, move: FlickFootballMove): FlickFootballState {
  if (seat !== 0 && seat !== 1) throw new GameError("That's not a seat at this table.");
  if (move?.type !== "shot") throw new GameError("That's not a move in Flick Football.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your flick.");
  if (move.body !== BALL) throw new GameError("You flick the football.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a flick: too soft or too hard.");
  if (move.spin !== undefined && move.spin !== 0) throw new GameError("There's no spin on a paper football.");
  const side = seat as Side;
  const s = clone(state);
  const it = s.world.bodies.find((b) => b.id === BALL)!;
  if (move.at !== undefined) {
    const line = s.mode === "kickoff" ? PLACE : s.mode === "kick" ? KICK_PLACE : null;
    if (!line) throw new GameError("The football is flicked from where it lies.");
    if (!Number.isInteger(move.at) || move.at < line.min || move.at > line.max) throw new GameError("Put the football down on the line.");
    it.x = move.at;
  }

  const before = s.world;
  const shot = { body: BALL, angle: move.angle, power: move.power };
  const played = simulate(before, shot);
  s.shots += 1;
  s.last = { n: s.shots, seat, shot, from: before.bodies, rest: restOf(played.world), ticks: played.ticks, physics: PHYSICS_VERSION };
  const at = played.world.bodies.find((b) => b.id === BALL)!;
  const me = who(seat);
  const them = other(side);

  if (s.mode === "kick") {
    // Good when it leaves the table over the far end, between the posts.
    const over = side === 0 ? at.y < 0 : at.y > LONG;
    const good = at.out !== undefined && over && Math.abs(at.x - MID) < POST_OUT;
    const worth = s.worth as 1 | 3;
    if (good) s.points[side] += worth;
    const said = good ? `${me}'s kick is good: ${worth === 1 ? "the extra point" : "3"}.` : `${me}'s kick ${at.out === undefined ? "falls short" : "is wide"}.`;
    // After the extra point the side scored on kicks off; after a kick for strikes, the side that struck out does. Either way: the other player.
    kickoff(s, them);
    if (finishIfDone(s, said)) return s;
    s.narration = `${said} ${who(them)} to kick off.`;
    return s;
  }

  s.flicks += 1;
  if (at.out !== undefined) {
    s.strikes[side] += 1;
    if (s.strikes[side] >= STRIKES) {
      s.strikes[side] = 0;
      const said = `${me} flicks it off the table: strike three.`;
      kick(s, them, 3);
      if (finishIfDone(s, said)) return s;
      s.narration = `${said} ${who(them)} kicks at the posts for 3.`;
      return s;
    }
    const said = `${me} flicks it off the table: strike ${s.strikes[side]}.`;
    kickoff(s, them);
    if (finishIfDone(s, said)) return s;
    s.narration = `${said} ${who(them)} to kick off.`;
    return s;
  }
  if (flickFootballTouchdown(at.y, side)) {
    s.points[side] += 6;
    const said = `Touchdown, ${me}! It hangs over the edge.`;
    // The extra point is always tried, even at the target: the game ends after it.
    kick(s, side, 1);
    s.narration = `${said} A kick at the posts for 1 more.`;
    return s;
  }
  s.mode = "flick";
  s.worth = 0;
  s.world = { ...FLICK_FOOTBALL, bodies: [ball(at.x, at.y)] };
  s.turn = them;
  const left = Math.abs(at.y - farY(side));
  const said = `${me} leaves it ${left < 900 ? "just short of" : left < LONG / 2 ? "in sight of" : "a long way from"} the edge.`;
  if (finishIfDone(s, said)) return s;
  s.narration = said;
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const lookOf = (id: string): SportBody =>
  id === BALL ? { id, owner: null, kind: "football", tone: "white", label: "the football", height: 60 } : { id, owner: null, kind: "post", tone: "gold", label: "a goal post", height: 1400 };

const line = (y: number) => ({ shape: { points: [[0, y - 20], [WIDE, y - 20], [WIDE, y + 20], [0, y + 20]] as [number, number][] }, surface: "soil" as const });
const LOOK: SportLook = {
  frame: { x: -500, y: -500, w: WIDE + 1000, h: LONG + 1000 },
  base: "felt",
  ground: [
    { shape: { points: [[0, 0], [WIDE, 0], [WIDE, LONG], [0, LONG]] }, surface: "wood" },
    // A touchdown is the football's middle past one of the end lines, and still on the table.
    line(R),
    line(LONG / 2),
    line(LONG - R),
  ],
  regions: [],
  rails: [],
  blocks: [],
  ledges: [],
  tunnels: [],
  pockets: "pocket",
  decor: [],
  marks: [
    { x: MID, y: 1500, text: "TOUCHDOWN ↑", size: 300 },
    { x: MID, y: LONG - 1500, text: "↓ TOUCHDOWN", size: 300 },
  ],
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function view(s: FlickFootballState, seat: number): SportView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const place = s.mode === "kickoff" ? { y: kickoffY(s.turn as Side), ...PLACE } : s.mode === "kick" ? { y: kickY(s.turn as Side), ...KICK_PLACE } : undefined;
  const todo = s.mode === "kickoff" ? "Kick off from your end." : s.mode === "kick" ? `Kick it between the posts for ${s.worth}.` : "Flick it so it stops hanging over the far edge.";
  return {
    game: "flickfootball",
    seats: 2,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing ? s.turn : null,
    table: {
      key: "flickfootball",
      name: s.mode === "kick" && playing ? (s.worth === 1 ? "Extra point" : "Field goal") : "Flick Football",
      world: s.world,
      look: LOOK,
      // The posts are described even when they are not standing: the last shot may have been a kick at them.
      bodies: [BALL, "post-l", "post-r"].map(lookOf),
      ghosts: [],
    },
    shoot: mine ? { body: BALL, minPower: MIN_POWER, maxPower: MAX_POWER, ...(place ? { place } : {}) } : null,
    last: s.last,
    card: null,
    choices: null,
    players: [0, 1].map((i) => ({
      line: `Scores at the ${i === 0 ? "top" : "bottom"}${s.strikes[i as Side] ? ` · ${plural(s.strikes[i as Side], "strike")}` : ""}`,
      done: !playing,
      badge: playing && s.turn === i ? (s.mode === "kick" ? "Kicking" : s.mode === "kickoff" ? "Kicking off" : "Flicking") : undefined,
    })),
    info: [`To ${s.rules.target}`, "Touchdown 6 · kick 1 · three strikes: a kick for 3", ...(playing ? [`${plural(Math.max(0, MOST_FLICKS - s.flicks), "flick")} left`] : [])],
    narration: s.narration ?? (mine ? todo : null),
    scores: [0, 1].map((t) => ({ seats: [t], value: s.points[t]! })),
    result: null,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.over ?? "Game over" } : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

const powerFor = (distance: number) => (Math.sqrt(2 * FLICK_FOOTBALL.friction * Math.max(0, distance)) / FLICK_FOOTBALL.maxShotSpeed) * 1000;
const wrap = (a: number) => ((Math.round(a) % 36000) + 36000) % 36000;

function bot(s: FlickFootballState, seat: number, style: PlayStyle, rand: () => number = Math.random): FlickFootballMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const side = seat as Side;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const it = s.world.bodies.find((b) => b.id === BALL)!;
  const clamp = (p: number) => Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(p)));
  if (s.mode === "kick") {
    // Straight up the middle, hard, a little off according to how good the player is.
    return { type: "shot", body: BALL, angle: wrap(angleTo(it, { x: MID, y: farY(side) }) + wobble() * (400 + (1 - skill) * 600) * slip), power: clamp(900 + wobble() * 60), at: MID };
  }
  // Straight down the table, to stop with its middle just short of the edge.
  const from = { x: s.mode === "kickoff" ? MID : it.x, y: it.y };
  const to = { x: Math.max(R, Math.min(WIDE - R, from.x)), y: side === 0 ? R * 0.45 : LONG - R * 0.45 };
  const reach = Math.abs(to.y - from.y);
  const move: FlickFootballMove = {
    type: "shot",
    body: BALL,
    angle: wrap(angleTo(from, to) + wobble() * (20 + (1 - skill) * 200) * slip),
    power: clamp(powerFor(reach) * (1 + wobble() * (0.04 + (1 - skill) * 0.08) * slip)),
  };
  if (s.mode === "kickoff") move.at = MID;
  return move;
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): FlickFootballRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<FlickFootballRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? flickFootball21;
  return { id: base.id, name: base.name, target: TARGETS.includes(Number(given.target)) ? Number(given.target) : base.target };
}

const FIELDS: RuleField<FlickFootballRules>[] = [
  { key: "target", label: "Points to win", hint: `No more than ${MOST_FLICKS} flicks: whoever is ahead then wins.`, kind: "choice", options: TARGETS.map((t) => [String(t), String(t)]) },
];

export const flickFootball: SportGame<FlickFootballRules, FlickFootballState, FlickFootballMove> = {
  id: "flickfootball",
  name: "Flick Football",
  emoji: "🏈",
  category: "sports",
  blurb: "Paper football: flick it so it stops hanging over their edge",
  tagline: "One folded football, two ends of a table. Hang it over the far edge for a touchdown.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "Two players at the two ends of a table take turns flicking one paper football from wherever it lies.",
      "A touchdown is the football stopped hanging over the far edge: still on the table, its middle past the end line. That is 6, and then a kick at the posts for 1 more.",
      "Flick it off the table and that's a strike against you: the other player kicks off from their own end. Three strikes, and they get a kick at the posts for 3.",
      "A kick is good when the football leaves the table between the posts.",
      `First to ${r.target} wins.`,
    ];
  },
  newGame: newFlickFootball,
  apply,
  view,
  bot,
  thinkingTime: () => thinkFor(5, 1),
  summary(s) {
    const over = s.phase === "finished";
    const winners = s.winners ?? [];
    const [a, b] = s.points;
    return {
      game: "flickfootball",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: `${a} to ${b}`,
      order: over ? [...winners, ...[0, 1].filter((i) => !winners.includes(i))] : null,
      winners: over ? winners : null,
      teams: false,
      seats: 2,
    };
  },
};
