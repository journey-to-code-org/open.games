// Anagrams: a rack of letters is turned over, and everyone makes the best word they can from it.
// Each player hands in one word (or none), unseen; when all are in they are turned over together.
// A word scores a point a letter, and three more for using every letter on the rack.
//
// The rack is always the letters of a real word, shuffled, so there is at least one word that
// uses them all: it is shown at the end of the round, to groans.
import type { PlayStyle } from "@journey-to-code/rules";
import type { ThinkBudget } from "./table.js";
import { clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, rankSeats, shuffled, thinkFor, who, type BaseRules, type RoundResult, type RuleField } from "./table.js";
import type { PlayedWord, WordGame, WordView } from "./word.js";
import { commonWords, isWord, plainWords, speltFrom, tidyWord } from "./words.js";

export interface AnagramsRules extends BaseRules {
  /** How many letters are on the rack. */
  letters: number;
  rounds: number;
}

export const anagramsSeven: AnagramsRules = { id: "seven", name: "Seven letters", letters: 7, rounds: 5 };
export const anagramsEight: AnagramsRules = { id: "eight", name: "Eight letters", letters: 8, rounds: 5 };
export const anagramsQuick: AnagramsRules = { id: "quick", name: "A quick three", letters: 7, rounds: 3 };
const PRESETS = [anagramsSeven, anagramsEight, anagramsQuick];
const LETTERS = [6, 7, 8];
const ROUNDS = [3, 5, 7];
const SHORTEST = 3;
/** For using every letter on the rack. */
const FULL_RACK = 3;

export interface AnagramsState {
  game: "anagrams";
  rules: AnagramsRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "round" | "finished";
  /** The letters, in the order they are shown. */
  rack: string[];
  /** The word the rack was made from. It is in no view until the round is over. */
  source: string;
  /** What each seat has handed in: a word, "" for none, or null while they are still thinking. */
  entries: (string | null)[];
  points: number[];
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
}

export type AnagramsMove = { type: "word"; word: string } | { type: "pass" } | { type: "next" };

const scoreOf = (word: string, rack: readonly string[]) => (word ? word.length + (word.length === rack.length ? FULL_RACK : 0) : 0);

function deal(s: AnagramsState) {
  const rand = nextRandom(s);
  s.source = pickRandom([...plainWords(s.rules.letters)], rand);
  // Shuffled until it doesn't spell the word it came from.
  let rack = shuffled([...s.source], rand);
  for (let i = 0; i < 8 && rack.join("") === s.source; i++) rack = shuffled([...s.source], rand);
  s.rack = rack;
  s.entries = Array<string | null>(s.seats).fill(null);
  s.ready = Array<boolean>(s.seats).fill(false);
  s.result = null;
  s.phase = "playing";
}

export function newAnagrams(rules: AnagramsRules, seats: number, seed: number): AnagramsState {
  const s = { game: "anagrams", rules, seats, rng: seed, hand: 1, dealer: 0, points: Array<number>(seats).fill(0), winners: null, narration: null } as unknown as AnagramsState;
  deal(s);
  return s;
}

function endRound(s: AnagramsState) {
  const scored = s.entries.map((word) => scoreOf(word ?? "", s.rack));
  scored.forEach((n, seat) => (s.points[seat]! += n));
  const best = Math.max(...scored);
  const top = scored.flatMap((n, seat) => (n === best && n > 0 ? [seat] : []));
  s.result = {
    key: `anagrams/${s.hand}`,
    title: top.length ? `${top.map(who).join(" and ")} ${top.length === 1 ? "has" : "have"} the best word` : "Nobody found a word",
    sides: Array.from({ length: s.seats }, (_, seat) => [seat]),
    rows: [
      { label: "Word", values: s.entries.map((word) => (word ? word.toUpperCase() : "—")) },
      { label: "This round", values: scored.map((n) => `+${n}`), tone: "score" },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
  s.narration = `${s.result.title}. All ${s.rack.length} letters make ${s.source.toUpperCase()}.`;
  if (s.hand >= s.rules.rounds) {
    s.phase = "finished";
    const most = Math.max(...s.points);
    s.winners = s.points.flatMap((n, seat) => (n === most ? [seat] : []));
  } else {
    s.phase = "round";
    s.ready = Array<boolean>(s.seats).fill(false);
  }
}

function apply(state: AnagramsState, seat: number, move: AnagramsMove): AnagramsState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "round") throw new GameError("The round isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    s.hand += 1;
    deal(s);
    s.narration = `Round ${s.hand} of ${s.rules.rounds}.`;
    return s;
  }
  if (move?.type !== "word" && move?.type !== "pass") throw new GameError("That's not a move in Anagrams.");
  if (state.phase !== "playing") throw new GameError(state.phase === "round" ? "This round is finished: move on to the next." : "This game is over.");
  if (state.entries[seat] !== null) throw new GameError("Your word is in. Waiting for the others.");
  let word = "";
  if (move.type === "word") {
    word = tidyWord(move.word);
    if (word.length < SHORTEST) throw new GameError(`A word needs at least ${SHORTEST} letters.`);
    if (!speltFrom(word, state.rack)) throw new GameError(`${word.toUpperCase()} can't be made from these letters.`);
    if (!isWord(word)) throw new GameError(`${word.toUpperCase()} isn't a word here.`);
  }
  const s = clone(state);
  s.entries[seat] = word;
  // Not what it was, or how long: only that it is in.
  s.narration = `${who(seat)} is in.`;
  if (s.entries.every((entry) => entry !== null)) endRound(s);
  return s;
}

