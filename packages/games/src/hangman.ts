// Hangman: a hidden word, and the table takes turns to name a letter. A letter that is in the word
// is turned over wherever it stands, and scores its player a point for each place; a letter that
// isn't costs everyone one of the misses they share. Uncover the word before the misses run out.
//
// It is played together against the word, with a score kept: whoever turned over the most letters
// wins, and nobody does if the word beats the table. For one player it is the pencil-and-paper game.
import type { PlayStyle } from "@journey-to-code/rules";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, rankSeats, thinkFor, who, type BaseRules, type RoundResult, type RuleField } from "./table.js";
import type { WordGame, WordTone, WordView } from "./word.js";
import { commonWords, plainWords } from "./words.js";

export interface HangmanRules extends BaseRules {
  /** How long the words are: 5 or 6 letters, or 7 or 8. */
  words: "short" | "long";
  /** How many wrong letters the table may name before the word wins. */
  misses: number;
  rounds: number;
}

export const hangmanClassic: HangmanRules = { id: "classic", name: "Classic", words: "short", misses: 6, rounds: 3 };
export const hangmanLong: HangmanRules = { id: "long", name: "Long words", words: "long", misses: 7, rounds: 3 };
export const hangmanOne: HangmanRules = { id: "one", name: "One word", words: "short", misses: 6, rounds: 1 };
const PRESETS = [hangmanClassic, hangmanLong, hangmanOne];
const MISSES = [5, 6, 7, 8];
const ROUNDS = [1, 3, 5];
const ALPHABET = [..."abcdefghijklmnopqrstuvwxyz"];
/** The letters in the order people try them when they have nothing to go on. */
const USUAL = [..."etaoinshrdlucmfwypvbgkjqxz"];

export interface HangmanState {
  game: "hangman";
  rules: HangmanRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "round" | "finished";
  turn: number;
  /** The word. Only the letters that have been named are in any view until the round is over. */
  secret: string;
  /** The letters named so far, in order. */
  named: string[];
  points: number[];
  /** Words the table has uncovered, and words that beat it. */
  solved: number;
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
}

export type HangmanMove = { type: "letter"; letter: string } | { type: "next" };

const wrong = (s: HangmanState) => s.named.filter((letter) => !s.secret.includes(letter));
const uncovered = (s: HangmanState) => [...s.secret].every((letter) => s.named.includes(letter));

function deal(s: HangmanState, first: number) {
  const rand = nextRandom(s);
  const lengths = s.rules.words === "short" ? [5, 6] : [7, 8];
  s.secret = pickRandom([...plainWords(pickRandom(lengths, rand))], rand);
  s.named = [];
  s.turn = first;
  s.ready = Array<boolean>(s.seats).fill(false);
  s.result = null;
  s.phase = "playing";
}

export function newHangman(rules: HangmanRules, seats: number, seed: number): HangmanState {
  const s = { game: "hangman", rules, seats, rng: seed, hand: 1, dealer: 0, points: Array<number>(seats).fill(0), solved: 0, winners: null, narration: null } as unknown as HangmanState;
  deal(s, 0);
  return s;
}

function endRound(s: HangmanState, won: boolean) {
  if (won) s.solved += 1;
  const word = s.secret.toUpperCase();
  s.result = {
    key: `hangman/${s.hand}`,
    title: won ? `${word}: the table has it` : `The word was ${word}`,
    sides: Array.from({ length: s.seats }, (_, seat) => [seat]),
    rows: [{ label: "Letters turned over", values: s.points.map(String), tone: "total" }],
  };
  if (s.hand >= s.rules.rounds) {
    s.phase = "finished";
    const most = Math.max(...s.points);
    s.winners = s.points.flatMap((n, seat) => (n === most ? [seat] : []));
  } else {
    s.phase = "round";
    s.ready = Array<boolean>(s.seats).fill(false);
  }
}

function apply(state: HangmanState, seat: number, move: HangmanMove): HangmanState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "round") throw new GameError("The word isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    // Whoever would have gone next starts the next word.
    const first = s.turn;
    s.hand += 1;
    deal(s, first);
    s.narration = `Word ${s.hand} of ${s.rules.rounds}: ${who(first)} to start.`;
    return s;
  }
  if (move?.type !== "letter") throw new GameError("That's not a move in Hangman.");
  if (state.phase !== "playing") throw new GameError(state.phase === "round" ? "This word is finished: move on to the next." : "This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const letter = typeof move.letter === "string" ? move.letter.toLowerCase() : "";
  if (!ALPHABET.includes(letter)) throw new GameError("Name a letter.");
  if (state.named.includes(letter)) throw new GameError(`${letter.toUpperCase()} has been named already.`);
  const s = clone(state);
  s.named.push(letter);
  const places = [...s.secret].filter((l) => l === letter).length;
  s.points[seat]! += places;
  const left = s.rules.misses - wrong(s).length;
  s.narration = places ? `${who(seat)} names ${letter.toUpperCase()}: ${places === 1 ? "there is one" : `there are ${places}`}.` : `${who(seat)} names ${letter.toUpperCase()}: no. ${left === 0 ? "That was the last miss." : `${left} ${left === 1 ? "miss" : "misses"} left.`}`;
  s.turn = (seat + 1) % s.seats;
  if (uncovered(s)) endRound(s, true);
  else if (left <= 0) endRound(s, false);
  return s;
}

