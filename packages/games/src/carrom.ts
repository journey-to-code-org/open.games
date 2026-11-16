// Carrom, the flick board: a square board with a pocket in each corner, nine white pieces, nine
// black, a red queen in the middle, and a heavier striker that is flicked from your own baseline.
// For two, or four as partners. A move is a shot at the striker; the physics core plays it to rest,
// and the rules here look at what dropped.
//
// White breaks. Pocket one of your own and you shoot again. Pocket one of theirs and it stays down,
// to their good. The queen has to be covered: pocket it, then pocket one of your own with the same
// shot or your next one, or it goes back to the middle. Nobody may finish while the queen is still
// on the board: a last piece pocketed too soon comes back out.
//
// A foul is the striker in a pocket (or off the board). It costs a due: one of your pocketed pieces
// goes back to the middle, along with anything of yours that dropped on the shot, and the queen if
// it did. With nothing down to pay with, the due is owed, and paid from the next piece you pocket.
//
// A board ends when a side has all nine down. First to clear wins the game; or, playing for
// points, the board's winner scores a point for each of the other side's pieces still on the board
// and three for the queen if they covered it, and boards are played until someone reaches the
// target.
import { PHYSICS_VERSION, simulate, type Body, type World } from "@journey-to-code/physics";
import type { PlayStyle } from "@journey-to-code/rules";
import { angleTo, restOf, type ShotMove, type SportBody, type SportGame, type SportLook, type SportShot, type SportView } from "./sport.js";
import { careless, clone, GameError, markReady, nextHandChoices, thinkFor, who, type BaseRules, type RoundResult, type RuleField } from "./table.js";

// ---- The board ----------------------------------------------------------------------------------
// Lengths are tenths of a millimetre: a 74 cm playing surface, pieces 31 mm across, a 41 mm striker.

const SIDE = 7400;
const MID = 3700;
const RC = 155; // a piece
const RS = 205; // the striker
/** How far a rail stops short of each corner, and the pocket that sits there. A pocket's circle covers every path a piece's centre can take through the gap. */
const GAP = 600;
const POCKET_R = 480;
/** The baselines: how far in from the rail a striker is put, and how far along it may go. */
const BASE_IN = 1050;
const BASE = { min: 1400, max: 6000 };
const MIN_POWER = 50;
const MAX_POWER = 1000;
const STRIKER = "striker";
const QUEEN = "queen";
const PIECES = 9;
/** A board is called after this many shots, so two poor players can't go on for ever. */
const BOARD_SHOTS = 120;
/** Playing for points, no more boards than this. */
const MOST_BOARDS = 5;
const QUEEN_POINTS = 3;

/** The board with nothing on it. The powdered wood is slick, and the rails are lively. */
export const CARROM_BOARD: World = {
  bounds: { x: -1000, y: -1000, w: SIDE + 2000, h: SIDE + 2000 },
  tickRate: 120,
  maxTicks: 3600,
  friction: 15000,
  restSpeed: 50,
  restitution: 0.9,
  wallRestitution: 0.7,
  maxShotSpeed: 36000,
  bodies: [],
  // Each rail is listed with the board on its right, as a pool table's cushions are.
  walls: [
    { id: "top", points: [[GAP, 0], [SIDE - GAP, 0]] },
    { id: "right", points: [[SIDE, GAP], [SIDE, SIDE - GAP]] },
    { id: "bottom", points: [[SIDE - GAP, SIDE], [GAP, SIDE]] },
    { id: "left", points: [[0, SIDE - GAP], [0, GAP]] },
  ],
  pockets: [
    { id: "top-left", x: 0, y: 0, r: POCKET_R },
    { id: "top-right", x: SIDE, y: 0, r: POCKET_R },
    { id: "bottom-right", x: SIDE, y: SIDE, r: POCKET_R },
    { id: "bottom-left", x: 0, y: SIDE, r: POCKET_R },
  ],
  regions: [],
};

