// Billiards on a nine-foot pool table: eight-ball and nine-ball, for two, or four as partners. A
// move is a shot at the cue ball; the physics core plays it to rest, and the rules here look at what
// happened: what the cue ball touched first, which balls dropped, whether anything reached a rail.
//
// Eight-ball. Fifteen balls are racked with the 8 in the middle. After the break the table is open;
// the first ball a player sinks gives them solids (1 to 7) or stripes (9 to 15) and the other side
// the rest. Sink all of yours, then the 8, to win. Sink the 8 early, or with a foul, and you lose.
// Nine-ball. Nine balls in a diamond. Hit the lowest numbered ball first every time; sink the 9
// at any point, with a clean shot, to win.
//
// A foul (the cue ball dropped, hit nothing, hit the wrong ball first, or nothing reached a rail
// after the first touch) gives the other side the cue ball in hand: they put it down on the long
// centre line, anywhere (or only behind the head string, in the rules that say so).
//
// House rules: call your shot (name a ball and a pocket, or it doesn't count), whether a foul is
// ball in hand, and what a scratch costs when you're shooting at the eight.
import { PHYSICS_VERSION, POOL_TABLE, simulate, type Body, type World } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { angleTo, restOf, type ShotMove, type SportBody, type SportGame, type SportLook, type SportShot, type SportTone, type SportView } from "./sport.js";
import { careless, clone, GameError, nextRandom, shuffled, thinkFor, who, type BaseRules, type RuleField } from "./table.js";

// ---- The table ---------------------------------------------------------------------------------

const R = 286; // a pool ball's radius, in tenths of a millimetre
const LENGTH = 25400;
const WIDTH = 12700;
const MID_Y = 6350;
const HEAD_X = 6350; // the head string, and the head spot
const FOOT_X = 19050; // the foot spot, where the rack's apex goes
const ROW = 496; // the distance between rows of a rack
const MIN_POWER = 50;
const MAX_POWER = 1000;
const BREAK_POWER_MIN = 50;
/** The cue ball's reach along the centre line: clear of the cushions. */
const REACH = { min: 700, max: 24700 };
const CUE = "cue";
/** After this many shots the game is called, and whoever has sunk more wins (so a pair of poor shots can't go on for ever). */
const SHOT_LIMIT = 150;

/** One ball's spot in a rack, as how many rows back it is and how far off the centre line. */
const triangle = (rows: number): { x: number; y: number }[] =>
  Array.from({ length: rows }, (_, k) => Array.from({ length: k + 1 }, (_, j) => ({ x: FOOT_X + k * ROW, y: MID_Y + (2 * j - k) * R }))).flat();
const DIAMOND = [
  [0, 0],
  [1, -1],
  [1, 1],
  [2, -2],
  [2, 0],
  [2, 2],
  [3, -1],
  [3, 1],
  [4, 0],
].map(([k, j]) => ({ x: FOOT_X + k! * ROW, y: MID_Y + j! * R }));

export type BilliardsKind = "eight" | "nine";
const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];
type Group = "solids" | "stripes";
const groupOf = (n: number): Group | null => (n >= 1 && n <= 7 ? "solids" : n >= 9 && n <= 15 ? "stripes" : null);

const ballNumber = (id: string) => (id === CUE ? 0 : Number(id));
const isBall = (b: Body) => b.id !== CUE;
const live = (b: Body) => b.pocketed === undefined && b.out === undefined;

/** The balls a game racks, in the order of its rack's spots, laid out for a seed. */
function rack(kind: BilliardsKind, s: { rng: number }): Body[] {
  const rand = nextRandom(s);
  const make = (n: number, p: { x: number; y: number }): Body => ({ id: String(n), x: p.x, y: p.y, r: R });
  if (kind === "nine") {
    const rest = shuffled([2, 3, 4, 5, 6, 7, 8], rand);
    // 1 at the apex and 9 in the middle; the rest at random.
    const order = [1, rest[0]!, rest[1]!, rest[2]!, 9, rest[3]!, rest[4]!, rest[5]!, rest[6]!];
    return order.map((n, i) => make(n, DIAMOND[i]!));
  }
  const spots = triangle(5);
  // The 8 is in the middle of the third row (spot 4); the back corners (spots 10 and 14) are one solid and one stripe.
  const others = shuffled([...SOLIDS, ...STRIPES], rand);
  const order = [...others.slice(0, 4), 8, ...others.slice(4)];
  const mixed = () => groupOf(order[10]!) !== groupOf(order[14]!);
  if (!mixed()) {
    const want = groupOf(order[10]!) === "solids" ? "stripes" : "solids";
    const swap = order.findIndex((n, i) => i !== 4 && i !== 10 && i !== 14 && i > 0 && groupOf(n) === want);
    [order[14], order[swap]] = [order[swap]!, order[14]!];
  }
  return order.map((n, i) => make(n, spots[i]!));
}

