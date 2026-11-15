// Bowling, for one to six players: the second game on the table-sports kit. Ten pins at the far end
// of a lane, ten frames, two balls a frame, a strike or a spare earns what the next ball or two
// knock down, and the highest score wins.
//
// The lane is a physics world seen from above, like Mini Golf's holes: the ball starts on the foul
// line and is struck at an angle and a power; pins are discs that knock into one another. The
// pieces are drawn bigger than a real alley's, so a phone shows what is going on, and the lane is
// shorter, but the spacing of the pins is a real one, and so is the order of play.
//
// A pin is down when it was moved from its spot, or knocked into a gutter or the pit. The pins that
// are standing when a ball has come to rest go back to their spots, so a wobble is no harm, and what
// is down is swept away (the second ball is bowled at the pins that are left). A ball that falls
// into a gutter goes no further, and neither does one that rolls into the pit: what it knocked on
// the way still counts. With bumpers on, the gutters are closed by rails along the lane, the way a
// children's lane is, and a ball bounces down the lane.
//
// Like Mini Golf, the room rebuilds a table by replaying the move log through `apply`, which
// simulates each ball again; the physics core is bit-for-bit deterministic (see minigolf.ts).
import { PHYSICS_VERSION, simulate, type Body, type Point, type Region, type Shape, type Wall, type World } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { angleTo, restOf, type ShotMove, type SportBlock, type SportBody, type SportCard, type SportGame, type SportLook, type SportShot, type SportTone, type SportView } from "./sport.js";
import { careless, clone, GameError, nextRandom, rankSeats, thinkFor, who, type BaseRules } from "./table.js";

export interface BowlingRules extends BaseRules {
  /** Frames in a game: ten, or five for a quick one. */
  frames: number;
  /** Rails along the lane: no gutter balls. */
  bumpers: boolean;
  /** The lane, by its id in LANES. Left out: the plain lane. */
  lane?: string;
}

export const tenFrames: BowlingRules = { id: "bowling-ten", name: "Ten frames", frames: 10, bumpers: false };
export const tenBumpers: BowlingRules = { id: "bowling-ten-bumpers", name: "Ten frames, bumpers up", frames: 10, bumpers: true };
export const fiveFrames: BowlingRules = { id: "bowling-five", name: "Quick five", frames: 5, bumpers: false };
export const fiveBumpers: BowlingRules = { id: "bowling-five-bumpers", name: "Quick five, bumpers up", frames: 5, bumpers: true };
const PRESETS = [tenFrames, tenBumpers, fiveFrames, fiveBumpers];

// ---- The lane -----------------------------------------------------------------------------------
// Tenths of a millimetre, as in the physics core's examples. y runs down the screen: the pins are at
// the top, and the ball is rolled up the lane (angle 27000, straight ahead).

export const PIN_R = 800;
export const BALL_R = 1300;
/** Half the lane's width: it runs from -LANE_HALF to LANE_HALF across. */
export const LANE_HALF = 5330;
/** The foul line, where the ball starts, and the head pin. */
export const FOUL_Y = 60000;
export const HEAD_Y = 0;
/** Where the pit begins, behind the last row. */
const PIT_Y = -9500;
const GUTTER = 3400;
const SPACING = 3048;
const ROW = 2640;
export const BOWL_MIN_POWER = 150;
export const BOWL_MAX_POWER = 1000;
/** A pin moved further than this from its spot is down. */
const DOWN = 1400;

/** The spots of the ten pins, numbered as they are said: 1 at the front, 7 to 10 across the back, 7 on the left. */
export const PIN_SPOTS: [number, number][] = (() => {
  const spots: [number, number][] = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) spots.push([(i - row / 2) * SPACING, HEAD_Y - row * ROW]);
  return spots.map(([x, y]) => [Math.round(x), y]);
})();

export const bowlingBallId = "ball";
export const pinId = (n: number) => `pin-${n}`;
const pinOfId = (id: string) => (id.startsWith("pin-") ? Number(id.slice(4)) : 0);

