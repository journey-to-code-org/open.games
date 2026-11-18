// Draw & Guess: one player is shown three things to draw and picks one; they draw it on the table,
// stroke by stroke, while everyone else guesses what it is. The sooner you guess right, the more you
// score, and the artist scores for everyone who gets it. Then the next player draws.
//
// It needs people. A computer player can't draw, and guessing a drawing is the whole of its side
// of the game, so `practice` is false: the computer players there are only keep the table moving
// (one given a drawing to do gives up on it; one asked to guess guesses wildly, then passes).
//
// A turn can have a clock (the engine adds up the time the table hands each move, and asks the
// table, through `deadline`, to end the drawing when it has gone).
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, rankSeats, thinkFor, who, type BaseRules, type GameDeadline, type MoveTime, type RoundResult, type RuleField } from "./table.js";
import { CANVAS_COLORS, CANVAS_SIZES, CANVAS_STROKES, STROKE_POINTS, type PlayedWord, type WordGame, type WordStroke, type WordView } from "./word.js";
import { tidyWord } from "./words.js";

/** Things to draw: one word each, things anyone can have a go at drawing and anyone might guess. */
export const DRAW_PROMPTS: readonly string[] = (
  "apple banana cherry grapes lemon pear pineapple strawberry carrot corn mushroom pumpkin pizza cake cookie donut sandwich " +
  "sundae egg cheese bread taco popcorn cupcake lollipop teapot cup fork spoon bowl bottle candle lamp chair table bed sofa " +
  "door window house castle tent igloo bridge tower lighthouse church barn fence ladder umbrella clock watch glasses hat crown " +
  "shoe boot sock shirt dress scarf glove mitten backpack suitcase key lock hammer saw scissors pencil crayon book envelope " +
  "letter camera phone computer television radio guitar drum piano trumpet violin bell balloon kite ball bat racket skateboard " +
  "bicycle car truck bus train tractor rocket airplane helicopter boat sailboat submarine anchor wheel robot snowman sun moon star " +
  "cloud rain rainbow lightning snowflake tornado volcano mountain island beach river waterfall tree flower cactus leaf mushroom " +
  "cat dog fish bird duck owl penguin parrot chicken cow pig horse sheep goat rabbit mouse frog turtle snake lizard dinosaur " +
  "elephant giraffe lion tiger bear panda monkey zebra kangaroo camel whale shark octopus crab starfish jellyfish snail butterfly " +
  "bee spider ant ladybug worm bat dragon unicorn ghost alien pirate king queen wizard knight ninja angel mermaid vampire zombie " +
  "heart diamond arrow flag map treasure trophy medal gift present candy bone footprint fire smoke tooth nose eye ear hand foot " +
  "skeleton brain mustache beard toothbrush comb soap bathtub toilet sink fridge oven toaster microwave vacuum broom bucket " +
  "shovel rake wheelbarrow scarecrow tractor windmill globe magnet battery lightbulb telescope microscope compass hourglass " +
  "swing slide trampoline sandcastle snowball sled igloo campfire hammock picnic fireworks"
)
  .split(" ")
  .filter((word, i, all) => word && all.indexOf(word) === i);

export interface DrawGuessRules extends BaseRules {
  /** Times round the table: everyone draws this many times. */
  rounds: number;
  /** Seconds to draw, or 0 for no clock (a drawing ends when everyone has guessed or given up). */
  seconds: number;
}

export const drawClassic: DrawGuessRules = { id: "classic", name: "Once round", rounds: 1, seconds: 90 };
export const drawTwice: DrawGuessRules = { id: "twice", name: "Twice round", rounds: 2, seconds: 90 };
export const drawRelaxed: DrawGuessRules = { id: "relaxed", name: "No clock", rounds: 1, seconds: 0 };
const PRESETS = [drawClassic, drawTwice, drawRelaxed];
const ROUNDS = [1, 2, 3];
const SECONDS = [0, 60, 90, 120];
const LONGEST_GUESS = 20;

export interface DrawGuessState {
  game: "drawguess";
  rules: DrawGuessRules;
  seats: number;
  rng: number;
  /** The drawing being made, from 1. */
  hand: number;
  dealer: 0;
  phase: "choosing" | "drawing" | "turn" | "finished";
  /** Who is drawing. */
  artist: number;
  /** The three things on offer while the artist chooses, then the one chosen. Only the artist sees them until the drawing is over. */
  offer: string[];
  prompt: string;
  strokes: WordStroke[];
  /** Who has guessed it, in the order they did. */
  guessed: number[];
  /** Who has given up on this drawing. */
  passed: number[];
  /** Wrong guesses, for everyone to see. */
  guesses: { by: number; word: string }[];
  /** Ms of this drawing gone by, from the time the table hands each move. */
  spent: number;
  points: number[];
  ready: boolean[];
  result: RoundResult | null;
  winners: number[] | null;
  narration: string | null;
}

