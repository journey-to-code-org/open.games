// Air Hockey: the fifth game on the arcade kit, and the first that is two players face to face
// across a table. A puck on a cushion of air, a mallet each, a goal at each end. First to the
// target wins, or whoever is ahead when the clock runs out.
//
// Seat 0 has the near end (the bottom of the field) and seat 1 the far end. With one seat the far
// end is the house: a mallet the game moves for itself, inside the step, so a game for one is
// still the same game for the same seed and inputs.
//
// A seat's controls are where it wants its mallet: a point on the field. The mallet goes there as
// fast as a mallet can, and stays in its own half. That is all there is to steer, so a finger on
// the glass is the whole control.
//
// The table has three rules of its own:
//   - A goal is the puck reaching an end wall inside the mouth. The side scored on gets the puck.
//   - A side that sits on the puck for seven seconds loses it to the other side, as on a real table.
//   - At the clock, level scores play a minute of next goal wins. Still level, and it is a draw. So
//     a game always ends.
//
// Everything in the state is a whole number. Positions and speeds are kept in sixteenths of a
// field unit (a speed is sixteenths a tick), so a slow puck still slows smoothly. A tick is played
// in four parts, so a fast puck cannot pass through a mallet. A step uses only addition,
// multiplication, division, `Math.sqrt`, `Math.round` and `Math.trunc`.
import type { PlayStyle } from "@journey-to-code/rules";
import { toward, type ArcadeEvent, type ArcadeGame, type ArcadeRink, type ArcadeSummary, type ArcadeThing, type ArcadeView } from "./arcade.js";
import { nextRandom, who, type BaseRules } from "./table.js";

export const AIRHOCKEY_FIELD = { width: 6000, height: 8000 };
export const AIRHOCKEY_RATE = 60;
/** How big the puck and a mallet are, in field units. */
export const AIRHOCKEY_PUCK = 190;
export const AIRHOCKEY_MALLET = 330;
/** The furthest a mallet moves in a tick, in field units. */
export const AIRHOCKEY_MALLET_SPEED = 200;
/** Ticks a side may keep the puck in its own half. */
export const AIRHOCKEY_SLOW = AIRHOCKEY_RATE * 7;

const RATE = AIRHOCKEY_RATE;
/** How many of the state's own units make a field unit: the state counts in sixteenths. */
export const AIRHOCKEY_SCALE = 16;
const S = AIRHOCKEY_SCALE;
const W = AIRHOCKEY_FIELD.width * S;
const H = AIRHOCKEY_FIELD.height * S;
const CX = W / 2;
const CY = H / 2;
const PR = AIRHOCKEY_PUCK * S;
const MR = AIRHOCKEY_MALLET * S;
const REACH = PR + MR;
const MALLET_SPEED = AIRHOCKEY_MALLET_SPEED * S;
/** The parts a tick is played in. */
const PARTS = 4;
/** Ticks the table waits after a goal before the puck is put down again. */
const GOAL_PAUSE = RATE;
/** Ticks of next goal wins when the clock runs out level. */
const OVERTIME = RATE * 60;
/** Where a mallet waits, and where the puck is put down, as a distance from the middle of the table. */
const HOME = 3000 * S;
const SERVE = 1400 * S;
/** How fast two things must close for it to count as a strike, and how long before the next one counts. */
const STRIKE = 10 * S;
const STRIKE_GAP = 10;
const TONES = ["blue", "red"];

export interface AirHockeyRules extends BaseRules {
  /** Goals to win. */
  goals: number;
  /** Minutes on the clock. */
  minutes: number;
  /** How wide the goals are. */
  mouth: "narrow" | "regular" | "wide";
  /** How fast the puck can go. */
  puck: "steady" | "quick";
  /** How well the house plays the far end when there is one seat. */
  house: "gentle" | "fair" | "sharp";
}

export const AIRHOCKEY_PRESETS: AirHockeyRules[] = [
  { id: "classic", name: "Classic", goals: 7, minutes: 5, mouth: "regular", puck: "quick", house: "fair" },
  { id: "quick", name: "Quick match", goals: 3, minutes: 2, mouth: "regular", puck: "quick", house: "fair" },
  { id: "marathon", name: "Marathon", goals: 15, minutes: 10, mouth: "regular", puck: "quick", house: "fair" },
  { id: "wide", name: "Wide open", goals: 7, minutes: 5, mouth: "wide", puck: "quick", house: "fair" },
  { id: "tight", name: "Tight goals", goals: 5, minutes: 5, mouth: "narrow", puck: "quick", house: "fair" },
];