// ---- Lanes ------------------------------------------------------------------------------------
// A lane can have things on it between the foul line and the pins, the way a mini golf hole does:
// blocks the ball bounces off, toadstool bumpers that kick it, slopes that pull it, sand that slows
// it and water that takes it. The plain lane has none. A lane is found by its id in LANES, which is
// where a lane someone made is put (and where the game looks for `rules.lane`), as COURSES is for
// Mini Golf. Keep anything on a lane clear of the ball on the foul line and of the pin deck.

export interface BowlingLane {
  id: string;
  name: string;
  blocks?: { points: Point[]; kind: SportBlock["kind"]; height?: number }[];
  bumpers?: { at: Point; r?: number; kick?: number }[];
  slopes?: { shape: Shape; pull: Point }[];
  sand?: Shape[];
  water?: Shape[];
}

export const plainLane: BowlingLane = { id: "plain", name: "The lane" };
/** Every lane there is. */
export const LANES: BowlingLane[] = [plainLane];
export const laneOf = (id: unknown): BowlingLane => LANES.find((l) => l.id === id) ?? plainLane;
/** How a ball rolls through sand on a lane (the lane's own friction is the world's). */
const LANE_SAND = 30000;

const laneBumpers = (lane: BowlingLane): Body[] => (lane.bumpers ?? []).map((b, i) => ({ id: `toadstool-${i + 1}`, x: b.at[0], y: b.at[1], r: b.r ?? 380, fixed: true, kick: b.kick ?? 7000 }));
const laneWalls = (lane: BowlingLane): Wall[] => (lane.blocks ?? []).map((b, i) => ({ id: `block-${i + 1}`, closed: true, points: b.points }));
const laneRegions = (lane: BowlingLane): Region[] => [
  ...(lane.slopes ?? []).map((sl, i) => ({ id: `slope-${i + 1}`, shape: sl.shape, slope: sl.pull })),
  ...(lane.sand ?? []).map((shape, i) => ({ id: `sand-${i + 1}`, shape, friction: LANE_SAND })),
  ...(lane.water ?? []).map((shape, i) => ({ id: `water-${i + 1}`, shape, out: true })),
];

/** The lane as a physics world, with `standing` pins (by number, 1 to 10) and the ball ready on the foul line. */
export function laneWorld(standing: number[], rules: Pick<BowlingRules, "bumpers" | "lane">): World {
  const lane = laneOf(rules.lane);
  const bodies: Body[] = [{ id: bowlingBallId, x: 0, y: FOUL_Y, r: BALL_R, mass: 3.4, restitution: 0.75 }, ...laneBumpers(lane)];
  for (const n of [...standing].sort((a, b) => a - b)) bodies.push({ id: pinId(n), x: PIN_SPOTS[n - 1]![0], y: PIN_SPOTS[n - 1]![1], r: PIN_R, mass: 1.6, restitution: 0.5 });
  const edge = LANE_HALF;
  return {
    bounds: { x: -9000, y: PIT_Y - 2500, w: 18000, h: FOUL_Y + 4000 - PIT_Y + 2500 },
    tickRate: 120,
    maxTicks: 1800,
    friction: 9000,
    restSpeed: 250,
    restitution: 0.7,
    wallRestitution: 0.45,
    maxShotSpeed: 80000,
    bodies,
    walls: rules.bumpers
      ? [
          { id: "bumper-left", points: [[-edge, FOUL_Y + 3000], [-edge, PIT_Y]] },
          { id: "bumper-right", points: [[edge, FOUL_Y + 3000], [edge, PIT_Y]] },
          ...laneWalls(lane),
        ]
      : laneWalls(lane),
    pockets: [],
    regions: [
      { id: "gutter-left", shape: { points: [[-edge - GUTTER, FOUL_Y + 3000], [-edge, FOUL_Y + 3000], [-edge, PIT_Y], [-edge - GUTTER, PIT_Y]] }, out: true },
      { id: "gutter-right", shape: { points: [[edge, FOUL_Y + 3000], [edge + GUTTER, FOUL_Y + 3000], [edge + GUTTER, PIT_Y], [edge, PIT_Y]] }, out: true },
      { id: "pit", shape: { points: [[-edge - GUTTER, PIT_Y], [edge + GUTTER, PIT_Y], [edge + GUTTER, PIT_Y - 2400], [-edge - GUTTER, PIT_Y - 2400]] }, out: true },
      ...laneRegions(lane),
    ],
  };
}

