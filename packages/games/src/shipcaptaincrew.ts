// Ship, Captain, Crew: five dice and three rolls to put to sea. You need a six (the ship), then a
// five (the captain), then a four (the crew), in that order: a five is no use before there is a
// ship for the captain to board. Each is set aside as it turns up, and several can come in one
// roll. Once all three are aboard, the other two dice are your cargo, and with rolls to spare you
// can throw both of them again for a better one. Three rolls without a crew is no cargo at all.
//
// Everyone has a turn, and the biggest cargo takes the round; a tie for the biggest and nobody
// does. The first player to win so many rounds wins the game.
//
// There is no board and no sheet: the view is the board kit's `dice` (thrown here from the game's
// seeded random source, like a deal) and one or two buttons.
import type { PlayStyle } from "@journey-to-code/rules";
import type { BoardGame, BoardView } from "./board.js";
import { drink, newTally, type Tally } from "./drinks.js";
import { drinkingField } from "./kit.js";
import { careless, clone, GameError, nextRandom, rankSeats, who, type BaseRules } from "./table.js";

export interface ShipCaptainCrewRules extends BaseRules {
  /** Rounds to win the game. */
  wins: number;
  /** Drinking mode: the smallest cargo of a round drinks. */
  drinking: boolean;
}

export const classicShipCaptainCrew: ShipCaptainCrewRules = { id: "shipcaptaincrew-classic", name: "First to three", wins: 3, drinking: false };
export const longShipCaptainCrew: ShipCaptainCrewRules = { id: "shipcaptaincrew-long", name: "First to five", wins: 5, drinking: false };
export const oneShipCaptainCrew: ShipCaptainCrewRules = { id: "shipcaptaincrew-one", name: "One round", wins: 1, drinking: false };
export const drinkingShipCaptainCrew: ShipCaptainCrewRules = { ...classicShipCaptainCrew, id: "shipcaptaincrew-drinking", name: "Bar rules 🍺", drinking: true };
const PRESETS = [classicShipCaptainCrew, longShipCaptainCrew, oneShipCaptainCrew, drinkingShipCaptainCrew];
const WINS = [1, 3, 5];

export const SHIP_DICE = 5;
export const SHIP_ROLLS = 3;
/** What has to turn up, in order: the ship, the captain, the crew. */
const WANTED = [6, 5, 4];
const ABOARD = ["Looking for a ship: a six", "The ship is in: now a captain, a five", "Ship and captain: now a crew, a four"];

export interface ShipCaptainCrewState {
  game: "shipcaptaincrew";
  rules: ShipCaptainCrewRules;
  seats: number;
  rng: number;
  /** Which round, from 1. */
  round: number;
  /** Who rolls first this round, and whose turn it is. */
  first: number;
  turn: number;
  /** What the five dice show (0 before the first roll of the game). */
  dice: number[];
  /** Set aside as the ship, the captain or the crew. */
  aboard: boolean[];
  /** Rolls made this turn: 0 to 3. At 0 the dice are whatever the turn before left. */
  rolls: number;
  /** Every throw since the game began: what the table watches to know the dice were thrown. */
  throws: number;
  /** This round: who has had their turn, and the cargo they made (0 for none). */
  played: boolean[];
  cargo: number[];
  /** Rounds won. */
  won: number[];
  tally: Tally;
  phase: "playing" | "finished";
  narration: string | null;
}

export type ShipCaptainCrewMove = { type: "roll" } | { type: "stop" };

export function newShipCaptainCrew(rules: ShipCaptainCrewRules, seats: number, seed: number): ShipCaptainCrewState {
  const s = { game: "shipcaptaincrew", rules, seats, rng: seed >>> 0, round: 1, rolls: 0, throws: 0, phase: "playing", narration: null } as unknown as ShipCaptainCrewState;
  s.first = Math.floor(nextRandom(s)() * seats);
  s.turn = s.first;
  s.dice = Array<number>(SHIP_DICE).fill(0);
  s.aboard = Array<boolean>(SHIP_DICE).fill(false);
  s.played = Array<boolean>(seats).fill(false);
  s.cargo = Array<number>(seats).fill(0);
  s.won = Array<number>(seats).fill(0);
  s.tally = newTally(seats);
  return s;
}

/** How many of the ship, captain and crew are aboard: 0 to 3. */
const stage = (s: ShipCaptainCrewState) => s.aboard.filter(Boolean).length;
/** The two dice that aren't ship, captain or crew, added up: 0 until all three are aboard. */
export const shipCargo = (s: ShipCaptainCrewState): number => (s.rolls > 0 && stage(s) === WANTED.length ? s.dice.reduce((n, value, i) => n + (s.aboard[i] ? 0 : value), 0) : 0);
/** The biggest cargo made so far this round. */
const toBeat = (s: ShipCaptainCrewState) => Math.max(0, ...s.cargo.filter((_, i) => s.played[i]));