export type DrawGuessMove =
  | { type: "choose"; index: number }
  | { type: "stroke"; stroke: WordStroke }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "done" }
  | { type: "guess"; word: string }
  | { type: "pass" }
  | { type: "next" };

const guessers = (s: DrawGuessState) => Array.from({ length: s.seats }, (_, i) => i).filter((i) => i !== s.artist);
const finishedGuessing = (s: DrawGuessState, seat: number) => s.guessed.includes(seat) || s.passed.includes(seat);
/** Points for guessing it: more the sooner, fewer as others get there first. */
const guessWorth = (order: number) => Math.max(4, 10 - order * 2);
const ARTIST_EACH = 3;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function startTurn(s: DrawGuessState) {
  const rand = nextRandom(s);
  const offer: string[] = [];
  while (offer.length < 3) {
    const word = pickRandom([...DRAW_PROMPTS], rand);
    if (!offer.includes(word)) offer.push(word);
  }
  s.offer = offer;
  s.prompt = "";
  s.strokes = [];
  s.guessed = [];
  s.passed = [];
  s.guesses = [];
  s.spent = 0;
  s.result = null;
  s.ready = Array<boolean>(s.seats).fill(false);
  s.phase = "choosing";
  s.narration = `${who(s.artist)} is choosing something to draw.`;
}

export function newDrawGuess(rules: DrawGuessRules, seats: number, seed: number): DrawGuessState {
  const s = { game: "drawguess", rules, seats, rng: seed, hand: 1, dealer: 0, artist: 0, points: Array<number>(seats).fill(0), winners: null } as unknown as DrawGuessState;
  startTurn(s);
  return s;
}

function endTurn(s: DrawGuessState, why: string) {
  const scored = Array<number>(s.seats).fill(0);
  s.guessed.forEach((seat, order) => (scored[seat] = guessWorth(order)));
  scored[s.artist] = s.guessed.length * ARTIST_EACH;
  scored.forEach((n, seat) => (s.points[seat]! += n));
  const word = s.prompt.toUpperCase();
  s.result = {
    key: `drawguess/${s.hand}`,
    title: `It was ${word}`,
    sides: Array.from({ length: s.seats }, (_, seat) => [seat]),
    rows: [
      { label: "This drawing", values: scored.map((n) => `+${n}`), tone: "score" },
      { label: "Points", values: s.points.map(String), tone: "total" },
    ],
  };
  s.narration = `${why} It was ${word}: ${s.guessed.length ? `${s.guessed.map(who).join(", ")} got it.` : "nobody got it."}`;
  if (s.hand >= s.seats * s.rules.rounds) {
    s.phase = "finished";
    const best = Math.max(...s.points);
    s.winners = s.points.flatMap((n, seat) => (n === best ? [seat] : []));
  } else {
    s.phase = "turn";
    s.ready = Array<boolean>(s.seats).fill(false);
  }
}