/** Half the width of a goal mouth, in field units. */
const MOUTHS = { narrow: 850, regular: 1000, wide: 1300 } as const;
/** The fastest the puck goes, in field units a tick. */
const PUCK_SPEEDS = { steady: 120, quick: 165 } as const;
/** How fast the house moves its mallet, in field units a tick. */
const HOUSE_PACE = { gentle: 55, fair: 95, sharp: 150 } as const;

/** What a seat's controls are doing: where it wants its mallet, in field units. Minus one for both leaves the mallet where it is. */
export interface AirHockeyInput {
  x: number;
  y: number;
}

interface Disc {
  x: number;
  y: number;
  /** For the puck, its speed. For a mallet, how far it moved this tick. */
  vx: number;
  vy: number;
}

export interface AirHockeyState {
  rules: AirHockeyRules;
  seats: number;
  rng: number;
  tick: number;
  phase: "play" | "goal" | "over";
  /** Goals for the near end and the far end. */
  goals: [number, number];
  /** Times each end has struck the puck. */
  hits: [number, number];
  /** The tick each end last struck it, and the tick it last came off a wall hard enough to hear. */
  struck: [number, number];
  knocked: number;
  /** Where across the far goal each end means to put its next shot, from the middle. It changes with every strike, so a rally does not repeat itself. */
  aims: [number, number];
  /** The near end's mallet and the far end's. */
  mallets: [Disc, Disc];
  puck: Disc;
  /** Ticks left before the puck is put down, after a goal. */
  pause: number;
  /** The end the puck is put down for. */
  serveTo: number;
  /** The half the puck is in, and how many ticks it has been there. */
  side: number;
  sideTicks: number;
  /** The tick the clock runs out. */
  endsAt: number;
  overtime: boolean;
  /** The end that won, 2 for a draw, -1 while it is being played. */
  winner: number;
  events: ArcadeEvent[];
}

const IDLE: AirHockeyInput = { x: -1, y: -1 };
const clamp = (n: number, low: number, high: number) => (n < low ? low : n > high ? high : n);
/** Rounded, and never "minus nothing". */
const round = (n: number) => Math.round(n) + 0;
const trunc = (n: number) => Math.trunc(n) + 0;
/** A sixteenth-of-a-unit number as field units, for a view or an event. */
const unit = (n: number) => round(n / S);

function safeInput(given: unknown): AirHockeyInput {
  if (!given || typeof given !== "object" || Array.isArray(given)) return IDLE;
  const g = given as Record<string, unknown>;
  if (typeof g.x !== "number" || typeof g.y !== "number" || !Number.isFinite(g.x) || !Number.isFinite(g.y) || g.x < 0 || g.y < 0) return IDLE;
  return { x: clamp(trunc(g.x), 0, AIRHOCKEY_FIELD.width), y: clamp(trunc(g.y), 0, AIRHOCKEY_FIELD.height) };
}

/** The nearest place to a point that an end's mallet can be: inside the walls, in its own half. */
function within(end: number, x: number, y: number): [number, number] {
  return [clamp(x, MR, W - MR), end === 0 ? clamp(y, CY + MR, H - MR) : clamp(y, MR, CY - MR)];
}

const mouthOf = (rules: AirHockeyRules) => MOUTHS[rules.mouth] * S;

/** Each end thinks again about where to shoot: somewhere across the far goal, by the state's own dice. */
function rethink(s: AirHockeyState) {
  const open = trunc((mouthOf(s.rules) * 4) / 5);
  const rand = nextRandom(s);
  s.aims = [Math.floor(rand() * (2 * open + 1)) - open, Math.floor(rand() * (2 * open + 1)) - open];
}

/** Put the puck down, still, in front of an end. */
function serve(s: AirHockeyState, end: number) {
  rethink(s);
  s.puck = { x: CX, y: end === 0 ? CY + SERVE : CY - SERVE, vx: 0, vy: 0 };
  s.side = end;
  s.sideTicks = 0;
  s.events.push({ kind: "serve", x: unit(s.puck.x), y: unit(s.puck.y), ...(end < s.seats ? { seat: end } : {}) });
}

