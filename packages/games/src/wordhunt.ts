// Word Hunt: a square of letters is turned over, and everyone hunts words in it at once. A word is
// traced from letter to touching letter (across, down or corner to corner), using each letter once.
// Each player's words are their own until time is up; then they are read out, and a word two
// players both found scores nothing for either.
//
// It is played against a clock: three minutes, by default. The engine has no clock of its own
// (nothing here reads the time); it adds up the time the table hands each move, and asks the table
// (through `deadline`) to end a player's hunt when the round's time has gone. A player can say
// they're done sooner.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, markReady, nextHandChoices, nextRandom, rankSeats, thinkFor, who, type BaseRules, type GameDeadline, type MoveTime, type RoundResult, type RuleField } from "./table.js";
import type { PlayedWord, WordGame, WordView } from "./word.js";
import { commonWords, isWord, tidyWord } from "./words.js";

export interface WordHuntRules extends BaseRules {
  /** The square's side: 4 or 5. */
  size: number;
  /** Seconds a round lasts, or 0 for no clock (a round ends when everyone says they're done). */
  seconds: number;
  rounds: number;
  /** A word two players both found scores nothing for either. */
  cancel: boolean;
}

export const huntClassic: WordHuntRules = { id: "classic", name: "Four by four", size: 4, seconds: 180, rounds: 1, cancel: true };
export const huntBig: WordHuntRules = { id: "big", name: "Five by five", size: 5, seconds: 180, rounds: 1, cancel: true };
export const huntRelaxed: WordHuntRules = { id: "relaxed", name: "No clock", size: 4, seconds: 0, rounds: 1, cancel: true };
const PRESETS = [huntClassic, huntBig, huntRelaxed];
const SIZES = [4, 5];
const SECONDS = [0, 90, 180, 300];
const ROUNDS = [1, 3];
const SHORTEST = 3;
const LONGEST = 8;
/** Points by a word's length. */
const POINTS: Record<number, number> = { 3: 1, 4: 2, 5: 3, 6: 5, 7: 7, 8: 10 };

// Letters are drawn by how often they turn up in words, Q left out (it wants a U it seldom gets).
const WEIGHTS = "eeeeeeeeeeeeaaaaaaaaaiiiiiiiioooooooonnnnnnrrrrrrttttttsssssslllllduuuuddddgggcccmmmbbppfhhhhvwwyykjxz";
/** How many common words a square needs before it is dealt. */
const ENOUGH: Record<number, number> = { 4: 25, 5: 45 };

export interface WordHuntState {
  game: "wordhunt";
  rules: WordHuntRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "round" | "finished";
  /** The square, row by row, as one string. */
  grid: string;
  /** Each seat's words, in the order found. Nobody else sees them until the round is over. */
  found: string[][];
  /** Who has said they're done (or run out of time). */
  done: boolean[];
  /** Ms of the round gone by, from the time the table hands each move. */
  spent: number;
  points: number[];
  ready: boolean[];
  result: RoundResult | null;
  /** The best words nobody found, shown with the round's result. */
  missed: string[];
  winners: number[] | null;
  narration: string | null;
}

export type WordHuntMove = { type: "word"; word: string } | { type: "done" } | { type: "next" };

// ---- Finding words in a square -------------------------------------------------------------------

/** Each tile's neighbours, for a square of side n. */
const neighbourCache = new Map<number, number[][]>();
function neighbours(n: number): number[][] {
  const had = neighbourCache.get(n);
  if (had) return had;
  const all = Array.from({ length: n * n }, (_, i) => {
    const r = Math.floor(i / n);
    const c = i % n;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && r + dr >= 0 && r + dr < n && c + dc >= 0 && c + dc < n) out.push((r + dr) * n + c + dc);
    return out;
  });
  neighbourCache.set(n, all);
  return all;
}

/** Whether a word can be traced on the square: from tile to touching tile, each once. */
export function traceable(grid: string, word: string): boolean {
  const n = Math.round(Math.sqrt(grid.length));
  const near = neighbours(n);
  const walk = (at: number, i: number, used: Set<number>): boolean => {
    if (grid[at] !== word[i]) return false;
    if (i === word.length - 1) return true;
    used.add(at);
    const ok = near[at]!.some((next) => !used.has(next) && walk(next, i + 1, used));
    used.delete(at);
    return ok;
  };
  return word.length > 0 && Array.from(grid, (_, at) => at).some((at) => walk(at, 0, new Set()));
}

