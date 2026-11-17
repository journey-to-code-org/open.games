// Secret Word: everyone at the table guesses the same hidden word, each on their own board, at
// their own pace. A guess has to be a word; each letter of it comes back marked as in its place,
// in the word somewhere else, or not in it. Six tries (or as many as the house says).
//
// For one player it is the daily-puzzle game. For more it is a race in tries, not in time: you see
// how the others' guesses went (the coloured squares, never the letters), and a round scores a
// point for every try you had left, plus one for getting it. Play one word or a few.
//
// The word comes from the plain words (the ones everyone knows); a guess may be any word at all.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, rankSeats, thinkFor, who, type BaseRules, type RoundResult, type RuleField } from "./table.js";
import { compareWords, keysFrom, type WordGame, type WordTile, type WordView } from "./word.js";
import { commonWords, isWord, plainWords, tidyWord } from "./words.js";

export interface SecretWordRules extends BaseRules {
  /** How long the word is. */
  length: number;
  /** How many guesses each player gets. */
  tries: number;
  /** How many words are played. */
  rounds: number;
}

export const secretFive: SecretWordRules = { id: "five", name: "Five letters", length: 5, tries: 6, rounds: 1 };
export const secretThree: SecretWordRules = { id: "three", name: "Best of three words", length: 5, tries: 6, rounds: 3 };
export const secretSix: SecretWordRules = { id: "six", name: "Six letters", length: 6, tries: 7, rounds: 1 };
const PRESETS = [secretFive, secretThree, secretSix];
const LENGTHS = [4, 5, 6, 7];
const TRIES = [5, 6, 7, 8];
const ROUNDS = [1, 3, 5];

export interface SecretWordState {
  game: "secretword";
  rules: SecretWordRules;
  seats: number;
  rng: number;
  /** The word being played, from 1. */
  hand: number;
  dealer: 0;
  phase: "playing" | "round" | "finished";
  /** The word. It is in no view until the round is over. */
  secret: string;
  /** Each seat's guesses, in order. */
  guesses: string[][];
  points: number[];
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
}

export type SecretWordMove = { type: "guess"; word: string } | { type: "next" };

const solved = (s: SecretWordState, seat: number) => s.guesses[seat]!.includes(s.secret);
const done = (s: SecretWordState, seat: number) => solved(s, seat) || s.guesses[seat]!.length >= s.rules.tries;
/** A point for getting it, and one for every try left over. */
const worth = (s: SecretWordState, seat: number) => (solved(s, seat) ? 1 + s.rules.tries - s.guesses[seat]!.length : 0);

function deal(s: SecretWordState) {
  s.secret = pickRandom([...plainWords(s.rules.length)], nextRandom(s));
  s.guesses = Array.from({ length: s.seats }, () => []);
  s.ready = Array<boolean>(s.seats).fill(false);
  s.result = null;
  s.phase = "playing";
}

export function newSecretWord(rules: SecretWordRules, seats: number, seed: number): SecretWordState {
  const s = { game: "secretword", rules, seats, rng: seed, hand: 1, dealer: 0, points: Array<number>(seats).fill(0), winners: null, narration: null } as unknown as SecretWordState;
  deal(s);
  return s;
}

