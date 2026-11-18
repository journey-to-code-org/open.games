// Read the Room: a party game for three to eight, played with everyone answering at once. There
// are no right answers, only the room's: every question is scored on how well you guessed what the
// others would say.
//
// It is the first game whose seats answer with a control and not with cards, pieces or letters, so
// its view carries a `form` (what to ask, and with what) and, once everyone has answered, a `room`
// (how it came out). There are five kinds of question:
//
//   - a scale: a slider from 0 to 100. The nearer the room's average, the more it is worth.
//   - a vote: which of us is most likely to… Voting with the most votes scores.
//   - either-ors: three of them. Each one you called with the majority scores.
//   - three answers: name three. Each one somebody else also gave scores.
//   - a caption: write a line, then give the others' lines stars. Yours scores what it was given.
//
// The questions are in this file. A seat's answer is in no view but its own until all are in.
import type { PlayStyle } from "@journey-to-code/rules";
import { clone, GameError, markReady, nextHandChoices, nextRandom, rankSeats, shuffled, thinkFor, who, type BaseRules, type RuleField } from "./table.js";
import type { WordForm, WordGame, WordRoom, WordView } from "./word.js";

export interface RoomRules extends BaseRules {
  /** How many questions are asked. */
  rounds: number;
  /** Whether the questions where something is written are left out: quicker, and nothing to type. */
  taps: boolean;
}
const PRESETS: RoomRules[] = [
  { id: "party", name: "A full round", rounds: 10, taps: false },
  { id: "quick", name: "Quick five", rounds: 5, taps: false },
  { id: "taps", name: "No typing", rounds: 8, taps: true },
];

type Kind = "scale" | "vote" | "either" | "three" | "caption";
const SCALES: { prompt: string; low: string; high: string }[] = [
  { prompt: "How early is too early to put up holiday decorations?", low: "Never too early", high: "Day before, tops" },
  { prompt: "How spicy do you take it?", low: "Black pepper is plenty", high: "Bring me the waiver" },
  { prompt: "How good a driver are you, really?", low: "I walk a lot", high: "Could go pro" },
  { prompt: "How much of a morning person are you?", low: "Do not speak to me", high: "Up before the birds" },
  { prompt: "How long should a phone call be?", low: "Text me instead", high: "Put the kettle on" },
  { prompt: "How clean is your car right now?", low: "There's a smell", high: "Showroom" },
  { prompt: "How much do you trust a gas station hot dog?", low: "Not with my life", high: "Lunch is served" },
  { prompt: "How competitive are you at board games?", low: "Just here for snacks", high: "I flip tables" },
  { prompt: "How late is fashionably late?", low: "On the dot", high: "An hour, easy" },
  { prompt: "How cold should the house be at night?", low: "Tropical", high: "See your breath" },
];
const VOTES = [
  "Who is most likely to laugh at the wrong moment?",
  "Who would last longest without their phone?",
  "Who is most likely to get lost with the map in their hand?",
  "Who would win a staring contest?",
  "Who is most likely to adopt a stray anything?",
  "Who tells the longest stories?",
  "Who would survive longest in the woods?",
  "Who is most likely to fall asleep during the movie?",
  "Who has the loudest sneeze?",
  "Who would be first to volunteer for karaoke?",
];
const EITHERS: [string, string][] = [
  ["Pancakes", "Waffles"], ["Beach", "Mountains"], ["Early bird", "Night owl"], ["Window seat", "Aisle seat"], ["Cake", "Pie"], ["Call", "Text"],
  ["Dogs", "Cats"], ["Sweet", "Salty"], ["Road trip", "Fly there"], ["Book", "Movie"], ["Coffee", "Tea"], ["Summer", "Winter"],
  ["Cook", "Order in"], ["Toilet paper over", "Toilet paper under"], ["Ketchup", "Mustard"], ["Shower at night", "Shower in the morning"], ["Camping", "Hotel"], ["Pineapple on pizza", "Absolutely not"],
];
/** What is asked for, and the answers people give most, which is what a computer player draws on. */
const THREES: { prompt: string; common: string[] }[] = [
  { prompt: "Name three things in every junk drawer.", common: ["batteries", "tape", "pens", "scissors", "rubber bands", "keys", "matches", "string"] },
  { prompt: "Name three things you take to the beach.", common: ["towel", "sunscreen", "umbrella", "cooler", "chair", "sunglasses", "book", "ball"] },
  { prompt: "Name three pizza toppings.", common: ["pepperoni", "mushrooms", "sausage", "onions", "peppers", "olives", "bacon", "pineapple"] },
  { prompt: "Name three things in a toolbox.", common: ["hammer", "screwdriver", "wrench", "pliers", "tape measure", "nails", "level", "drill"] },
  { prompt: "Name three things people lose.", common: ["keys", "phone", "wallet", "glasses", "socks", "remote", "umbrella", "patience"] },
  { prompt: "Name three breakfast foods.", common: ["eggs", "bacon", "toast", "pancakes", "cereal", "waffles", "oatmeal", "sausage"] },
  { prompt: "Name three things at a cookout.", common: ["burgers", "hot dogs", "chips", "corn", "potato salad", "beer", "watermelon", "ribs"] },
  { prompt: "Name three farm animals.", common: ["cow", "pig", "chicken", "horse", "sheep", "goat", "duck", "donkey"] },
];
const CAPTIONS: { prompt: string; common: string[] }[] = [
  { prompt: "The worst thing to say at a job interview:", common: ["When's lunch?", "I'm mostly here for the Wi-Fi.", "My last boss was a coward.", "Do you drug test?", "I'll need Fridays. All of them."] },
  { prompt: "A terrible name for a boat:", common: ["Sinks A Lot", "The Leak", "Unsinkable II", "Dad's Mistake", "Row Row No"] },
  { prompt: "What the dog is really thinking:", common: ["That was MY chair.", "The mailman knows what he did.", "Walk? Walk. WALK.", "I ate it and I'd do it again.", "You were gone for a year."] },
  { prompt: "A bad slogan for a dentist:", common: ["We'll find something.", "Open wide, wallet too.", "It only hurts a lot.", "You should have flossed.", "Guess which tooth!"] },
  { prompt: "The title of your autobiography:", common: ["It Seemed Fine at the Time", "Mostly Snacks", "I Had a Coupon", "Wait, What?", "Close Enough"] },
  { prompt: "A rejected flavor of ice cream:", common: ["Lawn", "Garlic Swirl", "Wet Sock", "Sardine Ripple", "Just Ice"] },
];