let prefixes: Set<string> | null = null;
let known: Set<string> | null = null;
/** The common words, and every start of one: what a search through the square follows. */
function vocabulary() {
  if (!prefixes || !known) {
    prefixes = new Set();
    known = new Set();
    for (let n = SHORTEST; n <= LONGEST; n++) {
      for (const word of commonWords(n)) {
        known.add(word);
        for (let i = 1; i < word.length; i++) prefixes.add(word.slice(0, i));
      }
    }
  }
  return { prefixes, known };
}

const solved = new Map<string, string[]>();
/** Every common word in the square, longest first. */
export function wordsIn(grid: string): string[] {
  const had = solved.get(grid);
  if (had) return had;
  const { prefixes, known } = vocabulary();
  const n = Math.round(Math.sqrt(grid.length));
  const near = neighbours(n);
  const out = new Set<string>();
  const walk = (at: number, sofar: string, used: Set<number>) => {
    const word = sofar + grid[at];
    if (word.length >= SHORTEST && known.has(word)) out.add(word);
    if (word.length >= LONGEST || !prefixes.has(word)) return;
    used.add(at);
    for (const next of near[at]!) if (!used.has(next)) walk(next, word, used);
    used.delete(at);
  };
  for (let at = 0; at < grid.length; at++) walk(at, "", new Set());
  const words = [...out].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  if (solved.size > 64) solved.clear();
  solved.set(grid, words);
  return words;
}

const scoreOf = (word: string) => POINTS[word.length] ?? 0;

function deal(s: WordHuntState) {
  const rand = nextRandom(s);
  const n = s.rules.size;
  let grid = "";
  // A square with too few words in it is no fun: deal again (the dealing is part of the seed, so
  // the same game always gets the same square).
  for (let tries = 0; tries < 40; tries++) {
    grid = Array.from({ length: n * n }, () => WEIGHTS[Math.floor(rand() * WEIGHTS.length)]!).join("");
    if (wordsIn(grid).length >= ENOUGH[n]!) break;
  }
  s.grid = grid;
  s.found = Array.from({ length: s.seats }, () => []);
  s.done = Array<boolean>(s.seats).fill(false);
  s.spent = 0;
  s.ready = Array<boolean>(s.seats).fill(false);
  s.result = null;
  s.missed = [];
  s.phase = "playing";
}

export function newWordHunt(rules: WordHuntRules, seats: number, seed: number): WordHuntState {
  const s = { game: "wordhunt", rules, seats, rng: seed, hand: 1, dealer: 0, points: Array<number>(seats).fill(0), winners: null, narration: null } as unknown as WordHuntState;
  deal(s);
  return s;
}

/** Who else found a word. */
const finders = (s: WordHuntState, word: string) => s.found.flatMap((words, seat) => (words.includes(word) ? [seat] : []));
/** What a seat's word is worth this round: nothing if someone else found it too, when the house cancels. */
const worth = (s: WordHuntState, word: string) => (s.rules.cancel && s.seats > 1 && finders(s, word).length > 1 ? 0 : scoreOf(word));

function endRound(s: WordHuntState) {
  const scored = s.found.map((words) => words.reduce((sum, word) => sum + worth(s, word), 0));
  scored.forEach((n, seat) => (s.points[seat]! += n));
  const everyone = new Set(s.found.flat());
  s.missed = wordsIn(s.grid).filter((word) => !everyone.has(word)).slice(0, 6);
  s.result = {
    key: `wordhunt/${s.hand}`,
    title: s.seats === 1 ? `${s.found[0]!.length} ${s.found[0]!.length === 1 ? "word" : "words"}` : "Time's up: the words are read out",
    sides: Array.from({ length: s.seats }, (_, seat) => [seat]),
    rows: [
      { label: "Words", values: s.found.map((words) => String(words.length)) },
      ...(s.rules.cancel && s.seats > 1 ? [{ label: "Shared", values: s.found.map((words) => String(words.filter((word) => worth(s, word) === 0).length)) }] : []),
      { label: "This round", values: scored.map((n) => `+${n}`), tone: "score" as const },
      { label: "Points", values: s.points.map(String), tone: "total" as const },
    ],
  };
  s.narration = s.missed[0] ? `The longest word nobody found: ${s.missed[0].toUpperCase()}.` : "Every word found!";
  if (s.hand >= s.rules.rounds) {
    s.phase = "finished";
    const best = Math.max(...s.points);
    s.winners = s.points.flatMap((n, seat) => (n === best ? [seat] : []));
  } else {
    s.phase = "round";
    s.ready = Array<boolean>(s.seats).fill(false);
  }
}