function apply(state: DrawGuessState, seat: number, move: DrawGuessMove, time?: MoveTime): DrawGuessState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  const type = move?.type;
  if (type === "next") {
    if (state.phase !== "turn") throw new GameError("The drawing isn't finished.");
    const s = clone(state);
    if (!markReady(s.ready, seat)) return s;
    s.hand += 1;
    s.artist = (s.artist + 1) % s.seats;
    startTurn(s);
    return s;
  }
  if (state.phase === "finished") throw new GameError("This game is over.");
  if (state.phase === "turn") throw new GameError("This drawing is finished: move on to the next.");
  const artist = seat === state.artist;
  if (type === "choose") {
    if (state.phase !== "choosing") throw new GameError("The drawing has been chosen.");
    if (!artist) throw new GameError("It's not your turn to draw.");
    const index = (move as { index: number }).index;
    if (!Number.isInteger(index) || index < 0 || index >= state.offer.length) throw new GameError("Choose one of the three.");
    const s = clone(state);
    s.prompt = s.offer[index]!;
    s.phase = "drawing";
    s.narration = `${who(seat)} is drawing. ${plural(s.prompt.length, "letter")}: guess what it is!`;
    return s;
  }
  if (state.phase !== "drawing") throw new GameError(`${who(state.artist)} is still choosing.`);
  const s = clone(state);
  s.spent += Math.max(0, Math.round(time?.elapsed ?? 0));
  switch (type) {
    case "stroke": {
      if (!artist) throw new GameError("Only the artist draws.");
      const stroke = (move as { stroke?: Partial<WordStroke> }).stroke;
      const points = stroke?.points;
      if (!Array.isArray(points) || points.length < 2 || points.length % 2 || points.length > STROKE_POINTS * 2 || !points.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)) throw new GameError("That's not a line on the page.");
      if (!Number.isInteger(stroke!.color) || stroke!.color! < 0 || stroke!.color! >= CANVAS_COLORS.length) throw new GameError("That's not one of the pens.");
      if (!Number.isInteger(stroke!.size) || stroke!.size! < 0 || stroke!.size! >= CANVAS_SIZES.length) throw new GameError("That's not one of the pens.");
      if (s.strokes.length >= CANVAS_STROKES) throw new GameError("The page is full: rub something out first.");
      s.strokes.push({ points: [...points], color: stroke!.color!, size: stroke!.size! });
      s.narration = null;
      break;
    }
    case "undo":
    case "clear":
      if (!artist) throw new GameError("Only the artist draws.");
      if (!s.strokes.length) throw new GameError("There's nothing drawn yet.");
      if (type === "undo") s.strokes.pop();
      else s.strokes = [];
      break;
    case "done":
      if (!artist) throw new GameError("Only the artist can end the drawing.");
      endTurn(s, `${who(seat)} puts the pen down.`);
      return s;
    case "guess": {
      if (artist) throw new GameError("You know what it is!");
      if (finishedGuessing(s, seat)) throw new GameError(s.guessed.includes(seat) ? "You've got it already." : "You've given up on this one.");
      const word = tidyWord((move as { word?: unknown }).word);
      if (!word || word.length > LONGEST_GUESS) throw new GameError("Guess with one word.");
      if (word === s.prompt) {
        s.guessed.push(seat);
        s.narration = `${who(seat)} got it!`;
      } else {
        s.guesses.push({ by: seat, word });
        s.narration = null;
      }
      break;
    }
    case "pass":
      if (artist) throw new GameError("You're drawing!");
      if (finishedGuessing(s, seat)) throw new GameError("You're finished with this one.");
      s.passed.push(seat);
      s.narration = `${who(seat)} gives up.`;
      break;
    default:
      throw new GameError("That's not a move in Draw & Guess.");
  }
  if (s.rules.seconds && s.spent >= s.rules.seconds * 1000) endTurn(s, "Time's up!");
  else if (guessers(s).every((i) => finishedGuessing(s, i))) endTurn(s, s.guessed.length === guessers(s).length ? "Everyone got it!" : "That's everyone.");
  return s;
}

function view(s: DrawGuessState, seat: number): WordView {
  const artist = seat === s.artist;
  const drawing = s.phase === "drawing";
  const shown = s.phase === "turn" || s.phase === "finished" || (artist && drawing) || s.guessed.includes(seat);
  const wrong: PlayedWord[] = drawing ? s.guesses.slice(-8).map((g) => ({ word: g.word, by: g.by, note: "no" })) : [];
  const left = s.rules.seconds ? Math.max(0, s.rules.seconds - Math.floor(s.spent / 1000)) : 0;
  return {
    game: "drawguess",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    // The word as the guessers see it: its letters hidden until they have it.
    boards: s.prompt ? [{ id: "word", label: artist && drawing ? "Draw this" : "The word", cols: s.prompt.length, rows: [Array.from(s.prompt, (letter) => (shown ? { letter, tone: "hit" as const } : { letter: "", hidden: true }))] }] : [],
    rack: null,
    keys: {},
    entry: drawing && !artist && !finishedGuessing(s, seat) ? { type: "guess", prompt: "What is it?", min: 1, max: LONGEST_GUESS } : null,
    pick: null,
    canvas: { strokes: s.strokes, draw: drawing && artist ? { type: "stroke", prompt: "Draw it! No letters or numbers." } : null },
    words: [...wrong, ...(s.phase === "turn" || s.phase === "finished" ? [{ word: s.prompt, by: null, note: "It was" }] : [])],
    choices:
      s.phase === "choosing" && artist
        ? { prompt: "Choose something to draw", options: s.offer.map((word, index) => ({ label: word, move: { type: "choose", index }, primary: index === 0 })) }
        : drawing && artist
          ? {
              prompt: "",
              options: [
                ...(s.strokes.length ? [{ label: "Undo", move: { type: "undo" } }, { label: "Clear", move: { type: "clear" }, confirm: "Rub out the whole drawing?" }] : []),
                { label: "I'm done", move: { type: "done" }, confirm: "End the drawing now? Anyone who hasn't guessed misses out." },
              ],
            }
          : drawing && !finishedGuessing(s, seat)
            ? { prompt: "", options: [{ label: "Give up", move: { type: "pass" }, confirm: "Give up on this drawing?" }] }
            : s.phase === "turn"
              ? nextHandChoices(s.ready, seat, false, "Next drawing")
              : null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: i === s.artist ? (s.phase === "choosing" ? "Choosing" : "Drawing") : s.guessed.includes(i) ? "Got it!" : s.passed.includes(i) ? "Gave up" : drawing ? "Guessing" : "",
      badge: i === s.artist && (s.phase === "choosing" || drawing) ? "🖍️" : undefined,
      done: drawing && i !== s.artist && finishedGuessing(s, i),
    })),
    info: [`Drawing ${s.hand} of ${s.seats * s.rules.rounds}`, ...(s.rules.seconds && drawing ? [`About ${left} s left`] : [])],
    narration: s.narration,
    scores: s.points.map((value, i) => ({ seats: [i], value })),
    result: s.result,
    over: s.phase === "finished" ? { winners: s.winners ?? [], title: s.winners!.length === s.seats ? "All square" : `${s.winners!.map(who).join(" and ")} ${s.winners!.length === 1 ? "wins" : "win"}` } : null,
  };
}