interface Question { kind: Kind; at: number; pairs: number[] }
type Answer = { value: number } | { pick: number } | { flags: boolean[] } | { tags: string[] } | { text: string };

export interface RoomState {
  game: "readtheroom";
  rules: RoomRules;
  seats: number;
  rng: number;
  /** The question being asked, from 1. */
  hand: number;
  dealer: 0;
  /** Everyone answers; for a caption, everyone then gives stars; then the room is shown until all move on. */
  phase: "answer" | "rate" | "room" | "finished";
  /** The night's questions, in order. */
  asked: Question[];
  answers: (Answer | null)[];
  /** The stars each seat gave the others' captions, in the order of their seats. */
  stars: (number[] | null)[];
  points: number[];
  gained: number[];
  ready: boolean[];
  winners: number[] | null;
  narration: string | null;
}
export type RoomMove = ({ type: "answer" } & Partial<{ value: number; pick: number; flags: boolean[]; tags: string[]; text: string }>) | { type: "rate"; stars: number[] } | { type: "next" };

const question = (s: RoomState) => s.asked[s.hand - 1]!;
const tidy = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").replace(/s$/, "");
const others = (s: RoomState, seat: number) => Array.from({ length: s.seats }, (_, i) => i).filter((i) => i !== seat);
const promptOf = (q: Question) => (q.kind === "scale" ? SCALES[q.at]!.prompt : q.kind === "vote" ? VOTES[q.at]! : q.kind === "either" ? "This or that? Call it the way the room will." : q.kind === "three" ? THREES[q.at]!.prompt : CAPTIONS[q.at]!.prompt);

/** What a seat is asked, as a control to answer with. */
function formFor(s: RoomState, seat: number): WordForm | null {
  const q = question(s);
  if (s.phase === "rate") return s.stars[seat] ? null : { type: "rate", kind: "rate", prompt: `${CAPTIONS[q.at]!.prompt} Give each a star or five.`, items: others(s, seat).map((i) => (s.answers[i] as { text: string }).text) };
  if (s.phase !== "answer" || s.answers[seat]) return null;
  const prompt = promptOf(q);
  if (q.kind === "scale") return { type: "answer", kind: "scale", prompt, min: 0, max: 100, low: SCALES[q.at]!.low, high: SCALES[q.at]!.high };
  if (q.kind === "vote") return { type: "answer", kind: "vote", prompt, seats: others(s, seat) };
  if (q.kind === "either") return { type: "answer", kind: "either", prompt, pairs: q.pairs.map((i) => EITHERS[i]!) };
  if (q.kind === "three") return { type: "answer", kind: "three", prompt, count: 3, length: 24 };
  return { type: "answer", kind: "caption", prompt, length: 80 };
}