// The pieces are set out, and put back, on a honeycomb of whole numbers round the middle: 320
// apart along a row, rows 278 apart (a touch more than 320 × √3 / 2, so nothing overlaps).
const STEP = 320;
const HALF = 160;
const ROW = 278;
const spot = (q: number, r: number) => ({ x: MID + q * STEP + r * HALF, y: MID + r * ROW });
const AROUND: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
/** The cells of the ring `k` steps out from the middle, walking round it. */
function ring(k: number): [number, number][] {
  if (k === 0) return [[0, 0]];
  const cells: [number, number][] = [];
  // Start at the corner k steps along the fifth direction, then walk each side in turn.
  let q = AROUND[4]![0] * k;
  let r = AROUND[4]![1] * k;
  for (const [dq, dr] of AROUND) {
    for (let i = 0; i < k; i++) {
      cells.push([q, r]);
      q += dq;
      r += dr;
    }
  }
  return cells;
}

type Side = 0 | 1;
const PREFIX = ["w", "b"] as const;
const COLOUR = ["White", "Black"] as const;
const sideOfPiece = (id: string): Side | null => (id[0] === "w" && id !== STRIKER ? 0 : id[0] === "b" ? 1 : null);
const live = (b: Body) => b.pocketed === undefined && b.out === undefined;

/** The nineteen pieces as a board starts: the queen in the middle, six round her, twelve round them, the colours alternating. */
function setUp(): Body[] {
  const bodies: Body[] = [{ id: QUEEN, ...spot(0, 0), r: RC }];
  const count = [0, 0];
  for (const k of [1, 2]) {
    ring(k).forEach(([q, r], i) => {
      const side = (i % 2) as Side;
      count[side]! += 1;
      bodies.push({ id: `${PREFIX[side]}${count[side]}`, ...spot(q, r), r: RC });
    });
  }
  return bodies;
}

/** Whether a disc of radius `r` fits at (x, y) clear of everything in play. */
const fits = (bodies: Body[], x: number, y: number, r: number, except?: string) => bodies.every((b) => b.id === except || !live(b) || (b.x - x) ** 2 + (b.y - y) ** 2 >= (b.r + r + 2) ** 2);

/** Put a piece back on the board: in the middle, or the nearest free cell of the honeycomb. */
function putBack(bodies: Body[], id: string) {
  const b = bodies.find((x) => x.id === id)!;
  delete b.pocketed;
  delete b.out;
  for (let k = 0; k < 12; k++) {
    for (const [q, r] of ring(k)) {
      const at = spot(q, r);
      if (!fits(bodies, at.x, at.y, RC, id)) continue;
      b.x = at.x;
      b.y = at.y;
      return;
    }
  }
  b.x = MID;
  b.y = MID;
}

const baselineY = (side: Side) => (side === 0 ? SIDE - BASE_IN : BASE_IN);

/** The nearest spot on a baseline to `from` that the striker fits on. */
function clearOnBaseline(bodies: Body[], side: Side, from = MID): number {
  const y = baselineY(side);
  for (let k = 0; k < 240; k++) {
    for (const d of [1, -1]) {
      const x = from + d * k * 20;
      if (x >= BASE.min && x <= BASE.max && fits(bodies, x, y, RS, STRIKER)) return x;
    }
  }
  return from;
}

// ---- Rules and state ---------------------------------------------------------------------------

export interface CarromRules extends BaseRules {
  /** First to clear their pieces wins, or boards are played for points. */
  play: "clear" | "points";
  /** Playing for points: the score that wins. */
  target: number;
  /** The queen has to be covered by one of your own, with the same shot or the next. Off: she counts the moment she drops. */
  cover: boolean;
}

export const carromClear: CarromRules = { id: "clear", name: "First to clear", play: "clear", target: 15, cover: true };
export const carromPoints: CarromRules = { id: "points", name: "To 15 points", play: "points", target: 15, cover: true };
const PRESETS = [carromClear, carromPoints];
const TARGETS = [8, 15, 25];