function endRound(s: SecretWordState) {
  const scored = Array.from({ length: s.seats }, (_, seat) => worth(s, seat));
  scored.forEach((n, seat) => (s.points[seat]! += n));
  const word = s.secret.toUpperCase();
  s.result = {
    key: `secretword/${s.hand}`,
    title: `The word was ${word}`,
    sides: Array.from({ length: s.seats }, (_, seat) => [seat]),
    rows: [
      { label: "Guesses", values: Array.from({ length: s.seats }, (_, seat) => (solved(s, seat) ? String(s.guesses[seat]!.length) : "Missed")) },
      { label: "This word", values: scored.map((n) => `+${n}`), tone: "score" },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
  const got = Array.from({ length: s.seats }, (_, seat) => seat).filter((seat) => solved(s, seat));
  s.narration = got.length ? `The word was ${word}. ${got.map(who).join(", ")} got it.` : `The word was ${word}. Nobody got it.`;
  if (s.hand >= s.rules.rounds) {
    s.phase = "finished";
    const best = Math.max(...s.points);
    s.winners = Array.from({ length: s.seats }, (_, seat) => seat).filter((seat) => s.points[seat] === best);
  } else {
    s.phase = "round";
    s.ready = Array<boolean>(s.seats).fill(false);
  }
}

function apply(state: SecretWordState, seat: number, move: SecretWordMove): SecretWordState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "round") throw new GameError("The word isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    s.hand += 1;
    deal(s);
    s.narration = `Word ${s.hand} of ${s.rules.rounds}.`;
    return s;
  }
  if (move?.type !== "guess") throw new GameError("That's not a move in Secret Word.");
  if (state.phase !== "playing") throw new GameError(state.phase === "round" ? "This word is finished: move on to the next." : "This game is over.");
  if (done(state, seat)) throw new GameError(solved(state, seat) ? "You've got it already." : "You're out of guesses.");
  const word = tidyWord(move.word);
  if (word.length !== state.rules.length) throw new GameError(`The word has ${state.rules.length} letters.`);
  if (!isWord(word)) throw new GameError(`${word.toUpperCase()} isn't a word here.`);
  if (state.guesses[seat]!.includes(word)) throw new GameError(`You've tried ${word.toUpperCase()}.`);
  const s = clone(state);
  s.guesses[seat]!.push(word);
  // Nothing is said of the guess itself: the others would hear it.
  s.narration = solved(s, seat) ? `${who(seat)} has it, in ${s.guesses[seat]!.length}!` : done(s, seat) ? `${who(seat)} is out of guesses.` : null;
  if (Array.from({ length: s.seats }, (_, i) => i).every((i) => done(s, i))) endRound(s);
  return s;
}

function view(s: SecretWordState, seat: number): WordView {
  const playing = s.phase === "playing";
  const mine = s.guesses[seat]!;
  const blank: WordTile[] = Array.from({ length: s.rules.length }, () => ({ letter: "" }));
  const rows = Array.from({ length: s.rules.tries }, (_, i) => {
    const guess = mine[i];
    if (!guess) return blank;
    const tones = compareWords(guess, s.secret);
    return Array.from(guess, (letter, at) => ({ letter, tone: tones[at]! }));
  });
  const left = s.rules.tries - mine.length;
  return {
    game: "secretword",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    boards: [{ id: "guesses", label: "Your guesses", owner: seat, cols: s.rules.length, rows }],
    rack: null,
    keys: keysFrom(mine, s.secret),
    entry: playing && !done(s, seat) ? { type: "guess", prompt: mine.length ? `${left} ${left === 1 ? "guess" : "guesses"} left` : "Guess the word", min: s.rules.length, max: s.rules.length } : null,
    pick: null,
    // The answer is shown once nobody is still guessing at it.
    words: playing ? [] : [{ word: s.secret, by: null, note: "The word" }],
    choices: s.phase === "round" ? nextHandChoices(s.ready, seat, false, "Next word") : null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: solved(s, i) ? `Got it in ${s.guesses[i]!.length}` : done(s, i) ? "Out of guesses" : `${s.guesses[i]!.length} of ${s.rules.tries}`,
      done: done(s, i),
      marks: s.guesses[i]!.map((guess) => compareWords(guess, s.secret)),
    })),
    info: [`${s.rules.length} letters`, ...(s.rules.rounds > 1 ? [`Word ${s.hand} of ${s.rules.rounds}`] : [])],
    narration: s.narration ?? (playing ? (done(s, seat) ? "Waiting for the others." : mine.length ? null : "Type a word. Green is the right letter in the right place; gold is in the word, somewhere else.") : null),
    scores: Array.from({ length: s.seats }, (_, i) => ({ seats: [i], value: s.points[i]! })),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.seats === 1 ? (s.points[0] ? `Solved: ${s.points[0]} ${s.points[0] === 1 ? "point" : "points"}` : "Not this time") : s.winners!.length === s.seats ? "All square" : `${s.winners!.map(who).join(" and ")} ${s.winners!.length === 1 ? "wins" : "win"}` } : null,
  };
}