/** The cue ball's spot for a break: on the head spot. */
const headSpot = (): Body => ({ id: CUE, x: HEAD_X, y: MID_Y, r: R });

/** Whether a ball of radius R fits at (x, y) clear of every ball that's in play. */
const fits = (bodies: Body[], x: number, y: number, except?: string) => bodies.every((b) => b.id === except || !live(b) || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 2) ** 2);

/** The nearest clear spot on the centre line to `from`, looking towards `dir` first (1: the foot rail, -1: the head rail). */
function clearSpot(bodies: Body[], from: number, dir: 1 | -1, except?: string): number {
  for (let k = 0; k < 2 * 1000; k++) {
    for (const d of [dir, -dir]) {
      const x = from + d * k * 20;
      if (x >= REACH.min && x <= REACH.max && fits(bodies, x, MID_Y, except)) return x;
    }
  }
  return from;
}

// ---- Rules and state ---------------------------------------------------------------------------

export interface BilliardsRules extends BaseRules {
  game: BilliardsKind;
  /** Eight-ball: name a ball and a pocket, or the shot doesn't count. */
  call: boolean;
  /** After a foul, the next player may put the cue ball anywhere (otherwise only behind the head string). */
  ballInHand: boolean;
  /** Eight-ball: a scratch while shooting at the eight loses the game (otherwise it is an ordinary foul). */
  eightScratch: "lose" | "foul";
}

export const eightBall: BilliardsRules = { id: "eight", name: "Eight-ball", game: "eight", call: false, ballInHand: true, eightScratch: "lose" };
export const eightBallCalled: BilliardsRules = { id: "called", name: "Eight-ball, call your shot", game: "eight", call: true, ballInHand: true, eightScratch: "lose" };
export const nineBall: BilliardsRules = { id: "nine", name: "Nine-ball", game: "nine", call: false, ballInHand: true, eightScratch: "foul" };
const PRESETS = [eightBall, eightBallCalled, nineBall];

export interface BilliardsState {
  game: "billiards";
  rules: BilliardsRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "finished";
  turn: number;
  /** The table at rest, as the next shot will find it. */
  world: World;
  /** Which group each side shoots at, once the table is closed (eight-ball). */
  groups: [Group | null, Group | null];
  /** The cue ball is the shooter's to place (after a foul), and where they may. */
  inHand: boolean;
  breaking: boolean;
  /** Who shoots next for each side, so partners take turns. */
  rot: [number, number];
  /** Balls each side has sunk, for the final say when the shot limit is hit. */
  potted: [number, number];
  shots: number;
  last: SportShot | null;
  winners: number[] | null;
  narration: string | null;
  over: string | null;
}

export type BilliardsMove = ShotMove;

const teamOf = (seat: number) => (seat % 2) as 0 | 1;
const teamSeatsOf = (seats: number, team: number) => Array.from({ length: seats }, (_, i) => i).filter((i) => teamOf(i) === team);

export function newBilliards(rules: BilliardsRules, seats: number, seed: number): BilliardsState {
  const s = { game: "billiards", rules, seats, rng: seed, hand: 1, dealer: 0, phase: "playing", turn: 0, groups: [null, null], inHand: true, breaking: true, rot: [1, 0], potted: [0, 0], shots: 0, last: null, winners: null, narration: null, over: null } as unknown as BilliardsState;
  s.world = { ...POOL_TABLE, bodies: [headSpot(), ...rack(rules.game, s)] };
  s.narration = `${who(0)} to break.`;
  return s;
}