export interface CarromState {
  game: "carrom";
  rules: CarromRules;
  seats: number;
  rng: number;
  /** The board being played, from 1. */
  hand: number;
  dealer: 0;
  phase: "playing" | "board" | "finished";
  turn: number;
  /** The board at rest, as the next shot will find it: the striker on the shooter's baseline. */
  world: World;
  /** Where the queen is: on the board, down and waiting to be covered, or covered (by `queenBy`). */
  queen: "board" | "pending" | "covered";
  queenBy: Side | null;
  /** Pieces each side owes the board, from fouls it had nothing down to pay for. */
  dues: [number, number];
  /** Who shoots next for each side, so partners take turns. */
  rot: [number, number];
  /** Shots in the whole game (each is animated once), and on this board. */
  shots: number;
  boardShots: number;
  points: [number, number];
  last: SportShot | null;
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
  over: string | null;
}

export type CarromMove = ShotMove | { type: "next" };

const teamOf = (seat: number) => (seat % 2) as Side;
const teamSeatsOf = (seats: number, team: number) => Array.from({ length: seats }, (_, i) => i).filter((i) => teamOf(i) === team);
const everyone = (seats: number) => Array.from({ length: seats }, (_, i) => i);
/** How many of a side's pieces are in the pockets. */
const down = (w: World, side: Side) => w.bodies.filter((b) => sideOfPiece(b.id) === side && !live(b)).length;

/** A fresh board, with the striker on the breaking side's baseline. */
function freshBoard(breaker: Side): World {
  const pieces = setUp();
  return { ...CARROM_BOARD, bodies: [{ id: STRIKER, x: clearOnBaseline(pieces, breaker), y: baselineY(breaker), r: RS, mass: 3 }, ...pieces] };
}