function finish(s: AirHockeyState) {
  s.phase = "over";
  s.winner = s.goals[0] > s.goals[1] ? 0 : s.goals[1] > s.goals[0] ? 1 : 2;
  s.events.push({ kind: "over", x: unit(CX), y: unit(CY), ...(s.winner < s.seats ? { seat: s.winner } : {}) });
}

function goal(s: AirHockeyState, end: number) {
  s.goals[end]!++;
  s.events.push({ kind: "goal", x: unit(s.puck.x), y: end === 0 ? 0 : AIRHOCKEY_FIELD.height, text: `${s.goals[0]}–${s.goals[1]}`, amount: s.goals[end], ...(end < s.seats ? { seat: end } : {}) });
  if (s.goals[end]! >= s.rules.goals || s.overtime) return finish(s);
  s.phase = "goal";
  s.pause = GOAL_PAUSE;
  s.serveTo = 1 - end;
  s.puck.vx = 0;
  s.puck.vy = 0;
}

/** A wall gives back nine tenths of what hits it. */
const bounce = (v: number) => 0 - trunc((v * 9) / 10);

/** Keep the puck on the table. Returns the end that has just scored, or -1. */
function walls(s: AirHockeyState): number {
  const p = s.puck;
  const mouth = mouthOf(s.rules) - PR / 2;
  let hit = 0;
  if (p.x < PR) {
    p.x = PR;
    if (p.vx < 0) {
      hit = Math.max(hit, -p.vx);
      p.vx = bounce(p.vx);
    }
  } else if (p.x > W - PR) {
    p.x = W - PR;
    if (p.vx > 0) {
      hit = Math.max(hit, p.vx);
      p.vx = bounce(p.vx);
    }
  }
  if (p.y < PR) {
    if (Math.abs(p.x - CX) <= mouth) return 0;
    p.y = PR;
    if (p.vy < 0) {
      hit = Math.max(hit, -p.vy);
      p.vy = bounce(p.vy);
    }
  } else if (p.y > H - PR) {
    if (Math.abs(p.x - CX) <= mouth) return 1;
    p.y = H - PR;
    if (p.vy > 0) {
      hit = Math.max(hit, p.vy);
      p.vy = bounce(p.vy);
    }
  }
  if (hit > STRIKE * 2 && s.tick - s.knocked > STRIKE_GAP) {
    s.knocked = s.tick;
    s.events.push({ kind: "wall", x: unit(p.x), y: unit(p.y), amount: unit(hit) });
  }
  return -1;
}

/** A mallet against the puck. The mallet is not moved by it: the puck takes all of it. */
function strike(s: AirHockeyState, end: number) {
  const m = s.mallets[end]!;
  const p = s.puck;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const far = Math.sqrt(dx * dx + dy * dy);
  if (far >= REACH) return;
  // Which way the puck is from the mallet, in 1024ths. Dead centre: toward the middle of the table.
  const nx = far === 0 ? 0 : round((dx * 1024) / far);
  const ny = far === 0 ? (end === 0 ? -1024 : 1024) : round((dy * 1024) / far);
  p.x = m.x + round((nx * (REACH + S)) / 1024);
  p.y = m.y + round((ny * (REACH + S)) / 1024);
  // How fast they are closing along that line. A puck going away already is left alone.
  const closing = round(((p.vx - m.vx) * nx + (p.vy - m.vy) * ny) / 1024);
  if (closing >= 0) return;
  // The puck comes off with four fifths of the closing speed turned round, on top of the mallet's own.
  const push = round((-closing * 9) / 5);
  p.vx += round((push * nx) / 1024);
  p.vy += round((push * ny) / 1024);
  if (-closing > STRIKE && s.tick - s.struck[end]! > STRIKE_GAP) {
    s.hits[end]!++;
    s.struck[end as 0 | 1] = s.tick;
    rethink(s);
    s.events.push({ kind: "hit", x: unit(p.x), y: unit(p.y), amount: unit(-closing), ...(end < s.seats ? { seat: end } : {}) });
  }
}

/**
 * The puck caught between a mallet and a wall: the wall has put it back inside the mallet. A mallet
 * cannot go through the puck, so it is the mallet that gives way: it is moved back off the puck and
 * stops for the rest of the tick, and the puck loses half its speed.
 */