const bodiesOf = (w: World) => w.bodies.filter(isBall);
const liveBalls = (w: World) => bodiesOf(w).filter(live);

/** The balls a side may hit first, and what it has left to sink. */
function targets(s: BilliardsState, team: 0 | 1): number[] {
  const left = liveBalls(s.world).map((b) => ballNumber(b.id));
  if (s.rules.game === "nine") return [Math.min(...left)];
  const g = s.groups[team];
  if (!g) return left.filter((n) => n !== 8);
  const mine = left.filter((n) => groupOf(n) === g);
  return mine.length ? mine : left.includes(8) ? [8] : [];
}

/** Where the cue ball may be put, when it is in hand. */
function placement(s: BilliardsState): { y: number; min: number; max: number } {
  const behind = s.breaking || !s.rules.ballInHand;
  return { y: MID_Y, min: REACH.min, max: behind ? HEAD_X : REACH.max };
}

function pocketOf(events: { type: string; body?: string; pocket?: string }[], id: string): string | undefined {
  return events.find((e) => e.type === "pocket" && e.body === id)?.pocket;
}

function apply(state: BilliardsState, seat: number, move: BilliardsMove): BilliardsState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type !== "shot") throw new GameError("That's not a move in Billiards.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your shot.");
  if (move.body !== CUE) throw new GameError("You shoot the cue ball.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a shot: too soft or too hard.");
  if (move.spin !== undefined && move.spin !== 0) throw new GameError("There's no spin on this table.");
  const s = clone(state);
  const bodies = s.world.bodies;
  const cue = bodies.find((b) => b.id === CUE)!;
  if (move.at !== undefined) {
    const place = s.inHand ? placement(s) : null;
    if (!place) throw new GameError("The cue ball is where it stopped: you can't move it.");
    if (!Number.isInteger(move.at) || move.at < place.min || move.at > place.max) throw new GameError(s.breaking ? "Break from behind the head string." : "Put the cue ball on the table, " + (s.rules.ballInHand ? "clear of the cushions." : "behind the head string."));
    if (!fits(bodies, move.at, MID_Y, CUE)) throw new GameError("There's a ball in the way: put the cue ball down somewhere clear.");
    cue.x = move.at;
    cue.y = MID_Y;
  }
  // A call, in the rules that ask for one.
  let call: { ball: string; pocket: string } | null = null;
  if (s.rules.call && s.rules.game === "eight" && move.call) {
    const c = move.call as { ball?: unknown; pocket?: unknown };
    const ball = bodiesOf(s.world).find((b) => b.id === c.ball);
    if (!ball || !live(ball)) throw new GameError("Call a ball that is on the table.");
    if (!s.world.pockets.some((p) => p.id === c.pocket)) throw new GameError("Call one of the six pockets.");
    call = { ball: ball.id, pocket: String(c.pocket) };
  }

  const team = teamOf(seat);
  const before = s.world;
  const want = targets(s, team);
  const shooting8 = s.rules.game === "eight" && want.length === 1 && want[0] === 8;
  const shot = { body: CUE, angle: move.angle, power: move.power };
  const played = simulate(before, shot);
  s.shots += 1;
  s.last = { n: s.shots, seat, shot, from: before.bodies, rest: restOf(played.world), ticks: played.ticks, physics: PHYSICS_VERSION };

  const after = played.world.bodies;
  const was = (id: string) => before.bodies.find((x) => x.id === id)!;
  const sunk = after.filter((b) => isBall(b) && b.pocketed !== undefined && was(b.id).pocketed === undefined).map((b) => ballNumber(b.id));
  // Sunk in the order they dropped.
  const dropOrder = played.events.filter((e) => e.type === "pocket").map((e) => ballNumber((e as { body: string }).body));
  sunk.sort((a, b) => dropOrder.indexOf(a) - dropOrder.indexOf(b));
  const scratch = after.find((b) => b.id === CUE)!.pocketed !== undefined;
  const flew = after.filter((b) => b.out !== undefined && was(b.id).out === undefined).map((b) => b.id);
  const first = played.firstContact === null ? null : ballNumber(played.firstContact);
  const contactTick = played.events.find((e) => e.type === "hit" && (e.a === CUE || e.b === CUE))?.tick ?? Infinity;
  // After the cue ball's first touch, something has to drop or reach a rail.
  const reachedRail = sunk.length > 0 || played.events.some((e) => (e.type === "wall" || e.type === "pocket") && e.tick > contactTick);
  const sunkNoCue = sunk.filter((n) => n !== 0);

  // What the shot was worth.
  let foul: string | null = null;
  if (scratch) foul = "scratched";
  else if (flew.length) foul = "knocked a ball off the table";
  else if (first === null) foul = "missed every ball";
  else if (!want.includes(first)) foul = s.rules.game === "nine" ? `hit the ${first} before the ${want[0]}` : s.groups[team] || first === 8 ? (first === 8 ? "hit the 8 too soon" : "hit the other side's ball first") : "hit the 8 first";
  else if (!reachedRail) foul = "sent nothing to a rail";
  const wasBreak = s.breaking;
  const who_ = who(seat);
  const other = (1 - team) as 0 | 1;
  const winWith = (t: 0 | 1, why: string) => {
    s.phase = "finished";
    s.winners = teamSeatsOf(s.seats, t);
    s.over = why;
  };
  let narration = "";
  let keep = false; // the shooter shoots again
  let rerack = false;

  const respot = (n: number, bodiesNow: Body[]) => {
    const b = bodiesNow.find((x) => x.id === String(n))!;
    delete b.pocketed;
    delete b.out;
    b.x = clearSpot(bodiesNow, FOOT_X, 1, b.id);
    b.y = MID_Y;
  };
  s.world = played.world;
  const bodiesNow = s.world.bodies;
  for (const id of flew) respot(Number(id), bodiesNow);

  if (s.rules.game === "nine") {
    const nineDown = sunkNoCue.includes(9);
    if (nineDown && !foul) {
      narration = `${who_} sinks the 9 and wins!`;
      winWith(team, narration);
    } else {
      if (nineDown) respot(9, bodiesNow);
      const legal = sunkNoCue.filter((n) => n !== 9);
      if (foul) narration = `${who_} ${foul}.${nineDown ? " The 9 is spotted." : ""} Ball in hand.`;
      else if (legal.length || nineDown) {
        keep = true;
        narration = `${who_} sinks the ${legal.join(", ")}${legal.length ? " and shoots again" : ""}.`;
      } else narration = `${who_} sinks nothing.`;
      s.potted[team] += foul ? 0 : legal.length;
    }
  } else {
    const eightDown = sunkNoCue.includes(8);
    const legalBalls = sunkNoCue.filter((n) => n !== 8);
    const calledOk = !s.rules.call || (call !== null && sunk.includes(Number(call.ball)) && pocketOf(played.events, call.ball) === call.pocket);
    if (wasBreak) {
      if (eightDown) {
        rerack = true;
        narration = `${who_} sinks the 8 on the break: the balls are racked again.`;
      } else {
        keep = !foul && sunkNoCue.length > 0;
        narration = foul ? `${who_} ${foul} on the break. Ball in hand.` : sunkNoCue.length ? `${who_} sinks ${sunkNoCue.join(", ")} on the break and shoots again.` : `${who_} breaks.`;
        s.potted[team] += foul ? 0 : sunkNoCue.length;
      }
    } else if (eightDown) {
      if (foul || !shooting8) {
        winWith(other, `${who_} sinks the 8${foul ? ` and ${foul}` : " too soon"}: ${who(teamSeatsOf(s.seats, other)[0]!)}'s side wins.`);
        narration = s.over!;
      } else if (!calledOk) {
        winWith(other, `${who_} sinks the 8 without calling it: the other side wins.`);
        narration = s.over!;
      } else {
        winWith(team, `${who_} sinks the 8 and wins!`);
        narration = s.over!;
      }
    } else if (scratch && shooting8 && s.rules.eightScratch === "lose") {
      winWith(other, `${who_} scratches on the 8: the other side wins.`);
      narration = s.over!;
    } else {
      // Which of the sunk balls count for the shooter.
      let counted: number[];
      if (!s.groups[team] && !(s.groups[other])) {
        counted = foul ? [] : calledOnly(s, legalBalls, call, played.events);
        if (counted.length) {
          // The table closes: the first ball counted gives the shooter its group.
          const g = groupOf(counted[0]!)!;
          s.groups[team] = g;
          s.groups[other] = g === "solids" ? "stripes" : "solids";
        }
      } else {
        const g = s.groups[team];
        counted = foul ? [] : calledOnly(s, legalBalls.filter((n) => groupOf(n) === g), call, played.events);
      }
      s.potted[team] += counted.length;
      keep = !foul && counted.length > 0;
      narration = foul
        ? `${who_} ${foul}.${s.rules.ballInHand ? " Ball in hand." : " The cue ball goes behind the head string."}`
        : counted.length
          ? `${who_} sinks the ${counted.join(", ")}${s.groups[team] && counted.length && !state.groups[team] ? ` and takes the ${s.groups[team]}` : ""}${keep ? " and shoots again." : "."}`
          : sunkNoCue.length
            ? `${who_} sinks ${sunkNoCue.join(", ")}, but it doesn't count.`
            : `${who_} sinks nothing.`;
    }
  }

  if (rerack) {
    s.world = { ...s.world, bodies: [headSpot(), ...rack(s.rules.game, s)] };
    s.inHand = true;
    s.breaking = true;
    s.narration = narration;
    return finishTurn(s, seat, true);
  }

  // The cue ball: back on the table for the next shot.
  const cueNow = bodiesNow.find((b) => b.id === CUE)!;
  const needsHand = !!foul && s.phase === "playing";
  if (scratch) {
    delete cueNow.pocketed;
    delete cueNow.out;
    cueNow.x = clearSpot(bodiesNow, HEAD_X, -1, CUE);
    cueNow.y = MID_Y;
  }
  s.breaking = false;
  s.inHand = needsHand;
  s.narration = narration;
  if (s.phase === "playing" && s.shots >= SHOT_LIMIT) {
    const [a, b] = s.potted;
    s.phase = "finished";
    s.winners = a === b ? Array.from({ length: s.seats }, (_, i) => i) : teamSeatsOf(s.seats, a > b ? 0 : 1);
    s.over = a === b ? "Time's up: it's a tie." : `Time's up: ${who(s.winners[0]!)}'s side has sunk more.`;
    s.narration = s.over;
  }
  return finishTurn(s, seat, keep && !needsHand);
}