function apply(state: WordHuntState, seat: number, move: WordHuntMove, time?: MoveTime): WordHuntState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "round") throw new GameError("The round isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    s.hand += 1;
    deal(s);
    s.narration = `Round ${s.hand} of ${s.rules.rounds}: a new square.`;
    return s;
  }
  if (move?.type !== "word" && move?.type !== "done") throw new GameError("That's not a move in Word Hunt.");
  if (state.phase !== "playing") throw new GameError(state.phase === "round" ? "This round is finished: move on to the next." : "This game is over.");
  if (state.done[seat]) throw new GameError("Your hunt is over for this round.");
  let word = "";
  if (move.type === "word") {
    word = tidyWord(move.word);
    if (word.length < SHORTEST) throw new GameError(`A word needs at least ${SHORTEST} letters.`);
    if (word.length > LONGEST) throw new GameError(`Words longer than ${LONGEST} letters aren't in the list.`);
    if (state.found[seat]!.includes(word)) throw new GameError(`You have ${word.toUpperCase()} already.`);
    if (!traceable(state.grid, word)) throw new GameError(`${word.toUpperCase()} can't be traced on the square.`);
    if (!isWord(word)) throw new GameError(`${word.toUpperCase()} isn't a word here.`);
  }
  const s = clone(state);
  s.spent += Math.max(0, Math.round(time?.elapsed ?? 0));
  if (move.type === "word") {
    s.found[seat]!.push(word);
    s.narration = null;
  } else {
    s.done[seat] = true;
    s.narration = `${who(seat)} is done.`;
  }
  // Time has run out for everyone once the round's time has gone (the table's deadline says so for each seat in turn).
  if (s.rules.seconds && s.spent >= s.rules.seconds * 1000) s.done = s.done.map(() => true);
  if (s.done.every(Boolean)) endRound(s);
  return s;
}

function view(s: WordHuntState, seat: number): WordView {
  const playing = s.phase === "playing";
  const n = s.rules.size;
  const hunting = playing && !s.done[seat];
  const words: PlayedWord[] = playing
    ? [...s.found[seat]!].reverse().map((word) => ({ word, by: seat, points: scoreOf(word) }))
    : [
        ...s.found.flatMap((list, by) =>
          list.map((word) => {
            const shared = finders(s, word);
            return { word, by, points: worth(s, word), note: shared.length > 1 && s.rules.cancel ? `also ${shared.filter((x) => x !== by).map(who).join(", ")}` : undefined };
          }),
        ),
        ...s.missed.map((word) => ({ word, by: null, note: "Nobody found it" })),
      ];
  const left = s.rules.seconds ? Math.max(0, s.rules.seconds - Math.floor(s.spent / 1000)) : 0;
  return {
    game: "wordhunt",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    boards: [{ id: "grid", label: "The letters", cols: n, rows: Array.from({ length: n }, (_, r) => Array.from(s.grid.slice(r * n, r * n + n), (letter) => ({ letter }))), trace: true }],
    rack: null,
    keys: {},
    entry: hunting ? { type: "word", prompt: s.found[seat]!.length ? `${s.found[seat]!.length} found` : "Trace a word", min: SHORTEST, max: LONGEST } : null,
    pick: null,
    words,
    choices: hunting ? { prompt: "", options: [{ label: "I'm done", move: { type: "done" }, confirm: "Stop hunting for this round?" }] } : s.phase === "round" ? nextHandChoices(s.ready, seat, false, "Next square") : null,
    players: Array.from({ length: s.seats }, (_, i) => ({ line: playing ? (s.done[i] ? "Done" : "Hunting") : `${s.found[i]!.length} words`, done: s.done[i] })),
    info: [`${n}×${n}`, ...(s.rules.seconds && playing ? [`About ${left >= 60 ? `${Math.ceil(left / 60)} min` : `${left} s`} left`] : []), ...(s.rules.rounds > 1 ? [`Round ${s.hand} of ${s.rules.rounds}`] : [])],
    narration: s.narration ?? (hunting ? `Words of ${SHORTEST} letters or more, from letter to touching letter.` : playing ? "Waiting for the others." : null),
    scores: s.points.map((value, i) => ({ seats: [i], value })),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.seats === 1 ? `${s.points[0]} points` : s.winners!.length === s.seats ? "All square" : `${s.winners!.map(who).join(" and ")} ${s.winners!.length === 1 ? "wins" : "win"}` } : null,
  };
}