function squeeze(s: AirHockeyState, end: number) {
  const m = s.mallets[end]!;
  const p = s.puck;
  const dx = m.x - p.x;
  const dy = m.y - p.y;
  const far = Math.sqrt(dx * dx + dy * dy);
  if (far >= REACH) return;
  const [ox, oy] = far === 0 ? [0, end === 0 ? REACH + S : -(REACH + S)] : [round((dx * (REACH + S)) / far), round((dy * (REACH + S)) / far)];
  [m.x, m.y] = within(end, p.x + ox, p.y + oy);
  m.vx = 0;
  m.vy = 0;
  p.vx = trunc(p.vx / 2);
  p.vy = trunc(p.vy / 2);
}

/** The part of a tick's move that belongs to one of its parts, so the parts add up to exactly the whole. */
const part = (v: number, k: number) => trunc((v * (k + 1)) / PARTS) - trunc((v * k) / PARTS);

/**
 * Where an end would like its mallet, in the state's own units: behind the puck and through it
 * when the puck is on its side, in front of its goal when it is not. Whole numbers only: the house
 * plays by it inside a step.
 */
function plan(s: AirHockeyState, end: number): [number, number] {
  // Worked out as the near end sees it (own goal at the bottom), and turned round for the far end.
  const flip = (y: number) => (end === 0 ? y : H - y);
  const m = s.mallets[end]!;
  const my = flip(m.y);
  const homeY = CY + HOME;
  if (s.phase !== "play") return [CX, flip(homeY)];
  // Where the puck will be in a moment.
  const fx = clamp(s.puck.x + s.puck.vx * 4, PR, W - PR);
  const vy = end === 0 ? s.puck.vy : 0 - s.puck.vy;
  const fy = clamp(flip(s.puck.y) + vy * 4, PR, H - PR);
  const mine = fy > CY - PR && (vy > -40 * S || fy > CY + HOME / 2);
  if (!mine) {
    // Guard: between the puck and the goal, across the mouth.
    return [CX + trunc(((fx - CX) * mouthOf(s.rules)) / (W / 2)), flip(homeY)];
  }
  // Against the back wall there is no getting behind it. Come at it from the side wall's side and
  // sweep it along the wall toward the middle; in a corner there is no room for that, so stand off
  // and let it come out.
  if (fy > H - MR - 200 * S) {
    const left = fx < CX;
    if ((left ? fx : W - fx) < PR + 2 * MR + 100 * S) return [left ? fx + REACH + 300 * S : fx - REACH - 300 * S, flip(H - MR - 500 * S)];
    return [left ? fx - REACH + 60 * S : fx + REACH - 60 * S, flip(H - MR)];
  }
  if (my < fy + 100 * S) {
    // On the wrong side of it: go round, on whichever side the mallet already is.
    return [fx + (m.x >= fx ? REACH + 80 * S : -(REACH + 80 * S)), flip(fy + REACH)];
  }
  // Behind it. Line up on the place in the far goal this end has in mind, and once lined up go
  // through the puck.
  const [ax, ay] = toward(CX + s.aims[end]!, 0, fx, fy, REACH);
  const lineX = fx + ax;
  const lineY = fy + ay;
  const off = Math.abs(m.x - lineX) + Math.abs(my - lineY);
  if (off > 260 * S) return [lineX, flip(lineY)];
  return [fx - ax, flip(fy - ay)];
}

/** Move an end's mallet toward a point, no further than `pace`, and note how far it went. */
function steer(s: AirHockeyState, end: number, x: number, y: number, pace: number) {
  const m = s.mallets[end]!;
  const [tx, ty] = within(end, x, y);
  const dx = tx - m.x;
  const dy = ty - m.y;
  if (dx * dx + dy * dy <= pace * pace) {
    m.vx = dx;
    m.vy = dy;
  } else {
    [m.vx, m.vy] = toward(m.x, m.y, tx, ty, pace);
  }
}