/** How a question came out, and what each seat gained for it. */
function tally(s: RoomState): WordRoom {
  const q = question(s);
  const seats = Array.from({ length: s.seats }, (_, i) => i);
  const gained = seats.map(() => 0);
  const room: WordRoom = { kind: q.kind, prompt: promptOf(q), headline: "", bars: [], gained };
  if (q.kind === "scale") {
    const values = s.answers.map((a) => (a as { value: number }).value);
    const average = Math.round(values.reduce((sum, v) => sum + v, 0) / s.seats);
    for (const seat of seats) gained[seat] = Math.max(0, 100 - 4 * Math.abs(values[seat]! - average));
    room.headline = `The room said ${average}.`;
    room.bars = seats.map((seat) => ({ label: who(seat), value: values[seat]!, seats: [seat], best: gained[seat] === Math.max(...gained) }));
  } else if (q.kind === "vote") {
    const picks = s.answers.map((a) => (a as { pick: number }).pick);
    const votes = seats.map((seat) => picks.filter((p) => p === seat).length);
    const most = Math.max(...votes);
    for (const seat of seats) if (votes[picks[seat]!] === most) gained[seat] = 100;
    const top = seats.filter((seat) => votes[seat] === most);
    room.headline = top.length === 1 ? `The room said ${who(top[0]!)}.` : "The room could not agree.";
    room.bars = seats.filter((seat) => votes[seat]! > 0).map((seat) => ({ label: who(seat), value: votes[seat]!, seats: seats.filter((v) => picks[v] === seat), best: votes[seat] === most }));
  } else if (q.kind === "either") {
    const flags = s.answers.map((a) => (a as { flags: boolean[] }).flags);
    q.pairs.forEach((pair, n) => {
      const second = seats.filter((seat) => flags[seat]![n]);
      const first = seats.filter((seat) => !flags[seat]![n]);
      // A tie is everybody's.
      for (const seat of second.length >= first.length ? second : []) gained[seat]! += 40;
      for (const seat of first.length >= second.length ? first : []) gained[seat]! += 40;
      room.bars.push({ label: EITHERS[pair]![0], value: first.length, seats: first, best: first.length >= second.length });
      room.bars.push({ label: EITHERS[pair]![1], value: second.length, seats: second, best: second.length >= first.length });
    });
    room.headline = "Here is how the room split.";
  } else if (q.kind === "three") {
    const given = s.answers.map((a) => [...new Set((a as { tags: string[] }).tags.map(tidy))]);
    const all = [...new Set(given.flat())];
    for (const tag of all) {
      const said = seats.filter((seat) => given[seat]!.includes(tag));
      if (said.length > 1) for (const seat of said) gained[seat]! += 30;
      room.bars.push({ label: tag, value: said.length, seats: said, best: said.length > 1 });
    }
    room.bars.sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
    room.headline = room.bars[0] && room.bars[0].value > 1 ? `Most said: ${room.bars[0].label}.` : "No two of you said the same thing.";
  } else {
    for (const seat of seats) {
      let total = 0;
      for (const rater of others(s, seat)) total += s.stars[rater]![others(s, rater).indexOf(seat)]!;
      gained[seat] = total * 10;
      room.bars.push({ label: (s.answers[seat] as { text: string }).text, value: total, seats: [seat] });
    }
    const most = Math.max(...room.bars.map((bar) => bar.value));
    for (const bar of room.bars) bar.best = bar.value === most;
    room.bars.sort((a, b) => b.value - a.value);
    room.headline = `The room's favourite was ${who(room.bars[0]!.seats[0]!)}'s.`;
  }
  return room;
}

function settle(s: RoomState) {
  const room = tally(s);
  s.gained = room.gained;
  s.points = s.points.map((p, seat) => p + room.gained[seat]!);
  s.phase = "room";
  s.ready = s.ready.map(() => false);
  s.narration = room.headline;
}

