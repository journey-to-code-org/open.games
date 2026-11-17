# The words

`../src/worddata.ts` is written by `scripts/build-words.mjs` from two word lists. Neither is kept
in this repository: fetch them, and run the script again, to change what counts as a word.

| | What it is here | Where it comes from | Terms |
| --- | --- | --- | --- |
| **ENABLE** (`enable1.txt`) | What counts as a word: every word of 2 to 8 letters, 80,368 of them. | The Enhanced North American Benchmark Lexicon, compiled by Alan Beale and Mendel Cooper. A copy is at `https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt`. | Released into the public domain by its compilers. |
| **SCOWL** (npm `wordlist-english` 1.2.1) | How common a word is. Its levels 10 and 20 mark the words a player may be asked to guess; up to level 35, a computer player's vocabulary. Only a mark per ENABLE word is kept, not the lists. | Spell Checker Oriented Word Lists, by Kevin Atkinson. | Free to use, copy, modify and distribute provided its copyright notice is kept: it is in [SCOWL-Copyright.txt](SCOWL-Copyright.txt). |

```sh
curl -o /tmp/enable1.txt https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
(cd /tmp && npm pack wordlist-english@1.2.1 && tar xzf wordlist-english-1.2.1.tgz)
node scripts/build-words.mjs /tmp/enable1.txt /tmp/package
```

A short list of words in the script are never chosen as an answer at a family table. They are
still words: anyone may play them.