/** Everyone has rolled: the biggest cargo takes the round, unless two share it. */
function settle(s: ShipCaptainCrewState) {
  const best = Math.max(...s.cargo);
  const top = s.cargo.flatMap((c, seat) => (c === best ? [seat] : []));
  let line: string;
  if (best === 0) line = `Nobody put to sea in round ${s.round}`;
  else if (top.length > 1) line = `${top.map(who).join(" and ")} tie on ${best}: nobody takes round ${s.round}`;
  else {
    s.won[top[0]!]! += 1;
    line = `${who(top[0]!)} takes round ${s.round} with a cargo of ${best}`;
  }
  if (s.rules.drinking) {
    const least = Math.min(...s.cargo);
    // Everyone level: nobody is the smallest.
    if (least < best) line += ` · ${drink(s.tally, s.cargo.flatMap((c, seat) => (c === least ? [seat] : [])), 1)}`;
  }
  s.narration = `${s.narration}. ${line}`;
  if (s.won.some((n) => n >= s.rules.wins)) {
    s.phase = "finished";
    return;
  }
  s.round += 1;
  s.first = (s.first + 1) % s.seats;
  s.turn = s.first;
  s.played.fill(false);
  s.cargo.fill(0);
}

/** A seat's turn is over with what the dice show. */
function finish(s: ShipCaptainCrewState, seat: number) {
  const cargo = shipCargo(s);
  s.cargo[seat] = cargo;
  s.played[seat] = true;
  s.narration = cargo ? `${who(seat)} sails with a cargo of ${cargo}` : `${who(seat)} stays in port`;
  // The dice stay as they fell until the next roll picks them up.
  s.rolls = 0;
  s.aboard.fill(false);
  s.turn = (seat + 1) % s.seats;
  if (s.turn === s.first) settle(s);
}

function apply(state: ShipCaptainCrewState, seat: number, move: ShipCaptainCrewMove): ShipCaptainCrewState {
  if (move?.type !== "roll" && move?.type !== "stop") throw new GameError("That's not a move in Ship, Captain, Crew.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("You're not at this table.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");

  if (move.type === "stop") {
    if (state.rolls === 0) throw new GameError("Roll the dice first.");
    if (stage(state) < WANTED.length) throw new GameError("You can't stop without a ship, a captain and a crew.");
    const s = clone(state);
    finish(s, seat);
    return s;
  }

  const s = clone(state);
  const rand = nextRandom(s);
  s.dice = s.dice.map((value, i) => (s.aboard[i] ? value : 1 + Math.floor(rand() * 6)));
  s.rolls += 1;
  s.throws += 1;
  // Whatever is wanted next comes aboard, and then the one after it if this roll has that too.
  const before = stage(s);
  for (let need = before; need < WANTED.length; need++) {
    const die = s.dice.findIndex((value, i) => !s.aboard[i] && value === WANTED[need]);
    if (die < 0) break;
    s.aboard[die] = true;
  }
  const now = stage(s);
  const found = ["a ship", "a captain", "a crew"].slice(before, now);
  const cargo = shipCargo(s);
  s.narration =
    `${who(seat)} rolls` +
    (found.length ? ` and finds ${found.length > 1 ? `${found.slice(0, -1).join(", ")} and ${found.at(-1)}` : found[0]}` : before < WANTED.length ? ` and finds no ${["ship", "captain", "crew"][before]}` : "") +
    (cargo ? `: a cargo of ${cargo}` : "");
  if (s.rolls >= SHIP_ROLLS) finish(s, seat);
  return s;
}

const winnersOf = (s: ShipCaptainCrewState) => {
  const best = Math.max(...s.won);
  return s.won.flatMap((n, seat) => (n === best ? [seat] : []));
};

function bot(s: ShipCaptainCrewState, seat: number, style: PlayStyle, rand: () => number = Math.random): ShipCaptainCrewMove | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  if (stage(s) < WANTED.length) return { type: "roll" };
  const cargo = shipCargo(s);
  // A cargo that doesn't beat the best so far wins nothing: throw it again.
  if (cargo <= toBeat(s)) return { type: "roll" };
  // The last to roll this round has won it already.
  if ((seat + 1) % s.seats === s.first) return { type: "stop" };
  if (careless(style, rand)) return rand() < 0.5 ? { type: "stop" } : { type: "roll" };
  // Two dice average seven: with one roll left a six or less is worth throwing again, and with two a seven.
  return cargo <= (SHIP_ROLLS - s.rolls > 1 ? 7 : 6) ? { type: "roll" } : { type: "stop" };
}

const rounds = (n: number) => `${n} round${n === 1 ? "" : "s"}`;

function overTitle(s: ShipCaptainCrewState): string {
  const [w] = winnersOf(s);
  return s.rules.wins === 1 ? `${who(w!)} wins!` : `${who(w!)} wins, ${s.won[w!]} rounds to ${Math.max(0, ...s.won.filter((_, i) => i !== w))}!`;
}