const LOOK = (rules: Pick<BowlingRules, "bumpers" | "lane">, lane = laneOf(rules.lane)): SportLook => ({
  frame: { x: -LANE_HALF - GUTTER - 700, y: PIT_Y - 1500, w: 2 * (LANE_HALF + GUTTER + 700), h: FOUL_Y + 4000 - PIT_Y + 1500 },
  base: "paving",
  ground: [{ shape: { points: [[-LANE_HALF - GUTTER, PIT_Y], [LANE_HALF + GUTTER, PIT_Y], [LANE_HALF + GUTTER, FOUL_Y + 3000], [-LANE_HALF - GUTTER, FOUL_Y + 3000]] }, surface: "deck" },
    { shape: { points: [[-LANE_HALF, PIT_Y], [LANE_HALF, PIT_Y], [LANE_HALF, FOUL_Y + 3000], [-LANE_HALF, FOUL_Y + 3000]] }, surface: "lane" },
    ...(lane.sand ?? []).map((shape) => ({ shape, surface: "sand" as const })),
    ...(lane.water ?? []).map((shape) => ({ shape, surface: "water" as const })),
  ],
  regions: [
    { id: "pit", surface: "soil" },
    ...laneRegions(lane).map((r) => ({ id: r.id, surface: r.out ? ("water" as const) : r.slope ? ("slope" as const) : ("sand" as const) })),
  ],
  rails: rules.bumpers
    ? [
        { wall: "bumper-left", material: "timber", side: "left", width: 900, height: 600 },
        { wall: "bumper-right", material: "timber", side: "right", width: 900, height: 600 },
      ]
    : [],
  blocks: (lane.blocks ?? []).map((b, i) => ({ wall: `block-${i + 1}`, kind: b.kind, height: b.height ?? 500 })),
  ledges: [],
  tunnels: [],
  pockets: "pocket",
  decor: [],
});

// ---- State --------------------------------------------------------------------------------------

export interface BowlingState {
  game: "bowling";
  rules: BowlingRules;
  seats: number;
  rng: number;
  physics: number;
  /** The seat that bowls first in every frame. */
  first: number;
  /** The frame being bowled, from 0. */
  frame: number;
  /** Whose ball it is. */
  turn: number;
  /** The pins standing now, by number. */
  standing: number[];
  /** What the current frame's balls have knocked down, in order. */
  cur: number[];
  /** Every ball each seat has bowled, as the pins it knocked down. */
  rolls: number[][];
  shots: number;
  last: SportShot | null;
  phase: "playing" | "finished";
  narration: string | null;
}

export type BowlingMove = ShotMove;

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** How many balls the frame being bowled lets a seat have, given what it has knocked down so far. */
function ballsAllowed(frames: number, frame: number, cur: number[]): number {
  if (frame < frames - 1) return cur[0] === 10 ? 1 : 2;
  return cur[0] === 10 || (cur.length >= 2 && cur[0]! + cur[1]! === 10) ? 3 : 2;
}

