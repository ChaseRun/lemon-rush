// Pixel-art sprites for the Rush, as plain data: each sprite is a list of equal-width string rows, one
// character per pixel. '.' is transparent; every other character is a key into PALETTE.
// No DOM here (sprites.test.ts checks the data in node); draw.ts turns these into canvases.

import type { CustomerTypeId } from '../../contract';

/** Shared colors. Matches the app theme: sky, lemon, leaf, ink, melon, paper, plus wood and skin tones. */
export const COLORS = {
  ink: '#1b2b48',
  paper: '#ffffff',
  sky: '#8fd3ff',
  skyMid: '#63b6ef',
  deepSky: '#3f9fe0',
  navy: '#2a5b9c',
  lemon: '#ffd43b',
  lemonDeep: '#f2b705',
  lemonPale: '#fff3c4',
  leaf: '#2f9e44',
  leafDark: '#1f7a35',
  leafLight: '#69c46a',
  grass: '#8fd16a',
  grassDark: '#5fb548',
  hill: '#a6dd8f',
  melon: '#e8445f',
  melonDark: '#b8324a',
  wood: '#b5733a',
  woodDark: '#7a4a22',
  woodLight: '#d99a5b',
  sidewalk: '#e9dcc0',
  sidewalkSeam: '#d2c09c',
  gray: '#9aa3ad',
  grayLight: '#d5dbe1',
  ice: '#cfefff',
  orange: '#ff8c1a',
} as const;

/** Sprite palette. '.' (transparent) is deliberately not a key. */
export const PALETTE: Readonly<Record<string, string>> = {
  k: COLORS.ink,
  w: COLORS.paper,
  E: COLORS.grayLight,
  e: COLORS.gray,
  y: COLORS.lemon,
  Y: COLORS.lemonDeep,
  g: COLORS.leaf,
  G: COLORS.leafDark,
  L: COLORS.leafLight,
  r: COLORS.melon,
  R: COLORS.melonDark,
  s: '#f6c99a', // skin, light
  S: '#d9a273', // skin, light shadow
  p: '#ff9aa8', // cheeks
  t: '#c68a5a', // skin, tan
  T: '#8a5634', // skin, deep
  h: '#6b3e1e', // hair, brown
  H: '#3d2412', // hair, dark
  n: COLORS.wood,
  N: COLORS.woodDark,
  m: COLORS.woodLight,
  b: COLORS.deepSky,
  B: COLORS.navy,
  c: COLORS.ice,
  u: '#4a6fb5', // denim
  v: '#9b6bc4', // cardigan
  V: '#74489a', // cardigan, dark
  o: COLORS.orange,
  O: '#d96a00', // orange, dark
};

export const TRANSPARENT = '.';

export interface PixelSprite {
  readonly w: number;
  readonly h: number;
  readonly rows: readonly string[];
}

function sprite(rows: string[]): PixelSprite {
  return { w: rows[0]?.length ?? 0, h: rows.length, rows };
}

// ---------- The kid (player), 12×20, facing right. Feet on the last non-empty row. ----------

const KID_HEAD = [
  '...kkkkkk...',
  '..khhhhhhk..',
  '.khhhhhhhhk.',
  '.khhhhssssk.',
  '.khhssssksk.',
  '.khsssssksk.',
  '.kssssssspk.',
  '..ksssssk...',
  '...kkkkk....',
];
const KID_BODY = [
  '..kyyyyyyk..',
  '.kyyywwyyyk.',
  '.ksywwwwysk.',
  '..kwwwYwwk..',
  '..kwwwwwwk..',
  '..kuuuuuuk..',
];

export const KID_IDLE = sprite([
  ...KID_HEAD,
  ...KID_BODY,
  '..kuukkuuk..',
  '..ksk..ksk..',
  '..ksk..ksk..',
  '..krrk.krrk.',
  '..kkkk.kkkk.',
]);

/** Legs apart. Feet one row higher than idle, so the run has a little hop. */
export const KID_RUN_A = sprite([
  ...KID_HEAD,
  ...KID_BODY,
  '.kuuk..kuuk.',
  'ksk......ksk',
  'krk.....krrk',
  'kkk.....kkkk',
  '............',
]);

/** Legs passing, front knee up. */
export const KID_RUN_B = sprite([
  ...KID_HEAD,
  ...KID_BODY,
  '..kuuuuuuk..',
  '...ksk.kssk.',
  '...ksk.krrk.',
  '..krrk.kkk..',
  '..kkkk......',
]);

// ---------- Customers: front-facing busts, 16×20. The counter hides the bottom rows. ----------