export function newCarrom(rules: CarromRules, seats: number, seed: number): CarromState {
  return {
    game: "carrom",
    rules,
    seats,
    rng: seed,
    hand: 1,
    dealer: 0,
    phase: "playing",
    turn: 0,
    world: freshBoard(0),
    queen: "board",
    queenBy: null,
    dues: [0, 0],
    rot: [1, 0],
    shots: 0,
    boardShots: 0,
    points: [0, 0],
    last: null,
    ready: Array<boolean>(seats).fill(false),
    result: null,
    winners: null,
    narration: `${who(0)} to break.`,
    over: null,
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The board is over: score it, and either the game ends or everyone is asked to move on. */
function endBoard(s: CarromState, winner: Side | null, why: string) {
  const other = winner === null ? null : ((1 - winner) as Side);
  const left = other === null ? 0 : PIECES - down(s.world, other);
  const queenBonus = winner !== null && s.queen === "covered" && s.queenBy === winner ? QUEEN_POINTS : 0;
  // A board called on time is worth the difference in pieces down, to whoever has more.
  const called = winner !== null && down(s.world, winner) < PIECES;
  const scored = winner === null ? 0 : called ? Math.max(1, down(s.world, winner) - down(s.world, other!)) : left + queenBonus;
  if (winner !== null) s.points[winner] += scored;
  const sides = [0, 1].map((t) => teamSeatsOf(s.seats, t));
  const finish = (winners: number[], title: string) => {
    s.phase = "finished";
    s.winners = winners;
    s.over = title;
    s.narration = title;
  };
  if (s.rules.play === "clear") {
    finish(winner === null ? everyone(s.seats) : teamSeatsOf(s.seats, winner), winner === null ? `${why} It's a tie.` : `${why} ${who(teamSeatsOf(s.seats, winner)[0]!)}${s.seats > 2 ? "'s side wins" : " wins"}!`);
    return;
  }
  s.result = {
    key: `carrom/${s.hand}`,
    title: winner === null ? `Board ${s.hand}: nobody scores` : `Board ${s.hand} to ${COLOUR[winner]}`,
    sides,
    rows: [
      { label: "Pieces down", values: [0, 1].map((t) => String(down(s.world, t as Side))) },
      { label: "The queen", values: [0, 1].map((t) => (s.queen === "covered" && s.queenBy === t ? "Covered" : "")) },
      { label: "This board", values: [0, 1].map((t) => (t === winner ? `+${scored}` : "")), tone: "score" },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
  const [a, b] = s.points;
  if (Math.max(a, b) >= s.rules.target || s.hand >= MOST_BOARDS) {
    const lead = a === b ? null : a > b ? 0 : 1;
    finish(lead === null ? everyone(s.seats) : teamSeatsOf(s.seats, lead), lead === null ? `${why} All square at ${a} points.` : `${why} ${who(teamSeatsOf(s.seats, lead)[0]!)}${s.seats > 2 ? "'s side wins" : " wins"}, ${Math.max(a, b)} points to ${Math.min(a, b)}.`);
    return;
  }
  s.phase = "board";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = why;
}

/** Who shoots next: the same seat, or the other side's next player. The striker goes to their baseline. */
function passTurn(s: CarromState, seat: number, keep: boolean) {
  if (!keep) {
    const next = (1 - teamOf(seat)) as Side;
    const list = teamSeatsOf(s.seats, next);
    s.turn = list[s.rot[next] % list.length]!;
    s.rot[next] += 1;
  }
  const side = teamOf(s.turn);
  const striker = s.world.bodies.find((b) => b.id === STRIKER)!;
  delete striker.pocketed;
  delete striker.out;
  striker.x = clearOnBaseline(s.world.bodies, side);
  striker.y = baselineY(side);
}

function apply(state: CarromState, seat: number, move: CarromMove): CarromState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "board") throw new GameError("The board isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    // The next board: the sides take turns to break.
    const breaker = (s.hand % 2) as Side;
    s.hand += 1;
    s.phase = "playing";
    s.world = freshBoard(breaker);
    s.queen = "board";
    s.queenBy = null;
    s.dues = [0, 0];
    s.boardShots = 0;
    s.result = null;
    const list = teamSeatsOf(s.seats, breaker);
    s.turn = list[s.rot[breaker] % list.length]!;
    s.rot[breaker] += 1;
    s.narration = `Board ${s.hand}: ${who(s.turn)} to break.`;
    return s;
  }
  if (move?.type !== "shot") throw new GameError("That's not a move in Carrom.");
  if (state.phase !== "playing") throw new GameError(state.phase === "board" ? "The board is finished: move on to the next." : "This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your shot.");
  if (move.body !== STRIKER) throw new GameError("You flick the striker.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a shot: too soft or too hard.");
  if (move.spin !== undefined && move.spin !== 0) throw new GameError("There's no spin on a carrom board.");
  const s = clone(state);
  const team = teamOf(seat);
  const other = (1 - team) as Side;
  const striker = s.world.bodies.find((b) => b.id === STRIKER)!;
  if (move.at !== undefined) {
    if (!Number.isInteger(move.at) || move.at < BASE.min || move.at > BASE.max) throw new GameError("Put the striker on your baseline.");
    if (!fits(s.world.bodies, move.at, baselineY(team), RS, STRIKER)) throw new GameError("There's a piece in the way: put the striker down somewhere clear.");
    striker.x = move.at;
  }

  const before = s.world;
  const shot = { body: STRIKER, angle: move.angle, power: move.power };
  const played = simulate(before, shot);
  s.shots += 1;
  s.boardShots += 1;
  s.last = { n: s.shots, seat, shot, from: before.bodies, rest: restOf(played.world), ticks: played.ticks, physics: PHYSICS_VERSION };
  s.world = played.world;
  const bodies = s.world.bodies;
  const was = (id: string) => before.bodies.find((b) => b.id === id)!;
  const fresh = bodies.filter((b) => !live(b) && live(was(b.id)));
  const sunk = fresh.filter((b) => b.pocketed !== undefined).map((b) => b.id);
  const flew = fresh.filter((b) => b.out !== undefined && b.pocketed === undefined).map((b) => b.id);
  const foul = sunk.includes(STRIKER) || flew.includes(STRIKER);
  const mine = sunk.filter((id) => sideOfPiece(id) === team);
  const theirs = sunk.filter((id) => sideOfPiece(id) === other);
  const queenDown = sunk.includes(QUEEN);
  const me = who(seat);
  const say: string[] = [];

  // A piece knocked off the board goes back to the middle; it costs nothing.
  for (const id of flew) if (id !== STRIKER) putBack(bodies, id);

  let keep = false;
  if (foul) {
    for (const id of mine) putBack(bodies, id);
    if (queenDown || s.queen === "pending") {
      putBack(bodies, QUEEN);
      s.queen = "board";
      s.queenBy = null;
    }
    // The due: a piece already down comes back, or it is owed.
    const paid = bodies.find((b) => sideOfPiece(b.id) === team && !live(b));
    if (paid) putBack(bodies, paid.id);
    else s.dues[team] += 1;
    say.push(`${me} pockets the striker: a foul. ${paid ? "One of their pieces comes back out." : "They owe the board a piece."}${theirs.length ? ` ${plural(theirs.length, `${COLOUR[other].toLowerCase()} piece`)} stay${theirs.length === 1 ? "s" : ""} down.` : ""}`);
  } else {
    // What is owed is paid from what has just gone down.
    while (s.dues[team] > 0) {
      const paid = bodies.find((b) => sideOfPiece(b.id) === team && !live(b));
      if (!paid) break;
      putBack(bodies, paid.id);
      s.dues[team] -= 1;
      say.push(`One of ${me}'s pieces pays what they owed.`);
    }
    const covering = mine.length > 0;
    if (s.queen === "pending") {
      if (covering) {
        s.queen = "covered";
        say.push(`${me} covers the queen!`);
      } else {
        putBack(bodies, QUEEN);
        s.queen = "board";
        s.queenBy = null;
        say.push(`${me} doesn't cover the queen: she goes back to the middle.`);
      }
    } else if (queenDown) {
      s.queenBy = team;
      if (!s.rules.cover || covering) {
        s.queen = "covered";
        say.push(s.rules.cover ? `${me} pockets the queen and covers her with the same shot!` : `${me} pockets the queen!`);
      } else {
        s.queen = "pending";
        say.push(`${me} pockets the queen, and has to cover her with the next shot.`);
      }
    }
    if (mine.length) say.push(`${me} pockets ${plural(mine.length, "piece")}.`);
    if (theirs.length) say.push(`${me} pockets ${plural(theirs.length, `${COLOUR[other].toLowerCase()} piece`)}: ${theirs.length === 1 ? "it stays" : "they stay"} down.`);
    if (!sunk.length && !say.length) say.push(`${me} pockets nothing.`);
    keep = covering || s.queen === "pending";
  }

  // Nobody finishes while the queen is on the board (or waiting to be covered): a last piece comes back.
  if (s.queen !== "covered") {
    for (const side of [team, other]) {
      if (down(s.world, side) < PIECES) continue;
      const last = [...sunk].reverse().find((id) => sideOfPiece(id) === side) ?? bodies.find((b) => sideOfPiece(b.id) === side && !live(b))!.id;
      putBack(bodies, last);
      say.push(`${COLOUR[side]}'s last piece comes back out: the queen is still to be covered.`);
      if (side === team) keep = s.queen === "pending";
    }
  }

  s.narration = say.join(" ");
  // The shooter's side first: clearing both with one shot is theirs.
  const cleared = [team, other].find((side) => down(s.world, side) === PIECES) ?? null;
  if (cleared !== null) {
    endBoard(s, cleared, `${s.narration} ${COLOUR[cleared]} has cleared the board.`);
  } else if (s.boardShots >= BOARD_SHOTS) {
    const [a, b] = [down(s.world, 0), down(s.world, 1)];
    endBoard(s, a === b ? null : a > b ? 0 : 1, "Time's up on this board.");
  }
  if (s.phase === "playing") passTurn(s, seat, keep);
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

function bodyLook(b: Body): SportBody {
  if (b.id === STRIKER) return { id: STRIKER, owner: null, kind: "striker", tone: "gold", label: "the striker", height: 90 };
  if (b.id === QUEEN) return { id: QUEEN, owner: null, kind: "carrom", tone: "red", label: "the queen", mark: "Q", height: 80 };
  const side = sideOfPiece(b.id)!;
  return { id: b.id, owner: null, kind: "carrom", tone: side === 0 ? "white" : "black", label: `a ${COLOUR[side].toLowerCase()} piece`, height: 80 };
}

const FRAME = 700;
const LOOK: SportLook = {
  frame: { x: -FRAME, y: -FRAME, w: SIDE + 2 * FRAME, h: SIDE + 2 * FRAME },
  base: "wood",
  ground: [
    { shape: { points: [[-FRAME, -FRAME], [SIDE + FRAME, -FRAME], [SIDE + FRAME, SIDE + FRAME], [-FRAME, SIDE + FRAME]] }, surface: "wood" },
    { shape: { points: [[0, 0], [SIDE, 0], [SIDE, SIDE], [0, SIDE]] }, surface: "deck" },
  ],
  regions: [],
  rails: CARROM_BOARD.walls.map((w) => ({ wall: w.id, material: "timber" as const, side: "left" as const, width: 500, height: 250 })),
  blocks: [],
  ledges: [],
  tunnels: [],
  pockets: "pocket",
  decor: [],
};

function seatLine(s: CarromState, seat: number): string {
  const side = teamOf(seat);
  const left = PIECES - down(s.world, side);
  const queen = s.queenBy === side ? (s.queen === "covered" ? " · the queen" : s.queen === "pending" ? " · queen to cover" : "") : "";
  const owes = s.dues[side] ? ` · owes ${s.dues[side]}` : "";
  return `${COLOUR[side]} · ${left} left${queen}${owes}`;
}

function view(s: CarromState, seat: number): SportView {
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const points = s.rules.play === "points";
  return {
    game: "carrom",
    seats: s.seats,
    me: seat,
    teams: s.seats > 2,
    phase: s.phase,
    turn: playing ? s.turn : null,
    table: {
      key: `carrom/${s.hand}`,
      name: points ? `Board ${s.hand}` : "Carrom",
      world: s.world,
      look: LOOK,
      bodies: s.world.bodies.map(bodyLook),
      ghosts: [],
    },
    shoot: mine ? { body: STRIKER, minPower: MIN_POWER, maxPower: MAX_POWER, place: { y: baselineY(teamOf(seat)), ...BASE } } : null,
    last: s.last,
    card: null,
    choices: s.phase === "board" ? nextHandChoices(s.ready, seat, false, "Next board") : null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: seatLine(s, i),
      team: s.seats > 2 ? teamOf(i) : undefined,
      done: !playing,
      badge: playing && s.turn === i ? (s.boardShots === 0 ? "Breaking" : s.queen === "pending" && s.queenBy === teamOf(i) ? "Covering" : "Shooting") : undefined,
    })),
    info: [points ? `To ${s.rules.target} points` : "First to clear", ...(playing && s.queen === "board" ? ["The queen is on the board"] : []), ...(playing && s.queen === "pending" ? ["The queen is waiting to be covered"] : [])],
    narration: s.narration ?? (playing ? "Put the striker on your baseline, aim and flick." : null),
    scores: [0, 1].map((t) => ({ seats: teamSeatsOf(s.seats, t), value: points ? s.points[t]! : down(s.world, t as Side) })).filter((x) => x.seats.length),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.over ?? "Game over" } : null,
  };
}