function bot(s: DrawGuessState, seat: number, _style: PlayStyle, rand: () => number = Math.random): DrawGuessMove | null {
  if (s.phase === "turn") return s.ready[seat] ? null : { type: "next" };
  if (s.phase === "finished") return null;
  if (seat === s.artist) {
    if (s.phase === "choosing") return { type: "choose", index: Math.floor(rand() * s.offer.length) };
    // A computer player can't draw: it hands the turn on.
    return { type: "done" };
  }
  if (s.phase !== "drawing" || finishedGuessing(s, seat)) return null;
  // A wild guess or two, and then it gives up.
  const tried = s.guesses.filter((g) => g.by === seat).length;
  if (tried >= 2) return { type: "pass" };
  return { type: "guess", word: pickRandom([...DRAW_PROMPTS], rand) };
}

function deadline(s: DrawGuessState): GameDeadline<DrawGuessMove> | null {
  if (s.phase !== "drawing" || !s.rules.seconds) return null;
  return { seat: s.artist, after: Math.max(0, s.rules.seconds * 1000 - s.spent), move: { type: "done" }, strict: true };
}

function normalize(rules: unknown): DrawGuessRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<DrawGuessRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? drawClassic;
  const one = (value: unknown, allowed: number[], fallback: number) => (allowed.includes(Number(value)) ? Number(value) : fallback);
  return { id: base.id, name: base.name, rounds: one(given.rounds, ROUNDS, base.rounds), seconds: one(given.seconds, SECONDS, base.seconds) };
}

const FIELDS: RuleField<DrawGuessRules>[] = [
  { key: "rounds", label: "Times round", hint: "How many times everyone draws.", kind: "choice", options: ROUNDS.map((n) => [String(n), n === 1 ? "Once" : n === 2 ? "Twice" : "Three times"]) },
  { key: "seconds", label: "Time to draw", hint: "How long each drawing lasts. No clock: it ends when everyone has guessed or given up.", kind: "choice", options: SECONDS.map((n) => [String(n), n ? `${n} seconds` : "No clock"]) },
];

export const drawGuess: WordGame<DrawGuessRules, DrawGuessState, DrawGuessMove> = {
  id: "drawguess",
  name: "Draw & Guess",
  emoji: "🖍️",
  category: "party",
  blurb: "One draws, everyone else guesses",
  tagline: "Draw it, don't say it. Can they guess what it is?",
  seats: { min: 2, max: 8, default: 4 },
  teams: false,
  practice: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "Take turns to draw. The artist is shown three things and picks one, then draws it on the table: no letters or numbers.",
      `Everyone else guesses, one word at a time. ${r.seconds ? `The drawing lasts ${r.seconds} seconds, or until everyone has guessed or given up.` : "It lasts until everyone has guessed or given up, or the artist puts the pen down."}`,
      `The first to guess it scores 10, the next 8, and so on down to 4. The artist scores ${ARTIST_EACH} for everyone who gets it.`,
      `Everyone draws ${r.rounds === 1 ? "once" : r.rounds === 2 ? "twice" : "three times"}, and the most points wins.`,
      "It needs people: a computer player can't draw, and only keeps the table moving.",
    ];
  },
  newGame: newDrawGuess,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (seat === s.artist ? thinkFor(2, 1) : thinkFor(8, 1.4)),
  deadline,
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "drawguess",
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