function step(s: AirHockeyState, inputs: readonly (AirHockeyInput | null | undefined)[]): void {
  if (s.phase === "over") return;
  s.events = [];
  s.tick++;
  for (let end = 0; end < 2; end++) {
    const m = s.mallets[end]!;
    m.vx = 0;
    m.vy = 0;
    if (end < s.seats) {
      const input = safeInput(inputs[end]);
      if (input.x >= 0) steer(s, end, input.x * S, input.y * S, MALLET_SPEED);
    } else {
      const [x, y] = plan(s, end);
      steer(s, end, x, y, HOUSE_PACE[s.rules.house] * S);
    }
  }
  const p = s.puck;
  for (let k = 0; k < PARTS; k++) {
    for (const m of s.mallets) {
      m.x += part(m.vx, k);
      m.y += part(m.vy, k);
    }
    if (s.phase !== "play") continue;
    p.x += part(p.vx, k);
    p.y += part(p.vy, k);
    let scored = walls(s);
    if (scored < 0) {
      strike(s, 0);
      strike(s, 1);
      scored = walls(s);
      if (scored < 0) {
        squeeze(s, 0);
        squeeze(s, 1);
      }
    }
    if (scored >= 0) {
      goal(s, scored);
      // The goal may have been the last one.
      if ((s.phase as AirHockeyState["phase"]) === "over") return;
    }
  }
  if (s.phase === "goal") {
    if (--s.pause <= 0) {
      s.phase = "play";
      serve(s, s.serveTo);
    }
  } else {
    // The air takes a four-hundredth of the puck's speed a tick, and never less than a sixteenth.
    p.vx -= trunc(p.vx / 400) || Math.sign(p.vx);
    p.vy -= trunc(p.vy / 400) || Math.sign(p.vy);
    const top = PUCK_SPEEDS[s.rules.puck] * S;
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > top) {
      p.vx = round((p.vx * top) / speed);
      p.vy = round((p.vy * top) / speed);
    }
    p.vx += 0;
    p.vy += 0;
    // Seven seconds in one half and the other side gets it.
    const side = p.y > CY ? 0 : 1;
    if (side !== s.side) {
      s.side = side;
      s.sideTicks = 0;
    } else if (++s.sideTicks >= AIRHOCKEY_SLOW) {
      s.events.push({ kind: "slow", x: unit(p.x), y: unit(p.y), ...(side < s.seats ? { seat: side } : {}) });
      serve(s, 1 - side);
    }
  }
  if (s.tick >= s.endsAt) {
    if (s.goals[0] !== s.goals[1] || s.overtime) return finish(s);
    s.overtime = true;
    s.endsAt += OVERTIME;
    s.events.push({ kind: "overtime", x: unit(CX), y: unit(CY) });
  }
}

/** A thousand a goal, and a point for every time the puck was struck, up to 999. */
const pointsOf = (s: AirHockeyState, end: number) => s.goals[end]! * 1000 + Math.min(999, s.hits[end]!);

function summary(s: AirHockeyState): ArcadeSummary {
  const scores = Array.from({ length: s.seats }, (_, seat) => s.goals[seat]!);
  const line = `${who(0)} ${s.goals[0]}, ${s.seats > 1 ? who(1) : "the house"} ${s.goals[1]}`;
  const winner = s.winner === 0 ? who(0) : s.seats > 1 ? who(1) : "The house";
  return {
    game: "airhockey",
    rules: s.rules.name,
    phase: s.phase === "over" ? "over" : s.overtime ? "next goal wins" : "playing",
    over: s.phase === "over",
    seats: s.seats,
    ticks: s.tick,
    score: Math.max(...Array.from({ length: s.seats }, (_, seat) => pointsOf(s, seat))),
    scores,
    scoreLine: s.phase !== "over" ? line : s.winner === 2 ? `A draw: ${line}` : `${winner} won: ${line}`,
    order: s.seats > 1 && s.goals[1] > s.goals[0] ? [1, 0] : Array.from({ length: s.seats }, (_, seat) => seat),
  };
}