function apply(state: RoomState, seat: number, move: RoomMove): RoomState {
  if (!move || typeof move !== "object") throw new GameError("That is not an answer.");
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "room") throw new GameError("Not yet.");
    if (!markReady(s.ready, seat)) return s;
    if (s.hand >= s.asked.length) {
      s.phase = "finished";
      const best = Math.max(...s.points);
      s.winners = s.points.flatMap((p, i) => (p === best ? [i] : []));
      s.narration = s.winners.length === 1 ? `${who(s.winners[0]!)} read the room best.` : "A tie at the top.";
      return s;
    }
    s.hand++;
    s.phase = "answer";
    s.answers = s.answers.map(() => null);
    s.stars = s.stars.map(() => null);
    s.gained = s.gained.map(() => 0);
    s.narration = null;
    return s;
  }
  const form = formFor(s, seat);
  if (!form || form.type !== move.type) throw new GameError(s.phase === "room" ? "That question is done." : "Your answer is in. Waiting for the others.");
  if (move.type === "rate") {
    const stars = move.stars;
    if (!Array.isArray(stars) || stars.length !== s.seats - 1 || !stars.every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) throw new GameError("Give each one from one star to five.");
    s.stars[seat] = [...stars];
    if (s.stars.every(Boolean)) settle(s);
    return s;
  }
  const q = question(s);
  let answer: Answer;
  if (q.kind === "scale") {
    if (!Number.isInteger(move.value) || move.value! < 0 || move.value! > 100) throw new GameError("Somewhere from 0 to 100.");
    answer = { value: move.value! };
  } else if (q.kind === "vote") {
    if (!others(s, seat).includes(move.pick as number)) throw new GameError("Vote for one of the others.");
    answer = { pick: move.pick! };
  } else if (q.kind === "either") {
    if (!Array.isArray(move.flags) || move.flags.length !== q.pairs.length || !move.flags.every((f) => typeof f === "boolean")) throw new GameError("Call each one, one way or the other.");
    answer = { flags: [...move.flags] };
  } else if (q.kind === "three") {
    const tags = Array.isArray(move.tags) ? move.tags.map((t) => (typeof t === "string" ? t.trim().slice(0, 24) : "")) : [];
    if (tags.length !== 3 || tags.some((t) => !tidy(t))) throw new GameError("Three answers, please.");
    if (new Set(tags.map(tidy)).size < 3) throw new GameError("Three different answers.");
    answer = { tags };
  } else {
    const text = typeof move.text === "string" ? move.text.trim().slice(0, 80) : "";
    if (!text) throw new GameError("Write something.");
    answer = { text };
  }
  s.answers[seat] = answer;
  if (s.answers.every(Boolean)) {
    if (q.kind === "caption") s.phase = "rate";
    else settle(s);
  }
  return s;
}

function view(s: RoomState, me: number): WordView {
  const over = s.phase === "finished";
  const showing = s.phase === "room" || over;
  const waiting = (seat: number) => (s.phase === "answer" ? !!s.answers[seat] : s.phase === "rate" ? !!s.stars[seat] : s.ready[seat]!);
  return {
    game: "readtheroom",
    seats: s.seats,
    me,
    teams: false,
    phase: s.phase,
    turn: null,
    boards: [],
    rack: null,
    keys: {},
    entry: null,
    pick: null,
    words: [],
    question: over ? null : promptOf(question(s)),
    form: formFor(s, me),
    room: showing ? tally(s) : null,
    choices: s.phase === "room" ? nextHandChoices(s.ready, me, s.hand >= s.asked.length, "Next question") : null,
    players: Array.from({ length: s.seats }, (_, seat) => ({
      line: showing ? (s.gained[seat] ? `+${s.gained[seat]}` : "nothing this time") : waiting(seat) ? "answered" : s.phase === "rate" ? "handing out stars" : "thinking",
      badge: String(s.points[seat]),
      done: waiting(seat),
    })),
    info: [`Question ${s.hand} of ${s.asked.length}`],
    narration: s.narration,
    scores: s.points.map((value, seat) => ({ seats: [seat], value })),
    result: null,
    over: over ? { winners: s.winners ?? [], title: s.winners?.length === 1 ? `${who(s.winners[0]!)} read the room best` : "A tie at the top" } : null,
  };
}

/** It answers as most people would, more or less: its guesses bunch in the middle, and its three answers are the common ones. */
function bot(s: RoomState, seat: number, style: PlayStyle, rand: () => number = Math.random): RoomMove | null {
  if (s.phase === "room") return s.ready[seat] ? null : { type: "next" };
  const form = formFor(s, seat);
  if (!form) return null;
  const pick = (n: number) => Math.floor(rand() * n);
  const wild = 1 - Math.min(1, Math.max(0, style.skill ?? 0.7));
  const q = question(s);
  if (form.kind === "rate") return { type: "rate", stars: form.items!.map(() => 2 + pick(4)) };
  if (form.kind === "scale") return { type: "answer", value: Math.min(100, Math.max(0, 35 + pick(31) + Math.round((rand() - 0.5) * 60 * wild))) };
  if (form.kind === "vote") return { type: "answer", pick: form.seats![rand() < 0.5 + wild / 2 ? pick(form.seats!.length) : 0]! };
  if (form.kind === "either") return { type: "answer", flags: form.pairs!.map(() => rand() < 0.35 + wild * 0.15) };
  if (form.kind === "three") return { type: "answer", tags: shuffled(THREES[q.at]!.common.slice(0, 4 + Math.round(wild * 4)), rand).slice(0, 3) };
  return { type: "answer", text: CAPTIONS[q.at]!.common[pick(CAPTIONS[q.at]!.common.length)]! };
}