/** How many of the square's words a computer player finds before it stops: fewer, and shorter, as skill drops. */
const reach = (s: WordHuntState, skill: number) => {
  const all = wordsIn(s.grid);
  return all.filter((word) => word.length <= 4 + Math.round(skill * 4)).slice(0, Math.max(3, Math.round(all.length * (0.12 + skill * 0.4))));
};

function bot(s: WordHuntState, seat: number, style: PlayStyle, rand: () => number = Math.random): WordHuntMove | null {
  if (s.phase === "round") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.done[seat]) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const mine = new Set(s.found[seat]);
  const left = reach(s, skill).filter((word) => !mine.has(word));
  if (!left.length) return { type: "done" };
  // Short words first, as people find them: a few letters to start with, then the longer ones.
  const pool = left.slice(-Math.max(1, Math.ceil(left.length / 3)));
  return { type: "word", word: pool[Math.floor(rand() * pool.length)]! };
}

function deadline(s: WordHuntState): GameDeadline<WordHuntMove> | null {
  if (s.phase !== "playing" || !s.rules.seconds) return null;
  const seat = s.done.findIndex((d) => !d);
  if (seat < 0) return null;
  return { seat, after: Math.max(0, s.rules.seconds * 1000 - s.spent), move: { type: "done" }, strict: true };
}

function normalize(rules: unknown): WordHuntRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<WordHuntRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? huntClassic;
  const one = (value: unknown, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);
  return { id: base.id, name: base.name, size: one(given.size, SIZES, base.size), seconds: one(given.seconds, SECONDS, base.seconds), rounds: one(given.rounds, ROUNDS, base.rounds), cancel: given.cancel === undefined ? base.cancel : given.cancel === true };
}

const FIELDS: RuleField<WordHuntRules>[] = [
  { key: "size", label: "Square", hint: "Four letters a side, or five.", kind: "choice", options: SIZES.map((n) => [String(n), `${n}×${n}`]) },
  { key: "seconds", label: "Time", hint: "How long a round lasts. No clock: a round ends when everyone is done.", kind: "choice", options: SECONDS.map((n) => [String(n), n === 0 ? "No clock" : n < 120 ? `${n} seconds` : `${n / 60} minutes`]) },
  { key: "rounds", label: "Rounds", hint: "How many squares are played.", kind: "choice", options: ROUNDS.map((n) => [String(n), String(n)]) },
  { key: "cancel", label: "Shared words cancel", hint: "A word two players both found scores nothing for either.", kind: "toggle" },
];

export const wordHunt: WordGame<WordHuntRules, WordHuntState, WordHuntMove> = {
  id: "wordhunt",
  name: "Word Hunt",
  emoji: "🔠",
  category: "words",
  blurb: "Trace words in a square of letters before time runs out",
  tagline: "One square of letters, a few minutes, and every word you can trace.",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `A square of letters, ${r.size} a side, the same for everyone. Find words of ${SHORTEST} letters or more by tracing from letter to touching letter: across, down or corner to corner, each letter once.`,
      r.seconds ? `You have ${r.seconds < 120 ? `${r.seconds} seconds` : `${r.seconds / 60} minutes`}, or until you say you're done.` : "There's no clock: the round ends when everyone says they're done.",
      "Nobody sees anyone else's words until the round is over.",
      `Longer words score more: ${Object.entries(POINTS).map(([n, p]) => `${n} letters ${p}`).join(", ")}.${r.cancel ? " A word two players both found scores nothing for either." : ""}`,
      `${r.rounds === 1 ? "One square" : `${r.rounds} squares`}, and the most points wins.`,
    ];
  },
  newGame: newWordHunt,
  apply,
  view,
  bot,
  heavy: (s, seat) => s.phase === "playing" && !s.done[seat] && !solved.has(s.grid),
  thinkingTime: () => thinkFor(3, 1.8),
  deadline,
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "wordhunt",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand,
      scoreLine: s.points.join(" · "),
      order: over ? rankSeats(s.points.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? (s.winners ?? []) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