function view(s: AirHockeyState): ArcadeView {
  const things: ArcadeThing[] = s.mallets.map((m, end) => ({ id: 10 + end, kind: "mallet", x: unit(m.x), y: unit(m.y), r: AIRHOCKEY_MALLET, tone: TONES[end]!, ...(end < s.seats ? { seat: end } : {}) }));
  if (s.phase !== "goal") things.push({ id: 1, kind: "puck", x: unit(s.puck.x), y: unit(s.puck.y), r: AIRHOCKEY_PUCK, tone: "gold" });
  const rink: ArcadeRink = {
    phase: s.phase,
    goalHalf: MOUTHS[s.rules.mouth],
    goals: [s.goals[0], s.goals[1]],
    target: s.rules.goals,
    ticksLeft: Math.max(0, s.endsAt - s.tick),
    overtime: s.overtime,
    ends: [0, 1].map((end) => ({ seat: end < s.seats ? end : null, x: unit(s.mallets[end]!.x), y: unit(s.mallets[end]!.y) })),
    puck: s.phase === "goal" ? null : { x: unit(s.puck.x), y: unit(s.puck.y), vx: unit(s.puck.vx), vy: unit(s.puck.vy) },
    slow: s.phase === "play" ? { end: s.side, ticksLeft: AIRHOCKEY_SLOW - s.sideTicks } : null,
    winner: s.winner < 0 ? null : s.winner,
  };
  const sum = summary(s);
  return {
    game: "airhockey",
    tick: s.tick,
    rate: RATE,
    seats: s.seats,
    field: AIRHOCKEY_FIELD,
    things,
    pilots: Array.from({ length: s.seats }, (_, seat) => ({
      seat,
      playing: s.phase !== "over",
      score: s.goals[seat]!,
      lives: 0,
      stats: [
        { key: "goals", label: "Goals", value: s.goals[seat]!, max: s.rules.goals },
        { key: "against", label: s.seats > 1 ? "Against" : "House", value: s.goals[1 - seat]!, max: s.rules.goals },
      ],
    })),
    score: sum.score,
    stage: s.phase === "over" ? "Full time" : s.overtime ? "Next goal wins" : `${s.goals[0]}–${s.goals[1]}`,
    ...(s.phase === "goal" ? { banner: `${s.goals[0]}–${s.goals[1]}` } : s.overtime && s.phase !== "over" && s.endsAt - s.tick > OVERTIME - RATE * 2 ? { banner: "Next goal wins" } : {}),
    rink,
    events: s.events,
    over: s.phase === "over",
  };
}

/**
 * A computer player's mallet. It plays by the same plan as the house, as fast as its skill allows,
 * and a careless one hesitates and misjudges.
 */
function bot(s: AirHockeyState, seat: number, style: PlayStyle, rand: () => number = Math.random): AirHockeyInput {
  const m = s.mallets[seat];
  if (!m || s.phase === "over") return IDLE;
  const skill = style.skill ?? 0.6;
  const sloppy = style.sloppy ?? 0.1;
  if (s.phase === "play" && rand() < sloppy * 0.25) return IDLE;
  let [x, y] = plan(s, seat);
  if (s.phase === "play" && sloppy > 0) {
    x += (rand() - 0.5) * sloppy * 900 * S;
    y += (rand() - 0.5) * sloppy * 900 * S;
  }
  [x, y] = within(seat, Math.round(x), Math.round(y));
  // No faster than its skill: a point that far along the way is as far as the mallet will go this tick.
  const pace = Math.round(50 + skill * 130) * S;
  const far = Math.hypot(x - m.x, y - m.y);
  if (far > pace) {
    x = m.x + ((x - m.x) * pace) / far;
    y = m.y + ((y - m.y) * pace) / far;
  }
  return safeInput({ x: Math.round(x / S), y: Math.round(y / S) });
}

// ---- The game ------------------------------------------------------------------------------------

const whole = (n: unknown, low: number, high: number, or: number) => (typeof n === "number" && Number.isFinite(n) ? clamp(Math.trunc(n), low, high) : or);

function normalize(rules: unknown): AirHockeyRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<AirHockeyRules>;
  const preset = AIRHOCKEY_PRESETS.find((p) => p.id === given.id) ?? AIRHOCKEY_PRESETS[0]!;
  return {
    id: typeof given.id === "string" ? given.id : preset.id,
    name: typeof given.name === "string" && given.name ? given.name : preset.name,
    goals: whole(given.goals, 1, 15, preset.goals),
    minutes: whole(given.minutes, 1, 10, preset.minutes),
    mouth: given.mouth === "narrow" || given.mouth === "regular" || given.mouth === "wide" ? given.mouth : preset.mouth,
    puck: given.puck === "steady" || given.puck === "quick" ? given.puck : preset.puck,
    house: given.house === "gentle" || given.house === "fair" || given.house === "sharp" ? given.house : preset.house,
  };
}

