// Pass the Picture: the drawing game of telephone. Everyone writes something for someone else to
// draw; each phone passes on, and the next person draws what they were given; the drawing passes
// on and the next person says what they think it is; then draw that, say that, until every chain
// has been round. Then the chains are shown, one step at a time, from the first words to the last.
//
// Everyone plays at once and nobody waits on a clock: a step ends when everyone has handed theirs
// in. Nothing is scored. A chain is shown by whoever started it, so each person gets to turn over
// what became of their own words.
//
// It needs people. A computer player only keeps the table moving: it borrows its words from the
// list of ideas, and draws a scribble.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, nextRandom, pickRandom, thinkFor, who, type BaseRules, type RuleField } from "./table.js";
import { CANVAS_COLORS, CANVAS_SIZES, CANVAS_STROKES, STROKE_POINTS, type WordChain, type WordForm, type WordGame, type WordStroke, type WordView } from "./word.js";

/** Things to write when nothing comes to mind: anyone can draw them, and they go wrong nicely. */
export const PASS_IDEAS: Record<"anything" | "thanksgiving", readonly string[]> = {
  anything: [
    "a cat riding a skateboard",
    "a dinosaur at the dentist",
    "a snowman on a beach",
    "a pirate who lost his ship",
    "a robot walking a dog",
    "a fish in a bathtub",
    "a cow jumping over the moon",
    "a monkey eating spaghetti",
    "a ghost afraid of the dark",
    "a giraffe in a tiny car",
    "a wizard doing laundry",
    "a pig flying a plane",
    "a bear stuck in a tree",
    "a chicken crossing the road",
    "an alien at a barbecue",
    "a shark at a birthday party",
    "a frog wearing a crown",
    "a penguin on vacation",
    "a dog driving a tractor",
    "a squirrel stealing a pie",
  ],
  thanksgiving: [
    "a turkey running away from the oven",
    "Grandpa asleep after dinner",
    "Grandma's pumpkin pie",
    "the dog stole the turkey",
    "a pilgrim on a skateboard",
    "too much mashed potatoes",
    "a turkey wearing sunglasses",
    "the kids' table",
    "football on TV",
    "a cranberry with legs",
    "a scarecrow in a pile of leaves",
    "a family photo gone wrong",
    "a pie on someone's face",
    "a turkey hiding in the corn",
    "everyone fighting over the last roll",
    "a giant gravy boat",
    "a parade balloon floating away",
    "stretchy pants after dinner",
    "a turkey playing football",
    "the pumpkin that ate the house",
    "a turkey doing a cartwheel",
    "a pumpkin with a mustache",
    "a pie that's too hot to eat",
    "a turkey in a superhero cape",
    "corn on the cob playing guitar",
    "a sweet potato taking a bath",
    "Grandpa's dance moves",
    "a turkey hiding behind a tree",
    "the biggest pumpkin in the world",
    "a turkey wearing a pilgrim hat",
  ],
};

export interface PassRules extends BaseRules {
  /** How far each chain goes: everyone at the table, or five steps at most. */
  length: "everyone" | "five";
  /** What the ideas are about, when someone asks for one. */
  ideas: "anything" | "thanksgiving";
}

export const passThanksgiving: PassRules = { id: "thanksgiving", name: "Thanksgiving", length: "everyone", ideas: "thanksgiving" };
export const passRound: PassRules = { id: "round", name: "Round the table", length: "everyone", ideas: "anything" };
export const passQuick: PassRules = { id: "quick", name: "Quick chains", length: "five", ideas: "anything" };
const PRESETS = [passThanksgiving, passRound, passQuick];
const LONGEST = 60;

/** One step of a chain: words (written or guessed) or a drawing. */
interface Step {
  by: number;
  text?: string;
  strokes?: WordStroke[];
}

export interface PassState {
  game: "telephone";
  rules: PassRules;
  seats: number;
  rng: number;
  /** The step being played, from 1, for the table's "Step 2 of 4". */
  hand: number;
  dealer: 0;
  phase: "play" | "reveal" | "finished";
  /** How many steps each chain has. */
  steps: number;
  /** Chain c starts with seat c's words. */
  chains: Step[][];
  /** Each seat's drawing while it is being made. */
  sketch: WordStroke[][];
  /** Who has handed in this step. */
  handed: boolean[];
  /** Which chain is being shown, and how many of its steps are showing. */
  reveal: { chain: number; shown: number };
  narration: string | null;
}