/** The balls that count in a game of calling: just the called ball in the called pocket. */
function calledOnly(s: BilliardsState, balls: number[], call: { ball: string; pocket: string } | null, events: { type: string; body?: string; pocket?: string }[]): number[] {
  if (!s.rules.call) return balls;
  if (!call) return [];
  return balls.filter((n) => String(n) === call.ball && pocketOf(events, call.ball) === call.pocket);
}

/** Who shoots next: the same seat, or the other side's next player. */
function finishTurn(s: BilliardsState, seat: number, keep: boolean): BilliardsState {
  if (s.phase !== "playing") {
    s.inHand = false;
    return s;
  }
  if (keep) {
    s.turn = seat;
    return s;
  }
  const next = (1 - teamOf(seat)) as 0 | 1;
  const list = teamSeatsOf(s.seats, next);
  s.turn = list[s.rot[next] % list.length]!;
  s.rot[next] += 1;
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: Record<number, SportTone> = { 1: "gold", 2: "blue", 3: "red", 4: "purple", 5: "orange", 6: "green", 7: "maroon", 8: "black" };
const ballLook = (b: Body): SportBody => {
  if (b.id === CUE) return { id: CUE, owner: null, kind: "cue", tone: "white", label: "the cue ball" };
  const n = Number(b.id);
  return { id: b.id, owner: null, kind: "ball", tone: TONES[n > 8 ? n - 8 : n]!, label: `the ${n} ball`, mark: String(n), ...(n > 8 ? { striped: true } : {}) };
};

const CLOTH: [number, number][] = [
  [0, 0],
  [LENGTH, 0],
  [LENGTH, WIDTH],
  [0, WIDTH],
];
const LOOK: SportLook = {
  frame: { x: -1500, y: -1500, w: LENGTH + 3000, h: WIDTH + 3000 },
  base: "wood",
  ground: [
    { shape: { points: [[-1500, -1500], [LENGTH + 1500, -1500], [LENGTH + 1500, WIDTH + 1500], [-1500, WIDTH + 1500]] }, surface: "wood" },
    { shape: { points: CLOTH }, surface: "felt" },
  ],
  regions: [],
  // Each cushion is listed with the table on its right, so the rail lies to its left. They are cloth
  // and low, and stop at the pockets' jaws, so the pockets show as holes in the wooden frame.
  rails: POOL_TABLE.walls.map((w) => ({ wall: w.id, material: "cushion" as const, side: "left" as const, width: 420, height: 380 })),
  blocks: [],
  ledges: [],
  tunnels: [],
  pockets: "pocket",
  decor: [],
};

const NAMES: Record<BilliardsKind, string> = { eight: "Eight-ball", nine: "Nine-ball" };

function seatLine(s: BilliardsState, seat: number): string {
  const t = teamOf(seat);
  if (s.rules.game === "nine") return `${s.potted[t]} sunk`;
  const g = s.groups[t];
  const left = g ? liveBalls(s.world).filter((b) => groupOf(ballNumber(b.id)) === g).length : null;
  return g ? (left ? `${g === "solids" ? "Solids" : "Stripes"} · ${left} left` : `${g === "solids" ? "Solids" : "Stripes"} · the 8`) : "Table open";
}

function view(s: BilliardsState, seat: number): SportView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const winners = s.winners ?? [];
  const call = s.rules.call && s.rules.game === "eight";
  const base = mine ? targets(s, teamOf(seat)) : [];
  return {
    game: "billiards",
    seats: s.seats,
    me: seat,
    teams: s.seats > 2,
    phase: s.phase,
    turn: playing ? s.turn : null,
    table: {
      key: `billiards/${s.rules.game}`,
      name: NAMES[s.rules.game],
      world: s.world,
      look: LOOK,
      bodies: s.world.bodies.map(ballLook),
      ghosts: [],
    },
    shoot: mine
      ? {
          body: CUE,
          minPower: s.breaking ? BREAK_POWER_MIN : MIN_POWER,
          maxPower: MAX_POWER,
          ...(s.inHand ? { place: placement(s) } : {}),
          ...(call ? { call: { balls: base.map(String), pockets: s.world.pockets.map((p) => p.id) } } : {}),
        }
      : null,
    last: s.last,
    card: null,
    choices: null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: seatLine(s, i),
      team: s.seats > 2 ? teamOf(i) : undefined,
      done: !playing,
      badge: playing && s.turn === i ? (s.inHand ? (s.breaking ? "Breaking" : "Ball in hand") : "Shooting") : undefined,
    })),
    info: [NAMES[s.rules.game], ...(s.rules.game === "eight" && playing && !s.groups[0] && !s.groups[1] && !s.breaking ? ["Table open"] : []), ...(s.rules.game === "nine" && playing ? [`Hit the ${targets(s, teamOf(s.turn))[0]} first`] : []), ...(s.inHand && playing ? [s.breaking ? "Break from behind the head string" : s.rules.ballInHand ? "Ball in hand" : "Cue ball behind the head string"] : [])],
    narration: s.narration ?? (playing ? "Pick your spot, aim and shoot." : null),
    scores: [0, 1].map((t) => ({ seats: teamSeatsOf(s.seats, t), value: s.potted[t]! })).filter((x) => x.seats.length),
    result: null,
    over: playing ? null : { winners, title: s.over ?? "Game over" },
  };
}

