// Writes packages/games/src/worddata.ts: the words the word games play with.
//
//   node scripts/build-words.mjs <enable1.txt> <wordlist-english package dir>
//
// Two sources, neither kept in this repository (see packages/games/words/README.md for where they
// come from and their terms):
//
// - ENABLE (enable1.txt): what counts as a word. Words of 2 to 8 letters are kept, which is every
//   word these games can make.
// - SCOWL, as the npm package wordlist-english: how common a word is. Its levels 10 and 20 are
//   the words everyone knows (a word to be guessed comes from these), and up to 35 the words most
//   people know (a computer player's vocabulary).
//
// The output is one string per word length, the words end to end in order (so a word is found by
// a binary search and nothing is parsed at start-up), and for each of the two commoner sets a
// bit per word, in the same order.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [enablePath, scowlDir] = process.argv.slice(2);
if (!enablePath || !scowlDir) throw new Error("usage: node scripts/build-words.mjs <enable1.txt> <wordlist-english dir>");
const MIN = 2;
const MAX = 8;

// Words nobody should be handed to guess at a family table. They stay playable (a word is a word);
// they are only never chosen as the answer.
const NOT_AN_ANSWER = new Set(
  "abuse abused abuses ass asses bastard bitch bloody boob boobs breast breasts butt butts cancer cocaine cock cocks corpse corpses crap damn damned dead death deaths devil dick died dies drug drugs drunk dying fag fags fart farts fatal fatso gay gays god gods hell heroin hitler homo horny idiot idiots kill killed killer killers kills lesbian lust murder murders naked nazi nazis nude orgy penis piss porn pussy queer racist rape raped rapes rapist sex sexes sexual sexy shit slave slaves slut sluts stupid suicide tits torture urine vagina virgin vomit whore whores"
    .split(" "),
);

const enable = readFileSync(enablePath, "utf8").split(/\r?\n/).filter((w) => /^[a-z]+$/.test(w) && w.length >= MIN && w.length <= MAX);
const level = (n) => ["english", "american"].flatMap((kind) => JSON.parse(readFileSync(join(scowlDir, `${kind}-words-${n}.json`), "utf8")));
const plain = new Set([...level(10), ...level(20)].filter((w) => !NOT_AN_ANSWER.has(w)));
const common = new Set([...plain, ...level(35)]);

const byLength = new Map();
for (const word of enable) byLength.set(word.length, [...(byLength.get(word.length) ?? []), word]);
const bits = (words, set) => {
  const bytes = new Uint8Array(Math.ceil(words.length / 8));
  words.forEach((w, i) => set.has(w) && (bytes[i >> 3] |= 1 << (i & 7)));
  return Buffer.from(bytes).toString("base64");
};
const lengths = [...byLength.keys()].sort((a, b) => a - b);
const table = (value) => `{\n${lengths.map((n) => `  ${n}: ${JSON.stringify(value(byLength.get(n).sort()))},`).join("\n")}\n}`;
const count = (set) => enable.filter((w) => set.has(w)).length;

const out = `// Written by scripts/build-words.mjs: don't edit it by hand. See packages/games/words/README.md
// for where the words come from.
//
// ${enable.length} words of ${MIN} to ${MAX} letters from ENABLE; ${count(common)} of them marked common, ${count(plain)} plain.

/** Every word, by length: the words of that length end to end, in order. */
export const WORDS: Record<number, string> = ${table((words) => words.join(""))};

/** A bit per word of \`WORDS\`, in the same order (base64, lowest bit first): the words most people know. */
export const COMMON: Record<number, string> = ${table((words) => bits(words, common))};

/** The same, for the words everyone knows: the ones a player may be asked to guess. */
export const PLAIN: Record<number, string> = ${table((words) => bits(words, plain))};
`;
const target = join(dirname(fileURLToPath(import.meta.url)), "../packages/games/src/worddata.ts");
writeFileSync(target, out);
console.log(`wrote ${target}: ${enable.length} words, ${count(common)} common, ${count(plain)} plain, ${(out.length / 1024).toFixed(0)} KB`);
for (const n of lengths) console.log(`  ${n} letters: ${byLength.get(n).length} words, ${byLength.get(n).filter((w) => common.has(w)).length} common, ${byLength.get(n).filter((w) => plain.has(w)).length} plain`);