/** The score of each frame as far as it is known (null while a bonus is still to be bowled), and the running total. */
export function frameScores(rolls: number[], frames: number): { marks: string[]; totals: (number | null)[] } {
  const marks: string[] = [];
  const totals: (number | null)[] = [];
  let i = 0;
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    const a = rolls[i];
    if (a === undefined) {
      marks.push("");
      totals.push(null);
      continue;
    }
    const b = rolls[i + 1];
    const c = rolls[i + 2];
    const last = f === frames - 1;
    const mark = (n: number | undefined, prev?: number) => (n === undefined ? "" : n === 10 ? "X" : prev !== undefined && prev + n === 10 ? "/" : n === 0 ? "-" : String(n));
    if (last) {
      const parts = [mark(a), b === undefined ? "" : a === 10 ? mark(b) : mark(b, a), c === undefined ? "" : b === 10 || a + (b ?? 0) !== 10 ? mark(c) : mark(c)];
      marks.push(parts.join(""));
      const need = a === 10 || (b !== undefined && a + b === 10) ? 3 : 2;
      const have = [a, b, c].filter((n) => n !== undefined).length;
      if (have >= need) {
        sum += (a ?? 0) + (b ?? 0) + (need === 3 ? (c ?? 0) : 0);
        totals.push(sum);
      } else totals.push(null);
      break;
    }
    if (a === 10) {
      marks.push("X");
      i += 1;
      if (b !== undefined && c !== undefined) {
        sum += 10 + b + c;
        totals.push(sum);
      } else totals.push(null);
    } else {
      marks.push(b === undefined ? mark(a) : mark(a) + mark(b, a));
      if (b === undefined) totals.push(null);
      else if (a + b === 10) {
        const next = rolls[i + 2];
        if (next === undefined) totals.push(null);
        else {
          sum += 10 + next;
          totals.push(sum);
        }
      } else {
        sum += a + b;
        totals.push(sum);
      }
      i += 2;
    }
  }
  while (totals.length < frames) {
    marks.push("");
    totals.push(null);
  }
  return { marks, totals };
}

/** What a seat has so far: the last known running total (balls whose bonus isn't bowled yet are counted as they stand). */
export function scoreOf(s: Pick<BowlingState, "rolls" | "rules">, seat: number): number {
  const { frames } = s.rules;
  const rolls = s.rolls[seat]!;
  let i = 0;
  let sum = 0;
  for (let f = 0; f < frames && i < rolls.length; f++) {
    if (f === frames - 1) {
      sum += rolls.slice(i, i + 3).reduce((n, v) => n + v, 0);
      break;
    }
    if (rolls[i] === 10) {
      sum += 10 + (rolls[i + 1] ?? 0) + (rolls[i + 2] ?? 0);
      i += 1;
    } else {
      const two = (rolls[i] ?? 0) + (rolls[i + 1] ?? 0);
      sum += two + (two === 10 ? (rolls[i + 2] ?? 0) : 0);
      i += 2;
    }
  }
  return sum;
}

export function newBowling(rules: BowlingRules, seats: number, seed: number): BowlingState {
  const s = { game: "bowling", rules, seats, rng: seed >>> 0, physics: PHYSICS_VERSION, first: 0, frame: 0, turn: 0, standing: [...ALL], cur: [], rolls: Array.from({ length: seats }, () => []), shots: 0, last: null, phase: "playing", narration: null } as BowlingState;
  s.first = Math.floor(nextRandom(s)() * seats);
  s.turn = s.first;
  return s;
}

/** The order seats bowl each frame in: from the seat that started, round the table. */
const orderOf = (s: Pick<BowlingState, "seats" | "first">) => Array.from({ length: s.seats }, (_, i) => (s.first + i) % s.seats);

// ---- Moves --------------------------------------------------------------------------------------

const pinsWord = (n: number) => `${n} pin${n === 1 ? "" : "s"}`;

/** The pins a ball left down, from where the physics came to rest. */
export function pinsDown(world: World): number[] {
  const down: number[] = [];
  for (const b of world.bodies) {
    const n = pinOfId(b.id);
    if (!n) continue;
    const [x, y] = PIN_SPOTS[n - 1]!;
    if (b.pocketed !== undefined || b.out !== undefined || Math.abs(b.x - x) > DOWN || Math.abs(b.y - y) > DOWN) down.push(n);
  }
  return down;
}