function view(s: AnagramsState, seat: number): WordView {
  const playing = s.phase === "playing";
  const mine = s.entries[seat] ?? null;
  const waiting = playing && mine === null;
  const shown: PlayedWord[] = playing
    ? // Your own word is yours to see while the others think.
      mine ? [{ word: mine, by: seat, note: `${mine.length} letters`, points: scoreOf(mine, s.rack) }] : []
    : [
        ...s.entries.flatMap((word, by) => (word ? [{ word, by, note: word.length === s.rack.length ? "Every letter!" : `${word.length} letters`, points: scoreOf(word, s.rack) }] : [])),
        { word: s.source, by: null, note: "All the letters" },
      ];
  return {
    game: "anagrams",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    boards: [],
    rack: s.rack,
    keys: {},
    entry: waiting ? { type: "word", prompt: "Your best word", min: SHORTEST, max: s.rack.length, pool: s.rack } : null,
    pick: null,
    words: shown,
    choices: waiting ? { prompt: "", options: [{ label: "No word", move: { type: "pass" }, confirm: "Hand in no word this round?" }] } : s.phase === "round" ? nextHandChoices(s.ready, seat, false, "Next round") : null,
    players: s.entries.map((entry) => ({ line: playing ? (entry === null ? "Thinking" : "Word in") : entry ? entry.toUpperCase() : "No word", done: entry !== null })),
    info: [`Round ${s.hand} of ${s.rules.rounds}`, `A point a letter, +${FULL_RACK} for all ${s.rack.length}`],
    narration: s.narration ?? (waiting ? "Make the longest word you can from these letters." : playing ? "Waiting for the others." : null),
    scores: s.points.map((value, i) => ({ seats: [i], value })),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.seats === 1 ? `${s.points[0]} points` : s.winners!.length === s.seats ? "All square" : `${s.winners!.map(who).join(" and ")} ${s.winners!.length === 1 ? "wins" : "win"}` } : null,
  };
}

/** The words of one length that the rack spells, from a computer player's vocabulary. */
const found = (rack: readonly string[], length: number) => commonWords(length).filter((word) => speltFrom(word, rack));

function bot(s: AnagramsState, seat: number, style: PlayStyle, rand: () => number = Math.random, budget?: ThinkBudget): AnagramsMove | null {
  if (s.phase === "round") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.entries[seat] !== null) return null;
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  // How long a word this player can see: a sharp one finds the whole rack now and then, a poor
  // one stops at four or five letters. In a hurry, the short words are looked through and no more.
  const hurried = budget !== undefined && budget.ms <= 10;
  const reach = hurried ? 4 : Math.min(s.rack.length, Math.round(3.5 + skill * (s.rack.length - 4.5) + (rand() - 0.5) * 2.4));
  for (let length = Math.max(SHORTEST, reach); length >= SHORTEST; length--) {
    const words = found(s.rack, length);
    if (words.length) return { type: "word", word: pickRandom(words, rand) };
  }
  return { type: "pass" };
}

function normalize(rules: unknown): AnagramsRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<AnagramsRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? anagramsSeven;
  const one = (value: unknown, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);
  return { id: base.id, name: base.name, letters: one(given.letters, LETTERS, base.letters), rounds: one(given.rounds, ROUNDS, base.rounds) };
}

const FIELDS: RuleField<AnagramsRules>[] = [
  { key: "letters", label: "Letters", hint: "How many letters are on the rack.", kind: "choice", options: LETTERS.map((n) => [String(n), String(n)]) },
  { key: "rounds", label: "Rounds", hint: "How many racks are played.", kind: "choice", options: ROUNDS.map((n) => [String(n), String(n)]) },
];

export const anagrams: WordGame<AnagramsRules, AnagramsState, AnagramsMove> = {
  id: "anagrams",
  name: "Anagrams",
  emoji: "🔀",
  category: "words",
  blurb: "The longest word from one rack of letters",
  tagline: "Everyone gets the same letters. Who finds the longest word?",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `${r.letters} letters are turned over, the same for everyone. Make the longest word you can from them, using each letter no more than it is there.`,
      "Everyone hands in one word, unseen, or none. When all are in, they are turned over together.",
      `A word scores a point a letter, and ${FULL_RACK} more for using every letter. There is always a word that does.`,
      `${r.rounds} rounds, and the most points wins.`,
    ];
  },
  newGame: newAnagrams,
  apply,
  view,
  bot,
  // A computer player looks through a few thousand words: not on the table's own thread.
  heavy: (s, seat) => s.phase === "playing" && s.entries[seat] === null,
  thinkingTime: () => thinkFor(10, 2.2),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "anagrams",
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