/** Whether a word could still be the answer, given how a guess at it came out. */
const fitsGuess = (candidate: string, guess: string, tones: readonly string[]) => compareWords(guess, candidate).every((tone, i) => tone === tones[i]);

function bot(s: SecretWordState, seat: number, style: PlayStyle, rand: () => number = Math.random): SecretWordMove | null {
  if (s.phase === "round") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || done(s, seat)) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const mine = s.guesses[seat]!;
  // It reasons from its own board alone: its guesses and how each came out.
  const seen = mine.map((guess) => ({ guess, tones: compareWords(guess, s.secret) }));
  const untried = (words: readonly string[]) => words.filter((w) => !mine.includes(w));
  // A sharp player's vocabulary is every common word; a poorer one knows fewer, and now and then
  // forgets one of the clues it has been given.
  const known = untried(skill > 0.5 ? commonWords(s.rules.length) : plainWords(s.rules.length));
  const heeded = seen.filter(() => rand() < 0.2 + skill * 0.8);
  const fitting = known.filter((w) => heeded.every((g) => fitsGuess(w, g.guess, g.tones)));
  const pool = fitting.length ? fitting : known.length ? known : untried(commonWords(s.rules.length));
  return { type: "guess", word: pickRandom([...pool], rand) };
}

function normalize(rules: unknown): SecretWordRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SecretWordRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? secretFive;
  const one = (value: unknown, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);
  return { id: base.id, name: base.name, length: one(given.length, LENGTHS, base.length), tries: one(given.tries, TRIES, base.tries), rounds: one(given.rounds, ROUNDS, base.rounds) };
}

const FIELDS: RuleField<SecretWordRules>[] = [
  { key: "length", label: "Letters", hint: "How long the word is.", kind: "choice", options: LENGTHS.map((n) => [String(n), String(n)]) },
  { key: "tries", label: "Guesses", hint: "How many tries each player gets.", kind: "choice", options: TRIES.map((n) => [String(n), String(n)]) },
  { key: "rounds", label: "Words", hint: "How many words are played. Points add up across them.", kind: "choice", options: ROUNDS.map((n) => [String(n), n === 1 ? "One" : String(n)]) },
];

export const secretWord: WordGame<SecretWordRules, SecretWordState, SecretWordMove> = {
  id: "secretword",
  name: "Secret Word",
  emoji: "🟩",
  category: "words",
  blurb: "Guess the hidden word in six tries",
  tagline: "One hidden word, six guesses, and a clue in every letter.",
  seats: { min: 1, max: 6, default: 1 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `A hidden word of ${r.length} letters. You have ${r.tries} guesses, and every guess has to be a word.`,
      "Each letter of a guess comes back marked: green is the right letter in the right place, gold is in the word but somewhere else, grey is not in the word.",
      "With more than one player, everyone guesses the same word on their own board, at their own pace. You see how the others' guesses went, as coloured squares, never their letters.",
      `Getting the word scores a point, and one more for every guess you had left.${r.rounds > 1 ? ` ${r.rounds} words are played, and the points add up.` : ""}`,
    ];
  },
  newGame: newSecretWord,
  apply,
  view,
  bot,
  // A computer player looks through a few thousand words: not on the table's own thread.
  heavy: (s, seat) => s.phase === "playing" && !done(s, seat),
  thinkingTime: (s, seat) => thinkFor(4 + (s.guesses[seat]?.length ?? 0) * 2, 1.6),
  summary(s) {
    const over = s.phase === "finished";
    const winners = s.winners ?? [];
    return {
      game: "secretword",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand,
      scoreLine: s.points.join(" · "),
      order: over ? rankSeats(s.points.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? winners : null,
      teams: false,
      seats: s.seats,
    };
  },
};
