// The mahjong tile set, shared by every mahjong game here: three suits of nine (dots, bamboo,
// characters), four winds, three dragons, and the eight bonus tiles (four flowers, four seasons).
// 144 tiles in all; each of the 34 plain kinds comes four times, each bonus tile once.
//
// A tile is plain data, so a state can be stored and replayed. `tileKey` says what a tile is
// exactly (Riichi matches on it); `matchKey` is the looser match Shanghai uses, where any flower
// goes with any flower and any season with any season. `tileGlyph` is the Unicode tile, so a table
// that has no tile art can still draw one.

export type TileFamily = "dots" | "bamboo" | "characters" | "wind" | "dragon" | "flower" | "season";

export interface MahjongTile {
  family: TileFamily;
  /** 1 to 9 in a suit; winds 1 to 4 (East, South, West, North); dragons 1 to 3 (red, green, white); flowers and seasons 1 to 4. */
  rank: number;
  /** Which of the (up to four) identical tiles this is, from 1. Flowers and seasons are all copy 1. */
  copy: number;
}

export const SUIT_FAMILIES: TileFamily[] = ["dots", "bamboo", "characters"];
export const isSuit = (t: MahjongTile) => SUIT_FAMILIES.includes(t.family);
export const isHonor = (t: MahjongTile) => t.family === "wind" || t.family === "dragon";
export const isBonus = (t: MahjongTile) => t.family === "flower" || t.family === "season";
/** A one or a nine of a suit, or any honor: the "terminals and honors" of Riichi. */
export const isTerminalOrHonor = (t: MahjongTile) => isHonor(t) || (isSuit(t) && (t.rank === 1 || t.rank === 9));

const WINDS = ["East", "South", "West", "North"];
const DRAGONS = ["Red", "Green", "White"];
const FLOWERS = ["Plum", "Orchid", "Bamboo", "Chrysanthemum"];
const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];

/** The 34 kinds that play in every mahjong game, in the order a rack sorts them. */
export const PLAIN_KINDS: { family: TileFamily; rank: number }[] = [
  ...SUIT_FAMILIES.flatMap((family) => Array.from({ length: 9 }, (_, i) => ({ family, rank: i + 1 }))),
  ...Array.from({ length: 4 }, (_, i) => ({ family: "wind" as TileFamily, rank: i + 1 })),
  ...Array.from({ length: 3 }, (_, i) => ({ family: "dragon" as TileFamily, rank: i + 1 })),
];

/** The whole set: 136 plain tiles then the eight bonus tiles, in a fixed order. */
export function fullTileSet(): MahjongTile[] {
  const out: MahjongTile[] = [];
  for (const kind of PLAIN_KINDS) for (let copy = 1; copy <= 4; copy++) out.push({ ...kind, copy });
  for (let rank = 1; rank <= 4; rank++) out.push({ family: "flower", rank, copy: 1 });
  for (let rank = 1; rank <= 4; rank++) out.push({ family: "season", rank, copy: 1 });
  return out;
}

/** What the tile is exactly: "dots-5", "wind-1", "flower-3". Identical tiles share it. */
export const tileKey = (t: MahjongTile) => `${t.family}-${t.rank}`;
/** The match Shanghai makes: any flower goes with any flower, any season with any season. */
export const matchKey = (t: MahjongTile) => (t.family === "flower" || t.family === "season" ? t.family : tileKey(t));
/** A unique name for this very tile, for a move to point at: "dots-5-2". */
export const tileId = (t: MahjongTile) => `${tileKey(t)}-${t.copy}`;

/** The order a rack is sorted in: suits (dots, bamboo, characters), winds, dragons, bonus tiles. */
export const tileOrder = (t: MahjongTile) => ({ dots: 0, bamboo: 1, characters: 2, wind: 3, dragon: 4, flower: 5, season: 6 })[t.family] * 10 + t.rank;

export function tileName(t: MahjongTile): string {
  switch (t.family) {
    case "wind":
      return `${WINDS[t.rank - 1]} wind`;
    case "dragon":
      return `${DRAGONS[t.rank - 1]} dragon`;
    case "flower":
      return FLOWERS[t.rank - 1]!;
    case "season":
      return SEASONS[t.rank - 1]!;
    default:
      return `${t.rank} of ${t.family}`;
  }
}

/** The Unicode mahjong tile (🀇): characters, bamboo, dots, winds, dragons, flowers and seasons. */
export function tileGlyph(t: MahjongTile): string {
  const base = { characters: 0x1f007, bamboo: 0x1f010, dots: 0x1f019, wind: 0x1f000, dragon: 0x1f004, flower: 0x1f022, season: 0x1f026 }[t.family];
  return String.fromCodePoint(base + t.rank - 1);
}