function apply(state: BowlingState, seat: number, move: BowlingMove): BowlingState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type !== "shot") throw new GameError("That's not a move in Bowling.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your ball.");
  if (move.body !== bowlingBallId) throw new GameError("That's not the ball.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < BOWL_MIN_POWER || move.power > BOWL_MAX_POWER) throw new GameError("That's not a roll: too soft or too hard.");

  const s = clone(state);
  const before = laneWorld(s.standing, s.rules);
  const shot = { body: bowlingBallId, angle: move.angle, power: move.power };
  const played = simulate(before, shot);
  s.shots += 1;
  s.last = { n: s.shots, seat, shot, from: before.bodies, rest: restOf(played.world), ticks: played.ticks, physics: PHYSICS_VERSION };

  const down = pinsDown(played.world);
  const knocked = down.length;
  const gutter = played.world.bodies.find((b) => b.id === bowlingBallId)?.out;
  s.standing = s.standing.filter((n) => !down.includes(n));
  s.rolls[seat]!.push(knocked);
  s.cur.push(knocked);

  const clean = s.standing.length === 0;
  const strike = clean && s.cur.length === 1;
  const spare = clean && s.cur.length === 2 && s.cur[0]! < 10;
  s.narration = strike
    ? `${who(seat)} bowls a strike!`
    : spare
      ? `${who(seat)} picks up the spare`
      : knocked === 0
        ? `${who(seat)} ${gutter && gutter.startsWith("gutter") ? "rolls it in the gutter" : "misses every pin"}`
        : `${who(seat)} knocks down ${pinsWord(knocked)}`;

  if (s.cur.length >= ballsAllowed(s.rules.frames, s.frame, s.cur)) {
    // The frame is over: the pins are set up again, and the next seat steps up.
    s.cur = [];
    s.standing = [...ALL];
    const order = orderOf(s);
    const at = order.indexOf(seat);
    if (at + 1 < order.length) s.turn = order[at + 1]!;
    else if (s.frame + 1 >= s.rules.frames) s.phase = "finished";
    else {
      s.frame += 1;
      s.turn = s.first;
    }
  } else if (clean) {
    // In the last frame, a strike or a spare brings the pins back for the fill ball.
    s.standing = [...ALL];
  }
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: SportTone[] = ["red", "blue", "gold", "green", "purple", "orange"];
const ballLook = (seat: number): SportBody => ({ id: bowlingBallId, owner: seat, kind: "ball", tone: TONES[seat % TONES.length]!, label: `${who(seat)}'s ball` });
const bumperLook = (b: Body): SportBody => ({ id: b.id, owner: null, kind: "toadstool", tone: "red", label: "a toadstool", height: 640 });
const pinLook = (n: number): SportBody => ({ id: pinId(n), owner: null, kind: "pin", tone: "white", label: `pin ${n}`, mark: String(n), height: 3800 });

const winnersOf = (s: BowlingState) => {
  const totals = Array.from({ length: s.seats }, (_, i) => scoreOf(s, i));
  const best = Math.max(...totals);
  return totals.flatMap((t, seat) => (t === best ? [seat] : []));
};

function cardOf(s: BowlingState): SportCard {
  const { frames } = s.rules;
  const sheets = Array.from({ length: s.seats }, (_, seat) => frameScores(s.rolls[seat]!, frames));
  return {
    title: "Bowling",
    columns: Array.from({ length: frames }, (_, i) => ({ label: String(i + 1) })),
    current: s.phase === "finished" ? null : s.frame,
    rows: sheets.map((sheet, seat) => ({
      seat,
      cells: sheet.marks.map((m, f) => (m ? (sheet.totals[f] !== null ? `${m} ${sheet.totals[f]}` : m) : "")),
      total: String(scoreOf(s, seat)),
    })),
    totalLabel: "Score",
  };
}

function overTitle(s: BowlingState, winners: number[]): string {
  const score = scoreOf(s, winners[0]!);
  if (s.seats === 1) return `Game over: ${score}`;
  if (winners.length > 1) return `It's a tie at ${score}!`;
  return `${who(winners[0]!)} wins with ${score}!`;
}

function view(s: BowlingState, seat: number): SportView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const balls = s.cur.length + 1;
  const winners = playing ? [] : winnersOf(s);
  return {
    game: "bowling",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing ? s.turn : null,
    table: {
      key: `lane/${s.rules.bumpers ? "bumpers" : "open"}${s.rules.lane && s.rules.lane !== plainLane.id ? `/${s.rules.lane}` : ""}`,
      name: playing ? `Frame ${s.frame + 1}, ball ${balls}` : "The lane",
      world: laneWorld(s.standing, s.rules),
      look: LOOK(s.rules),
      bodies: [...laneBumpers(laneOf(s.rules.lane)).map(bumperLook), ballLook(playing ? s.turn : (s.last?.seat ?? 0)), ...ALL.map(pinLook)],
      ghosts: [],
    },
    shoot: mine ? { body: bowlingBallId, minPower: BOWL_MIN_POWER, maxPower: BOWL_MAX_POWER } : null,
    last: s.last,
    card: cardOf(s),
    choices: null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: `${scoreOf(s, i)}`,
      body: { ...ballLook(i), id: `ball-${i}` },
      done: !playing,
      badge: playing && s.turn === i ? "Up" : undefined,
    })),
    info: playing ? [`Frame ${s.frame + 1} of ${s.rules.frames}`, `${s.standing.length} pin${s.standing.length === 1 ? "" : "s"} standing`] : [],
    narration: s.narration ?? (playing ? "Pull back and let go. Aim for the pocket, just off the head pin." : null),
    scores: Array.from({ length: s.seats }, (_, i) => ({ seats: [i], value: scoreOf(s, i) })),
    result: null,
    over: playing ? null : { winners, title: overTitle(s, winners) },
  };
}