// ---- A computer player -------------------------------------------------------------------------

/** How far the point p is from the segment a to b. */
const near = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
};

/**
 * How hard to flick so the piece just reaches its pocket. The board slows a piece by `friction`, so
 * it needs v² = 2·friction·distance to go that far. The striker is three times a piece's weight, so
 * a piece leaves a square hit at about one and a half times the striker's speed, and less when it
 * is only clipped; the striker loses a little on its own way there.
 */
function powerFor(pieceDistance: number, strikerDistance: number, straight: number): number {
  const f = CARROM_BOARD.friction;
  const piece2 = 2 * f * pieceDistance * 1.35 + 1500 * 1500;
  const atImpact2 = piece2 / (1.5 * Math.max(0.4, straight)) ** 2;
  const launch = Math.sqrt(atImpact2 + 2 * f * strikerDistance);
  return Math.max(MIN_POWER, Math.min(900, Math.round((launch / CARROM_BOARD.maxShotSpeed) * 1000 * 1.1)));
}

interface Plan {
  at: number;
  angle: number;
  power: number;
  score: number;
}

/** Every striker-piece-pocket line from a spot on the baseline, the shortest and straightest best. */
function plansFrom(bodies: Body[], at: number, y: number, want: string[]): Plan[] {
  const out: Plan[] = [];
  const pieces = bodies.filter((b) => b.id !== STRIKER && live(b));
  for (const id of want) {
    const target = pieces.find((b) => b.id === id);
    if (!target) continue;
    for (const p of CARROM_BOARD.pockets) {
      // Aim the striker at the point behind the piece, in line with the pocket.
      const dx = p.x - target.x;
      const dy = p.y - target.y;
      const d = Math.hypot(dx, dy) || 1;
      const gx = target.x - (dx / d) * (RS + RC);
      const gy = target.y - (dy / d) * (RS + RC);
      const bend = Math.atan2(dy, dx) - Math.atan2(gy - y, gx - at);
      const turn = Math.abs(Math.atan2(Math.sin(bend), Math.cos(bend)));
      if (turn > 1.2) continue;
      if (!(gx > RS && gx < SIDE - RS && gy > RS && gy < SIDE - RS)) continue;
      const blocked = pieces.some((b) => b.id !== target.id && (near(at, y, gx, gy, b.x, b.y) < RS + RC - 10 || near(target.x, target.y, p.x, p.y, b.x, b.y) < 2 * RC - 10));
      if (blocked) continue;
      const toGhost = Math.hypot(gx - at, gy - y);
      out.push({ at, angle: angleTo({ x: at, y }, { x: gx, y: gy }), power: powerFor(d, toGhost, Math.cos(turn)), score: 1000 - (toGhost + d) / 8 - turn * 300 + (id === QUEEN ? 60 : 0) });
    }
  }
  return out;
}