function view(s: ShipCaptainCrewState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const spent = s.rolls === 0;
  const aboard = stage(s);
  const cargo = shipCargo(s);
  const left = SHIP_ROLLS - s.rolls;
  const best = toBeat(s);
  return {
    game: "shipcaptaincrew",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    grids: [],
    reserves: [],
    // The ship, the captain and the crew are held; dice from the turn before lie dimmed until the next roll.
    dice: { dice: s.dice.map((value, id) => ({ id, value: value || null, held: !spent && s.aboard[id]!, used: spent && value > 0 })), roll: s.throws, sides: 6, tap: null },
    choices: mine
      ? {
          prompt: spent ? "" : aboard < WANTED.length ? ABOARD[aboard]! : `A cargo of ${cargo}: keep it, or roll both dice again`,
          options: spent
            ? [{ label: "Roll the dice", move: { type: "roll" }, primary: true }]
            : aboard < WANTED.length
              ? [{ label: `Roll again (${left} left)`, move: { type: "roll" }, primary: true }]
              : [
                  // A cargo of eight or better usually stands; anything that doesn't lead the round can't.
                  { label: `Keep ${cargo}`, move: { type: "stop" }, primary: cargo >= 8 && cargo > best },
                  { label: `Roll the cargo again (${left} left)`, move: { type: "roll" }, primary: !(cargo >= 8 && cargo > best) },
                ],
        }
      : null,
    players: s.won.map((n, i) => ({
      line: [...(rules.wins > 1 ? [rounds(n)] : []), ...(over ? [] : s.played[i] ? [s.cargo[i] ? `cargo ${s.cargo[i]}` : "no cargo"] : s.turn === i && cargo ? [`cargo ${cargo}`] : []), ...(rules.drinking ? [`🍺 ${s.tally.drank[i]}`] : [])].join(" · "),
    })),
    info: [
      ...(rules.wins > 1 ? [over ? `${rounds(s.round)} played` : `Round ${s.round} · first to ${rules.wins}`] : []),
      ...(!over && !spent && aboard < WANTED.length ? [ABOARD[aboard]!] : []),
      ...(!over && best ? [`Cargo to beat: ${best}`] : []),
      ...(rules.drinking && !over ? ["🍺 The smallest cargo drinks"] : []),
    ],
    narration: s.narration,
    scores: s.won.map((value, i) => ({ seats: [i], value })),
    result: over
      ? {
          key: "final",
          title: overTitle(s),
          sides: s.won.map((_, i) => [i]),
          rows: [
            { label: "Last cargo", values: s.cargo.map(String) },
            { label: "Rounds won", values: s.won.map(String), tone: "total" as const },
            ...(rules.drinking ? [{ label: "Drinks 🍺", values: s.tally.drank.map(String) }] : []),
          ],
        }
      : null,
    over: over ? { winners: winnersOf(s), title: overTitle(s) } : null,
  };
}

function normalize(rules: unknown): ShipCaptainCrewRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ShipCaptainCrewRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicShipCaptainCrew;
  const r = { ...base, ...given };
  return { id: String(r.id), name: String(r.name), wins: WINS.includes(Number(r.wins)) ? Number(r.wins) : 3, drinking: !!r.drinking };
}

export const shipCaptainCrew: BoardGame<ShipCaptainCrewRules, ShipCaptainCrewState, ShipCaptainCrewMove> = {
  id: "shipcaptaincrew",
  name: "Ship, Captain, Crew",
  emoji: "⚓",
  category: "dice",
  blurb: "Find a 6, a 5 and a 4, then sail with the biggest cargo",
  tagline: "Three rolls to find a ship (6), a captain (5) and a crew (4), in that order. The other two dice are your cargo: biggest takes the round.",
  seats: { min: 2, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "wins", label: "Play to", kind: "choice", options: WINS.map((n) => [n, n === 1 ? "One round" : `${n} rounds won`]) },
    drinkingField<ShipCaptainCrewRules>("Adults only. The smallest cargo of each round takes a drink (water counts)."),
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `On your turn you have up to ${SHIP_ROLLS} rolls of five dice. You need a six (the ship), then a five (the captain), then a four (the crew), in that order. Each is set aside as it turns up, and one roll can bring more than one.`,
      "A five or a four counts for nothing until what comes before it is aboard: no captain without a ship, no crew without a captain.",
      "With all three aboard, the other two dice added together are your cargo. If you have rolls left you can throw both of them again, but you keep what the new roll gives you.",
      "No ship, captain and crew after three rolls is no cargo.",
      r.wins === 1 ? "Everyone has one turn, and the biggest cargo wins. If the biggest is shared, the round is played again." : `The biggest cargo takes the round; if it is shared, nobody does. The first to take ${r.wins} rounds wins.`,
      ...(r.drinking ? ["🍺 Drinking mode: the smallest cargo of each round takes a drink."] : []),
    ];
  },
  newGame: newShipCaptainCrew,
  apply,
  view,
  bot,
  // Rolling is quick; whether a cargo will stand takes a moment.
  thinkingTime: (s) => (shipCargo(s) ? 1200 : 750),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "shipcaptaincrew",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      scoreLine: s.won.join(" · ") + (s.rules.drinking ? ` · 🍺 ${s.tally.drank.join(" · ")}` : ""),
      order: over ? rankSeats(s.won.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