// ---- The computer player ------------------------------------------------------------------------
// A computer player does what a bowler does: it picks where to send the ball. It tries a spread of
// aims and strengths in its head (the simulation is quick: a few dozen balls) and keeps the one that
// knocks down the most pins, preferring a harder ball when two are as good, since a pin that is
// hit properly goes further. What makes a persona is how well it then delivers it: the aim and the
// strength are nudged off by an amount that grows as skill drops, and a careless moment is a bigger slip.

export interface Roll {
  angle: number;
  power: number;
  /** How many pins it expects to knock down. */
  pins: number;
}
const wrap = (angle: number) => ((Math.round(angle) % 36000) + 36000) % 36000;
const clampPower = (power: number) => Math.min(BOWL_MAX_POWER, Math.max(BOWL_MIN_POWER, Math.round(power)));
const thoughts = new Map<string, Roll>();
const TARGETS = Array.from({ length: 23 }, (_, i) => -5500 + i * 500);
const POWERS = [600, 780, 960];
const WIDE = Array.from({ length: 16 }, (_, i) => (i < 8 ? -1 : 1) * (7000 + (i % 8) * 2500));

/** The best ball from the foul line at these pins that a search can find: what a perfect bowler would roll. */
export function bestRoll(standing: number[], rules: Pick<BowlingRules, "bumpers" | "lane">): Roll {
  const lane = laneOf(rules.lane);
  const key = `${standing.join(",")}/${rules.bumpers}/${lane.id}`;
  const known = thoughts.get(key);
  if (known) return known;
  const world = laneWorld(standing, rules);
  let best: Roll = { angle: 27000, power: 780, pins: -1 };
  let bestScore = -Infinity;
  const toward = (x: number, y: number) => angleTo({ x: 0, y: FOUL_Y }, { x, y });
  // On a lane with things on it, the straight balls may all be in the way of something: look wider,
  // at balls sent off to the side to come back off a bumper, a block or a slope.
  const targets = lane === plainLane ? TARGETS : [...TARGETS, ...WIDE];
  for (const tx of targets) {
    for (const power of POWERS) {
      const angle = toward(tx, HEAD_Y);
      const down = pinsDown(simulate(world, { body: bowlingBallId, angle, power }).world);
      // Pins knocked is what counts; all else equal, a ball that is still on the lane and harder is steadier.
      const score = down.length * 100 + power / 20 - Math.min(Math.abs(tx), 5500) / 400;
      if (score > bestScore) {
        bestScore = score;
        best = { angle, power, pins: down.length };
      }
    }
  }
  if (thoughts.size > 400) thoughts.clear();
  thoughts.set(key, best);
  return best;
}