const wrap = (a: number) => ((Math.round(a) % 36000) + 36000) % 36000;

function bot(s: CarromState, seat: number, style: PlayStyle, rand: () => number = Math.random): CarromMove | null {
  if (s.phase === "board") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const side = teamOf(seat);
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2.5 : 1;
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const bodies = s.world.bodies;
  const y = baselineY(side);
  const striker = bodies.find((b) => b.id === STRIKER)!;
  const own = bodies.filter((b) => sideOfPiece(b.id) === side && live(b)).map((b) => b.id);
  // The queen is one more piece to go for while there is plenty left to cover her with. Down to the
  // last three she comes first, and the last piece of all is left alone until she is covered:
  // pocketed before her, it only comes back out.
  const queenFirst = s.queen === "board" && own.length <= 3;
  const want = queenFirst ? [QUEEN] : [...own, ...(s.queen === "board" ? [QUEEN] : [])];
  const second = queenFirst && own.length > 1 ? own : [];
  const send = (at: number, angle: number, power: number): CarromMove => ({
    type: "shot",
    body: STRIKER,
    angle: wrap(angle + wobble() * (30 + (1 - skill) * 400) * slip),
    power: Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(power * (1 + wobble() * (0.04 + (1 - skill) * 0.25) * slip)))),
    ...(at !== striker.x ? { at } : {}),
  });
  // The break: from the middle of the baseline, hard into the pack.
  if (s.boardShots === 0) return send(striker.x, angleTo({ x: striker.x, y }, { x: MID, y: MID }), 820);
  let best: Plan | null = null;
  for (let i = 0; i <= 10; i++) {
    const at = Math.round(BASE.min + ((BASE.max - BASE.min) * i) / 10);
    if (!fits(bodies, at, y, RS, STRIKER)) continue;
    for (const plan of plansFrom(bodies, at, y, want)) if (!best || plan.score > best.score) best = plan;
    // With no line to the queen, a piece that isn't the last is still worth having.
    for (const plan of plansFrom(bodies, at, y, second)) if (!best || plan.score - 2000 > best.score) best = { ...plan, score: plan.score - 2000 };
  }
  if (best) return send(best.at, best.angle, best.power);
  // Nothing lines up: knock into the nearest of your own and see what moves.
  const from = { x: striker.x, y };
  const nearest = bodies.filter((b) => want.includes(b.id) && live(b)).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  return send(striker.x, nearest ? angleTo(from, nearest) : angleTo(from, { x: MID, y: MID }), 520);
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): CarromRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CarromRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? carromClear;
  return {
    id: base.id,
    name: base.name,
    play: given.play === "clear" || given.play === "points" ? given.play : base.play,
    target: TARGETS.includes(Number(given.target)) ? Number(given.target) : base.target,
    cover: given.cover === undefined ? base.cover : given.cover === true,
  };
}