export const airHockey: ArcadeGame<AirHockeyRules, AirHockeyState, AirHockeyInput> = {
  id: "airhockey",
  name: "Air Hockey",
  emoji: "🏒",
  category: "arcade",
  blurb: "A puck on air, a mallet each, and a goal to guard",
  tagline: "Slide your mallet, knock the puck into the far goal and keep it out of yours. Against the house, or face to face with someone else.",
  seats: { min: 1, max: 2, default: 2 },
  teams: false,
  presets: AIRHOCKEY_PRESETS,
  fields: [
    { key: "goals", label: "Goals to win", kind: "number", min: 1, max: 15 },
    { key: "minutes", label: "Minutes", hint: "Whoever is ahead when the clock runs out wins. Level, and it is a minute of next goal wins", kind: "number", min: 1, max: 10 },
    { key: "mouth", label: "Goals", kind: "choice", options: [["narrow", "Narrow"], ["regular", "Regular"], ["wide", "Wide"]] },
    { key: "puck", label: "Puck", hint: "How fast it can go", kind: "choice", options: [["steady", "Steady"], ["quick", "Quick"]] },
    { key: "house", label: "The house", hint: "How well the far end is played when you are on your own", kind: "choice", options: [["gentle", "Gentle"], ["fair", "Fair"], ["sharp", "Sharp"]] },
  ],
  normalize,
  validate(rules) {
    const problems: string[] = [];
    if (!Number.isInteger(rules.goals) || rules.goals < 1 || rules.goals > 15) problems.push("A game is to between 1 and 15 goals.");
    if (!Number.isInteger(rules.minutes) || rules.minutes < 1 || rules.minutes > 10) problems.push("The clock is from 1 to 10 minutes.");
    if (!(rules.mouth in MOUTHS)) problems.push("The goals are narrow, regular or wide.");
    if (!(rules.puck in PUCK_SPEEDS)) problems.push("The puck is steady or quick.");
    if (!(rules.house in HOUSE_PACE)) problems.push("The house is gentle, fair or sharp.");
    return problems;
  },
  describe(rules) {
    return [
      `First to ${rules.goals} ${rules.goals === 1 ? "goal" : "goals"} wins, or whoever is ahead after ${rules.minutes} ${rules.minutes === 1 ? "minute" : "minutes"}.`,
      "Level at the clock, and it is a minute of next goal wins. Still level, and it is a draw.",
      `${rules.mouth === "regular" ? "Regular" : rules.mouth === "wide" ? "Wide" : "Narrow"} goals, and a ${rules.puck} puck.`,
      "Your mallet stays in your own half. After a goal the puck goes to the side that was scored on.",
      "Keep the puck in your half for seven seconds and the other side gets it.",
      `On your own, the house plays the far end: ${rules.house}.`,
    ];
  },
  controls: [
    "Drag your mallet with a finger or the mouse. It follows as fast as a mallet can.",
    "Hit the puck into the goal at the far end, and get in the way of it at yours.",
    "Two on one screen: one at each end, a finger each.",
  ],
  rate: RATE,
  newGame(rules, seats, seed) {
    const count = clamp(Math.trunc(seats) || 1, 1, 2);
    const s: AirHockeyState = {
      rules,
      seats: count,
      rng: seed >>> 0,
      tick: 0,
      phase: "play",
      goals: [0, 0],
      hits: [0, 0],
      struck: [0, 0],
      knocked: 0,
      aims: [0, 0],
      mallets: [
        { x: CX, y: CY + HOME, vx: 0, vy: 0 },
        { x: CX, y: CY - HOME, vx: 0, vy: 0 },
      ],
      puck: { x: CX, y: CY, vx: 0, vy: 0 },
      pause: 0,
      serveTo: 0,
      side: 0,
      sideTicks: 0,
      endsAt: rules.minutes * 60 * RATE,
      overtime: false,
      winner: -1,
      events: [],
    };
    // The puck starts in the middle, drifting toward one end or the other.
    const rand = nextRandom(s);
    const toward0 = rand() < 0.5;
    s.puck.vy = (toward0 ? 1 : -1) * (18 + Math.floor(rand() * 8)) * S;
    s.puck.vx = (Math.floor(rand() * 21) - 10) * S;
    s.side = toward0 ? 0 : 1;
    rethink(s);
    return s;
  },
  idle: IDLE,
  input: safeInput,
  step,
  view,
  bot,
  summary,
};

/** The colour of an end's mallet: the near end's, then the far end's. */
export const airHockeyTone = (end: number) => TONES[end % TONES.length]!;