function view(s: HangmanState, seat: number): WordView {
  const playing = s.phase === "playing";
  const keys: Record<string, WordTone> = {};
  for (const letter of s.named) keys[letter] = s.secret.includes(letter) ? "hit" : "miss";
  const left = s.rules.misses - wrong(s).length;
  return {
    game: "hangman",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing ? s.turn : null,
    boards: [
      {
        id: "word",
        label: "The word",
        cols: s.secret.length,
        // A letter nobody has named is there, and not said; once the round is over the rest are shown.
        rows: [[...s.secret].map((letter) => (s.named.includes(letter) ? { letter, tone: "hit" as const } : playing ? { letter: "", hidden: true } : { letter, tone: "miss" as const }))],
      },
    ],
    rack: null,
    keys,
    entry: null,
    pick: playing && s.turn === seat ? { type: "letter", prompt: "Name a letter", letters: ALPHABET.filter((letter) => !s.named.includes(letter)) } : null,
    words: playing ? [] : [{ word: s.secret, by: null, note: "The word" }],
    choices: s.phase === "round" ? nextHandChoices(s.ready, seat, false, "Next word") : null,
    players: s.points.map((n, i) => ({ line: `${n} ${n === 1 ? "letter" : "letters"}`, badge: playing && s.turn === i ? "Naming" : undefined })),
    info: [`${left} ${left === 1 ? "miss" : "misses"} left`, ...(s.rules.rounds > 1 ? [`Word ${s.hand} of ${s.rules.rounds}`] : [])],
    narration: s.narration ?? (playing ? `A word of ${s.secret.length} letters. ${who(s.turn)} names a letter.` : null),
    scores: s.points.map((value, i) => ({ seats: [i], value })),
    result: s.result,
    over:
      s.phase === "finished"
        ? {
            winners: s.winners ?? [],
            title:
              s.seats === 1
                ? s.solved === s.rules.rounds ? (s.rules.rounds === 1 ? "You got it!" : "Every word!") : s.rules.rounds === 1 ? "The word won" : `${s.solved} of ${s.rules.rounds} words`
                : s.winners!.length === s.seats ? "All square" : `${s.winners!.map(who).join(" and ")} turned over the most`,
          }
        : null,
  };
}

function bot(s: HangmanState, seat: number, style: PlayStyle, rand: () => number = Math.random): HangmanMove | null {
  if (s.phase === "round") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const open = ALPHABET.filter((letter) => !s.named.includes(letter));
  // A careless player names the next of the usual letters, whatever is showing.
  if (careless(style, rand)) return { type: "letter", letter: USUAL.find((letter) => open.includes(letter))! };
  // Otherwise: from what is showing (the letters named, and where the right ones stand), the
  // words it could still be, and the letter that is in the most of them.
  const missed = new Set(wrong(s));
  const could = commonWords(s.secret.length).filter((word) => [...word].every((letter, i) => (s.named.includes(s.secret[i]!) ? letter === s.secret[i] : !s.named.includes(letter)) && !missed.has(letter)));
  const count: Record<string, number> = {};
  for (const word of could) for (const letter of new Set(word)) if (open.includes(letter)) count[letter] = (count[letter] ?? 0) + 1;
  const ranked = open.filter((letter) => count[letter]).sort((a, b) => count[b]! - count[a]! || USUAL.indexOf(a) - USUAL.indexOf(b));
  if (!ranked.length) return { type: "letter", letter: USUAL.find((letter) => open.includes(letter))! };
  // A sharp player takes the likeliest; a poorer one, one of the top few.
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  return { type: "letter", letter: pickRandom(ranked.slice(0, Math.max(1, Math.round(1 + (1 - skill) * 4))), rand) };
}

function normalize(rules: unknown): HangmanRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<HangmanRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? hangmanClassic;
  const one = (value: unknown, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);
  return { id: base.id, name: base.name, words: given.words === "short" || given.words === "long" ? given.words : base.words, misses: one(given.misses, MISSES, base.misses), rounds: one(given.rounds, ROUNDS, base.rounds) };
}

const FIELDS: RuleField<HangmanRules>[] = [
  { key: "words", label: "Words", hint: "Short words have 5 or 6 letters; long ones 7 or 8.", kind: "choice", options: [["short", "Short"], ["long", "Long"]] },
  { key: "misses", label: "Misses", hint: "How many wrong letters the table may name before the word wins.", kind: "choice", options: MISSES.map((n) => [String(n), String(n)]) },
  { key: "rounds", label: "Words played", hint: "How many words are played.", kind: "choice", options: ROUNDS.map((n) => [String(n), n === 1 ? "One" : String(n)]) },
];

export const hangman: WordGame<HangmanRules, HangmanState, HangmanMove> = {
  id: "hangman",
  name: "Hangman",
  emoji: "🪢",
  category: "words",
  blurb: "Name letters and uncover the word before the misses run out",
  tagline: "A hidden word, and a letter at a time to find it.",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `A hidden word of ${r.words === "short" ? "5 or 6" : "7 or 8"} letters. Take turns to name a letter.`,
      "A letter that is in the word is turned over everywhere it stands, and scores you a point for each place.",
      `A letter that isn't is a miss, and the table shares them: after ${r.misses} misses the word wins.`,
      `${r.rounds === 1 ? "One word" : `${r.rounds} words`}, and whoever turned over the most letters wins.`,
    ];
  },
  newGame: newHangman,
  apply,
  view,
  bot,
  thinkingTime: () => thinkFor(5, 1.2),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "hangman",
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