const FIELDS: RuleField<CarromRules>[] = [
  { key: "play", label: "Playing for", hint: "First to pocket all nine of their pieces, or boards for points.", kind: "choice", options: [["clear", "First to clear"], ["points", "Points"]] },
  { key: "target", label: "Points to win", hint: `Playing for points: a board is worth a point for each piece the other side has left, and ${QUEEN_POINTS} for the queen. No more than ${MOST_BOARDS} boards.`, kind: "choice", options: TARGETS.map((t) => [String(t), String(t)]) },
  { key: "cover", label: "Cover the queen", hint: "After the queen, pocket one of your own with the same shot or the next, or she goes back. Off: she counts the moment she drops.", kind: "toggle" },
];

export const carrom: SportGame<CarromRules, CarromState, CarromMove> = {
  id: "carrom",
  name: "Carrom",
  emoji: "🪙",
  category: "sports",
  blurb: "The flick board: nine pieces a side, and the queen",
  tagline: "Flick the striker from your baseline and pocket your pieces before they pocket theirs.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "A square board with a pocket in each corner. Nine white pieces, nine black and the red queen start in the middle. White breaks.",
      "On your turn, put the striker anywhere on your baseline and flick it. Pocket one of your own pieces and you shoot again. One of theirs stays down, to their good.",
      r.cover ? "The queen has to be covered: pocket her, then one of your own with the same shot or your next one, or she goes back to the middle." : "The queen counts for whoever pockets her.",
      "Pocketing the striker is a foul: one of your pocketed pieces comes back out (or you owe one), with anything of yours that dropped on the shot.",
      "Nobody may finish while the queen is still on the board: a last piece pocketed too soon comes back out.",
      r.play === "clear" ? "The first side to pocket all nine of its pieces wins." : `A board goes to the side that clears its pieces: a point for each piece the other side has left, and ${QUEEN_POINTS} for the queen if the winner covered her. First to ${r.target} points, or whoever leads after ${MOST_BOARDS} boards.`,
      "Two players, or four as partners: the partners take turns from the same baseline.",
    ];
  },
  newGame: newCarrom,
  apply,
  view,
  bot,
  thinkingTime: (s) => thinkFor(s.boardShots === 0 ? 2 : 8, 1.1),
  summary(s) {
    const over = s.phase === "finished";
    const winners = s.winners ?? [];
    const points = s.rules.play === "points";
    const [a, b] = points ? s.points : [down(s.world, 0), down(s.world, 1)];
    return {
      game: "carrom",
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