export const CUSTOMER_SPRITES: Readonly<Record<CustomerTypeId, PixelSprite>> = {
  // Allowance Kid: melon cap with the bill to the side, striped shirt. Shorter than the grown-ups.
  kid: sprite([
    '................',
    '................',
    '................',
    '................',
    '.....kkkkkk.....',
    '....krrrrrrk....',
    '...krrrwwrrrk...',
    '...kRRRRRRRRRRRk',
    '...khsssssshk...',
    '...kskssssksk...',
    '...kpsssssspk...',
    '....kssRRssk....',
    '.....kkkkkk.....',
    '......kssk......',
    '...kkbbbbbbkk...',
    '..kbbbbbbbbbbk..',
    '..kwwwwwwwwwwk..',
    '..kbbbbbbbbbbk..',
    '..kwwwwwwwwwwk..',
    '..kbbbbbbbbbbk..',
  ]),
  // Jogger: melon headband, sweat drop, green tank top with a race bib.
  jogger: sprite([
    '................',
    '................',
    '.....kkkkkk.....',
    '....kHHHHHHk....',
    '...kHHHHHHHHk.c.',
    '...krrrrrrrrk...',
    '...kttttttttk...',
    '...ktkttttktk...',
    '...ktttttttTk...',
    '....kttRRttk....',
    '.....kkkkkk.....',
    '......kttk......',
    '...kkkttttkkk...',
    '..kttkggggkttk..',
    '..kttggggggttk..',
    '..kttggwwggttk..',
    '..kttggggggttk..',
    '..kTtggggggtTk..',
    '..kTtggggggtTk..',
    '..kTtggggggtTk..',
  ]),
  // Grandma: gray bun, round glasses, rosy cheeks, purple cardigan with a white collar.
  grandma: sprite([
    '......kkkk......',
    '.....kEEEEk.....',
    '.....kEEeEk.....',
    '....kkkEEkkk....',
    '...kEEEEEEEEk...',
    '...kEEeEEeEEk...',
    '...kEssssssEk...',
    '...keeeeeeeek...',
    '...kekessekek...',
    '...kpsssssspk...',
    '....ksSRRSsk....',
    '.....kkkkkk.....',
    '...kkkwwwwkkk...',
    '..kvvvwwwwvvvk..',
    '..kvvvvwwvvvvk..',
    '..kvvvvVVvvvvk..',
    '..kvvvvVVvvvvk..',
    '..kvVvvVVvvVvk..',
    '..kvvvvVVvvvvk..',
    '..kvvvvVVvvvvk..',
  ]),
  // Construction Worker: yellow hard hat, mustache, orange safety vest with reflective stripes.
  worker: sprite([
    '................',
    '......kkkk......',
    '....kkyyyykk....',
    '...kyyyywyyyk...',
    '...kyyyyyyyyk...',
    '..kYYYYYYYYYYk..',
    '...kTTTTTTTTk...',
    '...kTkTTTTkTk...',
    '...kTTTTTTTTk...',
    '...kTHHHHHHTk...',
    '....kTTTTTTk....',
    '.....kkkkkk.....',
    '...kkoouuookk...',
    '..kooouuuuoook..',
    '..kwwwuuuuwwwk..',
    '..kooouuuuoook..',
    '..kooouuuuoook..',
    '..kwwwuuuuwwwk..',
    '..kooouuuuoook..',
    '..kOOOuuuuOOOk..',
  ]),
};

// ---------- Props and icons ----------

/** A glass of lemonade with a straw. Order-bubble icon and the glass the kid carries. */
export const GLASS = sprite([
  '.....r',
  '....r.',
  'kccrck',
  'kyyryk',
  'kwyyyk',
  'kyyyyk',
  '.kyyk.',
  '.kkkk.',
]);

/** Order bubble, 16×14. The icon goes at (+5, +2). The tail points down at the customer. */
export const BUBBLE = sprite([
  '.kkkkkkkkkkkkkk.',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kEwwwwwwwwwwwwEk',
  '.kkkkkkwwkkkkkk.',
  '......kwk.......',
  '.......k........',
]);

/** Spinning coin: face, then edge. */
export const COIN_FRAMES: readonly PixelSprite[] = [
  sprite(['.kkkk.', 'kyywyk', 'kywyYk', 'kyyyYk', 'kyYYYk', '.kkkk.']),
  sprite(['..kk..', '.kyYk.', '.kyYk.', '.kyYk.', '.kyYk.', '..kk..']),
];

export const HEART = sprite(['.kk.kk.', 'krwkrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...']);

/** Anger mark, shown by red-bar and walking-out customers. */
export const ANGER = sprite(['.r.r.', 'rr.rr', '.....', 'rr.rr', '.r.r.']);