export type PassMove =
  | { type: "write"; text: string }
  | { type: "idea" }
  | { type: "stroke"; stroke: WordStroke }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "done" }
  | { type: "guess"; text: string }
  | { type: "show"; at: number };

/** What a step asks: the first is words, then drawing and saying take turns. */
const kindOf = (step: number) => (step === 0 ? "write" : step % 2 === 1 ? "draw" : "guess");
/** The chain a seat works on at a step: each step, everything passes one seat on. */
const chainOf = (s: Pick<PassState, "seats">, seat: number, step: number) => (((seat - step) % s.seats) + s.seats) % s.seats;
const current = (s: PassState) => s.hand - 1;
const tidy = (text: unknown) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");

export function newPass(rules: PassRules, seats: number, seed: number): PassState {
  return {
    game: "telephone",
    rules,
    seats,
    rng: seed,
    hand: 1,
    dealer: 0,
    phase: "play",
    steps: rules.length === "five" ? Math.min(seats, 5) : seats,
    chains: Array.from({ length: seats }, () => []),
    sketch: Array.from({ length: seats }, () => []),
    handed: Array<boolean>(seats).fill(false),
    reveal: { chain: 0, shown: 0 },
    narration: "Everyone writes something for someone else to draw.",
  };
}

function handIn(s: PassState, seat: number, step: Step) {
  s.chains[chainOf(s, seat, current(s))]!.push(step);
  s.handed[seat] = true;
  s.narration = null;
  if (!s.handed.every(Boolean)) return;
  if (s.hand >= s.steps) {
    s.phase = "reveal";
    s.reveal = { chain: 0, shown: 1 };
    s.narration = `Every chain has been round. ${who(0)}, show us what became of yours.`;
    return;
  }
  s.hand += 1;
  s.handed = Array<boolean>(s.seats).fill(false);
  s.sketch = Array.from({ length: s.seats }, () => []);
  s.narration = kindOf(current(s)) === "draw" ? "Now draw what you were given." : "Now say what the drawing is.";
}

function apply(state: PassState, seat: number, move: PassMove): PassState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  const type = move?.type;
  if (state.phase === "finished") throw new GameError("This game is over.");
  if (state.phase === "reveal") {
    if (type !== "show") throw new GameError("The chains are being shown.");
    if (seat !== state.reveal.chain) throw new GameError(`${who(state.reveal.chain)} is showing this one.`);
    if ((move as { at?: unknown }).at !== state.reveal.shown) throw new GameError("That's been shown already.");
    const s = clone(state);
    if (s.reveal.shown < s.chains[s.reveal.chain]!.length) s.reveal.shown += 1;
    else if (s.reveal.chain + 1 < s.seats) {
      s.reveal = { chain: s.reveal.chain + 1, shown: 1 };
      s.narration = `${who(s.reveal.chain)}, show us what became of yours.`;
    } else {
      s.phase = "finished";
      s.narration = "That's every chain!";
    }
    return s;
  }
  if (state.handed[seat]) throw new GameError("You've handed yours in: wait for the others.");
  const kind = kindOf(current(state));
  const s = clone(state);
  switch (type) {
    case "write":
    case "guess": {
      if (type !== kind) throw new GameError(kind === "draw" ? "Draw it: no words." : kind === "write" ? "Write something to start your chain." : "Say what the drawing is.");
      const text = tidy((move as { text?: unknown }).text);
      if (!text || text.length > LONGEST) throw new GameError(`Write a few words, up to ${LONGEST} letters.`);
      handIn(s, seat, { by: seat, text });
      return s;
    }
    case "idea": {
      if (kind !== "write") throw new GameError("Ideas are for the first step.");
      const rand = nextRandom(s);
      handIn(s, seat, { by: seat, text: pickRandom([...PASS_IDEAS[s.rules.ideas]], rand) });
      return s;
    }
    case "stroke": {
      if (kind !== "draw") throw new GameError("This step isn't a drawing.");
      const stroke = (move as { stroke?: Partial<WordStroke> }).stroke;
      const points = stroke?.points;
      if (!Array.isArray(points) || points.length < 2 || points.length % 2 || points.length > STROKE_POINTS * 2 || !points.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)) throw new GameError("That's not a line on the page.");
      if (!Number.isInteger(stroke!.color) || stroke!.color! < 0 || stroke!.color! >= CANVAS_COLORS.length) throw new GameError("That's not one of the pens.");
      if (!Number.isInteger(stroke!.size) || stroke!.size! < 0 || stroke!.size! >= CANVAS_SIZES.length) throw new GameError("That's not one of the pens.");
      if (s.sketch[seat]!.length >= CANVAS_STROKES) throw new GameError("The page is full: rub something out first.");
      s.sketch[seat]!.push({ points: [...points], color: stroke!.color!, size: stroke!.size! });
      return s;
    }
    case "undo":
    case "clear":
      if (kind !== "draw") throw new GameError("This step isn't a drawing.");
      if (!s.sketch[seat]!.length) throw new GameError("There's nothing drawn yet.");
      if (type === "undo") s.sketch[seat]!.pop();
      else s.sketch[seat] = [];
      return s;
    case "done":
      if (kind !== "draw") throw new GameError("This step isn't a drawing.");
      if (!s.sketch[seat]!.length) throw new GameError("Draw something first.");
      handIn(s, seat, { by: seat, strokes: s.sketch[seat]! });
      s.sketch[seat] = [];
      return s;
    default:
      throw new GameError("That's not a move in Pass the Picture.");
  }
}