// ---- A computer player -------------------------------------------------------------------------

const near = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
  // How far the point p is from the segment a to b.
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
};

/**
 * How hard to hit so the object ball just reaches its pocket. The cloth slows a ball by `friction`
 * (units/s²), so a ball needs v² = 2·friction·distance to go that far; the cue ball loses some on the
 * way to the object ball and more when it only glances off it. A shot at full power (1000) is
 * `maxShotSpeed`; a bit of margin keeps a ball that is slowing at the pocket from stopping short.
 */
function powerFor(objectDistance: number, cueDistance: number, straight: number): number {
  const f = POOL_TABLE.friction;
  const need2 = 2 * f * objectDistance * 1.3 + 2500 * 2500;
  const atImpact2 = need2 / Math.max(0.4, straight) ** 2;
  const launch = Math.sqrt(atImpact2 + 2 * f * cueDistance);
  return Math.max(MIN_POWER, Math.min(650, Math.round((launch / POOL_TABLE.maxShotSpeed) * 1000 * 1.08)));
}

interface Plan {
  angle: number;
  power: number;
  at?: number;
  call?: { ball: string; pocket: string };
  score: number;
}

/** Every pocket-ball-cue line a cue ball at (cx, cy) could take, the shortest and straightest best. */
function plans(s: BilliardsState, cx: number, cy: number, want: number[], world: World): Plan[] {
  const out: Plan[] = [];
  const balls = liveBalls(world);
  for (const n of want) {
    const target = balls.find((b) => b.id === String(n));
    if (!target) continue;
    for (const p of world.pockets) {
      // Aim the cue ball at the point behind the target, in line with the pocket.
      const dx = p.x - target.x;
      const dy = p.y - target.y;
      const d = Math.hypot(dx, dy) || 1;
      const gx = target.x - (dx / d) * 2 * R;
      const gy = target.y - (dy / d) * 2 * R;
      const cut = Math.abs(Math.atan2(gy - cy, gx - cx) - Math.atan2(target.y - cy, target.x - cx));
      const bend = Math.atan2(dy, dx) - Math.atan2(target.y - cy, target.x - cx);
      const turn = Math.abs(Math.atan2(Math.sin(bend), Math.cos(bend)));
      if (turn > 1.25 || cut > 1.25) continue;
      const blocked = balls.some((b) => b.id !== target.id && (near(cx, cy, gx, gy, b.x, b.y) < 2 * R - 20 || near(target.x, target.y, p.x, p.y, b.x, b.y) < 2 * R - 20));
      if (blocked) continue;
      if (!(gx > 0 && gx < LENGTH && gy > 0 && gy < WIDTH)) continue;
      const toGhost = Math.hypot(gx - cx, gy - cy);
      const travel = toGhost + d;
      const power = powerFor(d, toGhost, Math.cos(turn));
      out.push({ angle: angleTo({ x: cx, y: cy }, { x: gx, y: gy }), power, call: { ball: target.id, pocket: p.id }, score: 1000 - travel / 20 - turn * 250 + (n === 8 || n === 9 ? 80 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const wrap = (a: number) => ((Math.round(a) % 36000) + 36000) % 36000;

function bot(s: BilliardsState, seat: number, style: PlayStyle, rand: () => number = Math.random): BilliardsMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2.5 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const want = targets(s, teamOf(seat));
  const cue = s.world.bodies.find((b) => b.id === CUE)!;
  const finish = (plan: Plan | null, at?: number): BilliardsMove => {
    const from = at ?? cue.x;
    const fallback = (() => {
      const t = liveBalls(s.world).filter((b) => want.includes(ballNumber(b.id))).sort((a, b) => Math.hypot(a.x - from, a.y - cue.y) - Math.hypot(b.x - from, b.y - cue.y))[0];
      const d = t ? Math.hypot(t.x - from, t.y - cue.y) : 5000;
      return { angle: t ? angleTo({ x: from, y: cue.y }, t) : 0, power: powerFor(2500, d, 0.8) };
    })();
    const p = plan ?? fallback;
    const angle = wrap(p.angle + wobble() * (40 + (1 - skill) * 420) * slip);
    const power = Math.max(s.breaking ? BREAK_POWER_MIN : MIN_POWER, Math.min(MAX_POWER, Math.round(p.power * (1 + wobble() * (0.04 + (1 - skill) * 0.25) * slip))));
    const call = plan?.call;
    return { type: "shot", body: CUE, angle, power, ...(at !== undefined && at !== cue.x ? { at } : {}), ...(s.rules.call && s.rules.game === "eight" && call ? { call } : {}) };
  };
  if (s.breaking) return { type: "shot", body: CUE, angle: angleTo({ x: cue.x, y: cue.y }, { x: FOOT_X, y: MID_Y }), power: MAX_POWER };
  if (s.inHand) {
    // Try a handful of spots on the line and take the one with the best shot.
    const place = placement(s);
    let best: { at: number; plan: Plan | null; score: number } | null = null;
    for (let i = 0; i < 9; i++) {
      const at = Math.round(place.min + ((place.max - place.min) * i) / 8);
      if (!fits(s.world.bodies, at, MID_Y, CUE)) continue;
      const plan = plans(s, at, MID_Y, want, s.world)[0] ?? null;
      const score = plan ? plan.score : -1e6;
      if (!best || score > best.score) best = { at, plan, score };
    }
    if (best) return finish(best.plan, best.at);
    return finish(null, clearSpot(s.world.bodies, HEAD_X, -1, CUE));
  }
  return finish(plans(s, cue.x, cue.y, want, s.world)[0] ?? null);
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): BilliardsRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BilliardsRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? eightBall;
  const game: BilliardsKind = given.game === "eight" || given.game === "nine" ? given.game : base.game;
  return {
    id: base.id,
    name: base.name,
    game,
    call: game === "eight" && (given.call === undefined ? base.call : given.call === true),
    ballInHand: given.ballInHand === undefined ? base.ballInHand : given.ballInHand === true,
    eightScratch: given.eightScratch === "foul" || given.eightScratch === "lose" ? given.eightScratch : base.eightScratch,
  };
}

const FIELDS: RuleField<BilliardsRules>[] = [
  { key: "game", label: "Game", hint: "Eight-ball: solids or stripes, then the 8. Nine-ball: lowest ball first, sink the 9.", kind: "choice", options: [["eight", "Eight-ball"], ["nine", "Nine-ball"]] },
  { key: "call", label: "Call your shot", hint: "Eight-ball: name a ball and a pocket; only that shot counts.", kind: "toggle" },
  { key: "ballInHand", label: "Ball in hand", hint: "After a foul the next player puts the cue ball anywhere. Off: only behind the head string.", kind: "toggle" },
  { key: "eightScratch", label: "Scratch on the 8", hint: "Eight-ball: what it costs when you scratch while shooting at the 8.", kind: "choice", options: [["lose", "Lose the game"], ["foul", "Just a foul"]] },
];

export const billiards: SportGame<BilliardsRules, BilliardsState, BilliardsMove> = {
  id: "billiards",
  name: "Billiards",
  emoji: "🎱",
  category: "sports",
  blurb: "Eight-ball and nine-ball, for two or as partners",
  tagline: "Pool for the family table: pick your spot, line it up and shoot.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    const eight = r.game === "eight";
    return [
      eight ? "Eight-ball: fifteen balls, and the 8 in the middle of the rack. The table is open after the break; the first ball you sink gives you solids (1 to 7) or stripes (9 to 15) and the other side the rest." : "Nine-ball: nine balls in a diamond. Hit the lowest ball on the table first, every shot.",
      eight ? "Sink all of yours, then the 8, to win. Sink the 8 early or with a foul and you lose." : "Sink the 9, with a clean shot, at any time to win. A 9 sunk with a foul is put back on the table.",
      "Sink a ball (that counts) and you shoot again. A foul: the cue ball dropped, hit nothing, hit the wrong ball first, or nothing reached a rail. The other side gets " + (r.ballInHand ? "the cue ball in hand: put it anywhere on the long centre line." : "the cue ball behind the head string.") ,
      ...(eight && r.call ? ["Call your shot: pick the ball and the pocket before you shoot. Only that ball in that pocket counts."] : []),
      ...(eight ? [r.eightScratch === "lose" ? "A scratch while you're shooting at the 8 loses the game." : "A scratch while shooting at the 8 is an ordinary foul."] : []),
      "Two players, or four as partners: the partners take turns at the table.",
    ];
  },
  newGame: newBilliards,
  apply,
  view,
  bot,
  thinkingTime: (s) => thinkFor(s.breaking ? 2 : 8, 1.1),
  summary(s) {
    const over = s.phase === "finished";
    const winners = s.winners ?? [];
    return {
      game: "billiards",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.seats === 2 ? `${s.potted[0]} to ${s.potted[1]}` : `Team 1: ${s.potted[0]} · Team 2: ${s.potted[1]}`,
      order: over ? [...winners, ...Array.from({ length: s.seats }, (_, i) => i).filter((i) => !winners.includes(i))] : null,
      winners: over ? winners : null,
      teams: s.seats > 2,
      seats: s.seats,
    };
  },
};