/** Bobbing "press Space here" arrow over the kid's head. */
export const ARROW = sprite(['kkkkkkk', 'kyyyyyk', '.kyyyk.', '..kyk..', '...k...']);

// HUD icons (about 7×7)
export const ICON_LEMON = sprite(['..kkkgg', '.kyywyk', 'kyyyyyk', 'kyyyyYk', '.kYYYk.', '..kkk..']);
export const ICON_SUGAR = sprite(['..kkkk..', '...kk...', '..kwwk..', '.kwwwwk.', 'kwwwwwwk', 'kbbbbbbk', 'kwwwwwwk', '.kkkkkk.']);
export const ICON_ICE = sprite(['.kkkk.', 'kwwcck', 'kwccbk', 'kcccbk', 'kbbbbk', '.kkkk.']);
export const ICON_CUP = sprite(['kkkkkk', 'kwwwwk', 'krrrrk', 'kwwwwk', '.kwwk.', '.kwwk.', '.kkkk.']);
export const ICON_CLOCK = sprite(['..kkk..', '.kwwwk.', 'kwwkwwk', 'kwwkkwk', 'kwwwwwk', '.kwwwk.', '..kkk..']);
export const ICON_JUG = sprite(['kkkkk..', 'kccckk.', 'kyyyk.k', 'kyyyk.k', 'kyyykk.', 'kyyyk..', 'kkkkk..']);

// Prep station props, sitting on the counter
export const LEMON_CRATE = sprite([
  '..kyk.kyyk.kyk..',
  '.kyyykyyyykyyyk.',
  'kkkkkkkkkkkkkkkk',
  'knnnnnnnnnnnnnnk',
  'kNNNNNNNNNNNNNNk',
  'knnnnnnnnnnnnnnk',
  'kNNNNNNNNNNNNNNk',
  'knnnnnnnnnnnnnnk',
  'kkkkkkkkkkkkkkkk',
]);
export const SUGAR_SACK = sprite([
  '...kkkk...',
  '....kk....',
  '...kwwk...',
  '..kwwwwk..',
  '.kwwwwwwk.',
  'kwwwwwwwwk',
  'kbbbbbbbbk',
  'kwwwwwwwwk',
  'kwwwwwwwwk',
  'kEwwwwwwEk',
  '.kkkkkkkk.',
]);
export const ICE_COOLER = sprite([
  '...kck.kcck...',
  'kkkkkkkkkkkkkk',
  'kwwwwwwwwwwwwk',
  'kkkkkkkkkkkkkk',
  'kbbbbbbbbbbbbk',
  'kbbbkwwwwkbbbk',
  'kbbbbbbbbbbbbk',
  'kBBBBBBBBBBBBk',
  'kBBBBBBBBBBBBk',
  'kkkkkkkkkkkkkk',
]);
export const CUP_STACK = sprite(['kkkkkk', 'kwwwwk', 'krrrrk', 'kwwwwk', 'krrrrk', 'kwwwwk', 'krrrrk', '.kwwk.', '.kwwk.', '.kkkk.']);

// Scenery
export const SUN = sprite([
  '......Y......',
  '.Y....Y....Y.',
  '..Y.......Y..',
  '.....yyy.....',
  '....yyyyy....',
  '...yywyyyy...',
  'YY.yyyyyyy.YY',
  '...yyyyyyY...',
  '....yyyYY....',
  '.....yYY.....',
  '..Y.......Y..',
  '.Y....Y....Y.',
  '......Y......',
]);
export const CLOUD = sprite([
  '.......www..........',
  '....wwwwwwww..www...',
  '..wwwwwwwwwwwwwwwww.',
  '.wwwwwwwwwwwwwwwwwww',
  '.EEEwwwwwwwwwwwwEEE.',
  '...EEEEEEEEEEEEEE...',
]);

/** Every sprite, by name, for tests and the canvas cache. */
export const ALL_SPRITES: Readonly<Record<string, PixelSprite>> = {
  KID_IDLE,
  KID_RUN_A,
  KID_RUN_B,
  ...Object.fromEntries(Object.entries(CUSTOMER_SPRITES).map(([k, v]) => [`CUSTOMER_${k}`, v])),
  GLASS,
  BUBBLE,
  COIN_0: COIN_FRAMES[0],
  COIN_1: COIN_FRAMES[1],
  HEART,
  ANGER,
  ARROW,
  ICON_LEMON,
  ICON_SUGAR,
  ICON_ICE,
  ICON_CUP,
  ICON_CLOCK,
  ICON_JUG,
  LEMON_CRATE,
  SUGAR_SACK,
  ICE_COOLER,
  CUP_STACK,
  SUN,
  CLOUD,
};