/** The most a computer player's aim (hundredths of a degree) and strength (a share of it) can be off: at full skill, and how much more at none. */
export const BOWL_AIM_SLIP = [18, 130] as const;
export const BOWL_POWER_SLIP = [0.05, 0.3] as const;

function bot(s: BowlingState, seat: number, style: PlayStyle, rand: () => number = Math.random): BowlingMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const ideal = bestRoll(s.standing, s.rules);
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2.5 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const angle = wrap(ideal.angle + wobble() * (BOWL_AIM_SLIP[0] + (1 - skill) * BOWL_AIM_SLIP[1]) * slip);
  const power = clampPower(ideal.power * (1 + wobble() * (BOWL_POWER_SLIP[0] + (1 - skill) * BOWL_POWER_SLIP[1]) * slip));
  return { type: "shot", body: bowlingBallId, angle, power };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): BowlingRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BowlingRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? tenFrames;
  const r = { ...base, ...given };
  const lane = typeof r.lane === "string" && r.lane && r.lane !== plainLane.id ? { lane: r.lane.slice(0, 80) } : {};
  return { id: String(r.id), name: String(r.name), frames: Number(r.frames) === 5 ? 5 : 10, bumpers: r.bumpers === true, ...lane };
}

export const bowling: SportGame<BowlingRules, BowlingState, BowlingMove> = {
  id: "bowling",
  name: "Bowling",
  emoji: "🎳",
  blurb: "Ten pins, ten frames: strikes, spares and a score sheet",
  tagline: "Pull back, let go, and knock them all down. Strikes and spares earn bonus pins; the highest score wins.",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "frames", label: "Frames", kind: "choice", options: [[10, "Ten (a full game)"], [5, "Five (a quick one)"]] },
    { key: "bumpers", label: "Bumpers up", kind: "toggle", hint: "Rails along the lane close the gutters: the ball bounces down the lane instead of dropping out." },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `${r.frames} frames. In each, you roll up to two balls at the ten pins; the pins left standing after your first ball stay for the second.`,
      "Pull back from the ball and let go: the further you pull, the harder it goes. Aim just off the head pin, the front pin, to send the pins into each other.",
      "A strike (all ten with the first ball) scores ten plus your next two balls; a spare (all ten with two) scores ten plus your next ball. Otherwise, a frame scores the pins knocked down.",
      `In the last frame a strike or a spare earns more balls: ${r.frames === 10 ? "up to three" : "up to three"}, with the pins set up again.`,
      r.bumpers ? "Bumpers are up, so there are no gutter balls." : "A ball in the gutter knocks nothing down, unless it already hit something.",
      ...(laneOf(r.lane) !== plainLane ? [`This is ${laneOf(r.lane).name}: there are things on the lane to roll round, off or over. Sand slows the ball, water takes it, and a slope pulls it.`] : []),
      "The highest score wins.",
    ];
  },
  newGame: newBowling,
  apply,
  view,
  bot,
  heavy: (s, seat) => s.phase === "playing" && s.turn === seat,
  thinkingTime(s) {
    if (s.phase !== "playing") return 500;
    const rolling = s.last ? Math.round((s.last.ticks * 1000) / 120) : 0;
    return rolling + thinkFor(3, 0.9);
  },
  warmUp() {
    for (const rules of [tenFrames, tenBumpers]) bestRoll([...ALL], rules);
  },
  summary(s) {
    const over = s.phase === "finished";
    const seats = Array.from({ length: s.seats }, (_, i) => i);
    return {
      game: "bowling",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.frame + 1,
      scoreLine: seats.map((i) => scoreOf(s, i)).join(" · "),
      order: over ? rankSeats(seats.map((i) => ({ seats: [i], score: scoreOf(s, i) }))) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