function view(s: PassState, seat: number): WordView {
  const step = current(s);
  const kind = kindOf(step);
  const playing = s.phase === "play";
  const waiting = playing && s.handed[seat]!;
  const given = playing && step > 0 ? s.chains[chainOf(s, seat, step)]![step - 1] : undefined;
  const others = s.handed.flatMap((done, i) => (done || i === seat ? [] : [who(i)]));
  let question: string;
  let form: WordForm | null = null;
  if (s.phase !== "play") {
    const c = s.phase === "finished" ? s.seats - 1 : s.reveal.chain;
    question = s.phase === "finished" ? "That's every chain!" : `What became of ${who(c)}'s words`;
  } else if (waiting) question = others.length ? `Waiting for ${others.join(", ")}` : "Passing them on…";
  else if (kind === "write") {
    question = "Write something for someone else to draw";
    form = { type: "write", kind: "caption", prompt: "Something to draw", length: LONGEST };
  } else if (kind === "draw") question = `Draw this: “${given!.text}”`;
  else {
    question = "What's this a picture of?";
    form = { type: "guess", kind: "caption", prompt: "It's…", length: LONGEST };
  }
  const shownChain = s.phase === "play" ? null : s.phase === "finished" ? s.seats - 1 : s.reveal.chain;
  const chain: WordChain | null =
    shownChain === null
      ? null
      : {
          owner: shownChain,
          index: shownChain + 1,
          of: s.seats,
          length: s.chains[shownChain]!.length,
          steps: s.chains[shownChain]!.slice(0, s.phase === "finished" ? undefined : s.reveal.shown).map((x) => ({ by: x.by, ...(x.text !== undefined ? { text: x.text } : { strokes: x.strokes! }) })),
        };
  const showing = s.phase === "reveal" && seat === s.reveal.chain;
  const lastStep = s.phase === "reveal" && s.reveal.shown >= s.chains[s.reveal.chain]!.length;
  return {
    game: "telephone",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    boards: [],
    rack: null,
    keys: {},
    entry: null,
    pick: null,
    canvas: playing && !waiting && kind === "draw" ? { strokes: s.sketch[seat]!, draw: { type: "stroke", prompt: "Draw it! No letters or numbers." } } : playing && !waiting && kind === "guess" ? { strokes: given!.strokes!, draw: null } : null,
    words: [],
    question,
    form,
    chain,
    choices:
      playing && !waiting && kind === "write"
        ? { prompt: "", options: [{ label: "Surprise me", move: { type: "idea" } }] }
        : playing && !waiting && kind === "draw" && s.sketch[seat]!.length
          ? {
              prompt: "",
              options: [
                { label: "Undo", move: { type: "undo" } },
                { label: "Clear", move: { type: "clear" }, confirm: "Rub out the whole drawing?" },
                { label: "Pass it on", move: { type: "done" }, primary: true },
              ],
            }
          : showing
            ? { prompt: "", options: [{ label: lastStep ? (s.reveal.chain + 1 < s.seats ? "Next chain" : "The end") : "Show the next", move: { type: "show", at: s.reveal.shown }, primary: true }] }
            : null,
    players: Array.from({ length: s.seats }, (_, i) => ({
      line: playing ? (s.handed[i] ? "Passed it on" : kind === "draw" ? "Drawing" : kind === "write" ? "Writing" : "Guessing") : s.phase === "reveal" && i === s.reveal.chain ? "Showing their chain" : "",
      done: playing && s.handed[i]!,
    })),
    info: playing ? [`Step ${s.hand} of ${s.steps}`, kind === "draw" ? "Draw" : kind === "write" ? "Write" : "Say what it is"] : s.phase === "reveal" ? [`Chain ${s.reveal.chain + 1} of ${s.seats}`] : [],
    narration: s.narration,
    scores: [],
    result: null,
    over: s.phase === "finished" ? { winners: Array.from({ length: s.seats }, (_, i) => i), title: "That's every chain!" } : null,
  };
}