const ROUNDS = [5, 8, 10, 12];
const fields: RuleField<RoomRules>[] = [
  { key: "rounds", label: "Questions", hint: "How many are asked", kind: "choice", options: ROUNDS.map((n) => [n, String(n)]) },
  { key: "taps", label: "No typing", hint: "Leaves out the questions where something is written", kind: "toggle" },
];

export const readTheRoom: WordGame<RoomRules, RoomState, RoomMove> = {
  id: "readtheroom",
  name: "Read the Room",
  emoji: "🫶",
  category: "words",
  blurb: "A party game with no right answers, only the room's. Slide, vote, call it and caption it, and score for guessing what the others will say.",
  tagline: "How well do you know these people?",
  seats: { min: 3, max: 8, default: 4 },
  teams: false,
  presets: PRESETS,
  fields,
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<RoomRules>;
    const preset = PRESETS.find((p) => p.id === given.id) ?? PRESETS[0]!;
    return {
      id: typeof given.id === "string" ? given.id : preset.id,
      name: typeof given.name === "string" && given.name ? given.name : preset.name,
      rounds: ROUNDS.includes(given.rounds as number) ? (given.rounds as number) : preset.rounds,
      taps: typeof given.taps === "boolean" ? given.taps : preset.taps,
    };
  },
  validate(rules) {
    return ROUNDS.includes(rules.rounds) ? [] : ["There are 5, 8, 10 or 12 questions."];
  },
  describe(rules) {
    return [
      `${rules.rounds} questions, and everyone answers each one at once. Nobody sees an answer until all are in.`,
      "A scale: slide to where you stand. The nearer the room's average, the more you score, up to 100.",
      "A vote: pick one of the others. 100 if you voted with the most votes.",
      "This or that, three times: 40 for each one you called with the majority.",
      ...(rules.taps ? [] : ["Name three: 30 for each answer somebody else gave too.", "A caption: write a line, then give the others' lines stars. Yours scores ten a star."]),
      "Most points when the questions run out wins.",
    ];
  },
  newGame(rules, seats, seed) {
    const s: RoomState = { game: "readtheroom", rules, seats, rng: seed >>> 0, hand: 1, dealer: 0, phase: "answer", asked: [], answers: Array(seats).fill(null), stars: Array(seats).fill(null), points: Array(seats).fill(0), gained: Array(seats).fill(0), ready: Array(seats).fill(false), winners: null, narration: null };
    const rand = nextRandom(s);
    // The kinds come round in turn, each from its own shuffled pile, so a night never asks the same thing twice.
    const kinds: Kind[] = rules.taps ? ["scale", "vote", "either"] : ["scale", "vote", "either", "three", "caption"];
    const piles = { scale: shuffled(SCALES.map((_, i) => i), rand), vote: shuffled(VOTES.map((_, i) => i), rand), either: shuffled(EITHERS.map((_, i) => i), rand), three: shuffled(THREES.map((_, i) => i), rand), caption: shuffled(CAPTIONS.map((_, i) => i), rand) };
    for (let n = 0; n < rules.rounds; n++) {
      const kind = kinds[n % kinds.length]!;
      const turn = Math.floor(n / kinds.length);
      if (kind === "either") s.asked.push({ kind, at: 0, pairs: piles.either.slice(turn * 3, turn * 3 + 3) });
      else s.asked.push({ kind, at: piles[kind][turn % piles[kind].length]!, pairs: [] });
    }
    return s;
  },
  apply,
  view,
  bot,
  thinkingTime: (s) => thinkFor(question(s).kind === "caption" || question(s).kind === "three" ? 7 : 4, 1.8),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "readtheroom",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand,
      scoreLine: s.points.join(" · "),
      order: over ? rankSeats(s.points.map((score, seat) => ({ seats: [seat], score }))) : null,
      winners: over ? s.winners : null,
      teams: false,
      seats: s.seats,
    };
  },
};