/** A computer player's drawing: a few loops, somewhere on the page. */
function scribble(rand: () => number): WordStroke {
  const cx = 300 + Math.floor(rand() * 400);
  const cy = 300 + Math.floor(rand() * 400);
  const r = 80 + Math.floor(rand() * 120);
  const points: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 4;
    const k = r * (0.6 + 0.4 * Math.sin(i / 3));
    points.push(Math.max(0, Math.min(1000, Math.round(cx + Math.cos(a) * k))), Math.max(0, Math.min(1000, Math.round(cy + Math.sin(a) * k))));
  }
  return { points, color: Math.floor(rand() * 7), size: 1 };
}

function bot(s: PassState, seat: number, _style: PlayStyle, rand: () => number = Math.random): PassMove | null {
  if (s.phase === "finished") return null;
  if (s.phase === "reveal") return seat === s.reveal.chain ? { type: "show", at: s.reveal.shown } : null;
  if (s.handed[seat]) return null;
  const kind = kindOf(current(s));
  if (kind === "draw") return s.sketch[seat]!.length ? { type: "done" } : { type: "stroke", stroke: scribble(rand) };
  const idea = pickRandom([...PASS_IDEAS[s.rules.ideas]], rand);
  return kind === "write" ? { type: "write", text: idea } : { type: "guess", text: idea };
}

function normalize(rules: unknown): PassRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PassRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? passThanksgiving;
  return {
    id: base.id,
    name: base.name,
    length: given.length === "five" || given.length === "everyone" ? given.length : base.length,
    ideas: given.ideas === "anything" || given.ideas === "thanksgiving" ? given.ideas : base.ideas,
  };
}

const FIELDS: RuleField<PassRules>[] = [
  {
    key: "length",
    label: "How far each chain goes",
    hint: "Everyone at the table, or five steps at most (quicker with a big table).",
    kind: "choice",
    options: [
      ["everyone", "Everyone"],
      ["five", "Five steps"],
    ],
  },
  {
    key: "ideas",
    label: "Ideas",
    hint: "What “Surprise me” comes up with.",
    kind: "choice",
    options: [
      ["thanksgiving", "Thanksgiving"],
      ["anything", "Anything"],
    ],
  },
];

export const passThePicture: WordGame<PassRules, PassState, PassMove> = {
  id: "telephone",
  name: "Pass the Picture",
  emoji: "📞",
  category: "party",
  blurb: "Write it, draw it, guess it, pass it on, and watch it go wrong",
  tagline: "The drawing game of telephone. What started as pie ends as a horse.",
  seats: { min: 3, max: 12, default: 6 },
  teams: false,
  practice: false,
  presets: PRESETS,
  fields: FIELDS,
  normalize,
  validate: () => [],
  describe(r) {
    return [
      "Everyone writes something for someone else to draw, or asks for an idea.",
      "Each phone passes it on. The next person draws what they were given; then the drawing passes on, and the next person says what they think it is. Draw that, say that, and so on.",
      r.length === "five" ? "Each chain goes five steps (or round the table, if there are fewer of you)." : "Each chain goes all the way round the table.",
      "Then the chains are shown, a step at a time, each by whoever started it. Nothing is scored: the fun is in what went wrong.",
      "Everyone plays at once, with no clock. It needs people: a computer player only scribbles.",
    ];
  },
  newGame: newPass,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (s.phase === "reveal" ? (seat === s.reveal.chain ? 5000 : thinkFor(1)) : thinkFor(6, 1.5)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "telephone",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand,
      scoreLine: over ? "" : s.phase === "reveal" ? `Showing chain ${s.reveal.chain + 1} of ${s.seats}` : `Step ${s.hand} of ${s.steps}`,
      order: over ? Array.from({ length: s.seats }, (_, i) => i) : null,
      winners: over ? Array.from({ length: s.seats }, (_, i) => i) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
