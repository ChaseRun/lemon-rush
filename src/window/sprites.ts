// Pixel sprites for the window Rush, as plain data. Each sprite is a list of equal-width rows, one character
// per pixel; '.' is transparent and every other character is a key into PALETTE. No DOM here.

import type { CustomerTypeId } from '../contract';

/** App palette (sky, lemon, leaf, ink, melon, paper) plus warm wood browns and skin tones. */
export const COLORS = {
  sky: '#8fd3ff',
  skyLight: '#c9ecff',
  deepSky: '#3f9fe0',
  lemon: '#ffd43b',
  lemonDeep: '#f2b705',
  lemonPale: '#fff3c4',
  leaf: '#2f9e44',
  leafLight: '#69c46a',
  grass: '#8fd16a',
  grassDark: '#5fb548',
  ink: '#1b2b48',
  inkSoft: '#52627e',
  melon: '#e8445f',
  melonDark: '#b8324a',
  paper: '#ffffff',
  paperWarm: '#fff8e7',
  wood: '#b5733a',
  woodDark: '#7a4a22',
  woodDeep: '#5a3518',
  woodLight: '#d99a5b',
  woodPale: '#e8b97f',
  sidewalk: '#e9dcc0',
  sidewalkSeam: '#d2c09c',
  gray: '#9aa3ad',
  grayLight: '#d5dbe1',
  ice: '#cfefff',
  glass: '#e6f6ff',
  kid: '#ff8fab',
  jogger: '#4dabf7',
  grandma: '#b197fc',
  worker: '#ffa94d',
} as const;

export const PALETTE: Readonly<Record<string, string>> = {
  k: COLORS.ink,
  w: COLORS.paper,
  e: COLORS.gray,
  E: COLORS.grayLight,
  y: COLORS.lemon,
  Y: COLORS.lemonDeep,
  r: COLORS.melon,
  R: COLORS.melonDark,
  s: '#f6c99a', // skin, light
  t: '#c68a5a', // skin, tan
  T: '#8a5634', // skin, deep
  p: '#ff9aa8', // cheeks
  h: '#6b3e1e', // hair, brown
  u: '#4a6fb5', // denim
  B: '#2a5b9c', // navy
  N: COLORS.woodDark, // boots
  P: COLORS.kid,
  J: COLORS.jogger,
  M: COLORS.grandma,
  V: '#7a5cc4', // skirt
  W: COLORS.worker,
};

export interface PixelSprite {
  readonly w: number;
  readonly h: number;
  readonly rows: readonly string[];
}

function sprite(rows: string[]): PixelSprite {
  return { w: rows[0]?.length ?? 0, h: rows.length, rows };
}

/** Kid in a red ball cap and a pink tee. */
const KID = sprite([
  '....rrrr....',
  '...rrrrrr...',
  '...rrrrrrrr.',
  '...ssssss...',
  '...skssks...',
  '...ssssss...',
  '...pskksp...',
  '....ssss....',
  '..PPPPPPPP..',
  '.PPPPPPPPPP.',
  '.sPPPPPPPPs.',
  '.sPPPPPPPPs.',
  '.sPPPPPPPPs.',
  '..uuuuuuuu..',
  '..uuuuuuuu..',
  '..uuu..uuu..',
  '..sss..sss..',
  '..sss..sss..',
  '..sss..sss..',
  '..kkk..kkk..',
]);

/** Jogger with a white headband and a blue tank top. */
const JOGGER = sprite([
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..wwwwwwww..',
  '..httttttt..',
  '...tkttkt...',
  '...tttttt...',
  '...ttkktt...',
  '....tttt....',
  '..JJJJJJJJ..',
  '.tJJJJJJJJt.',
  '.tJJwwwwJJt.',
  '.tJJJJJJJJt.',
  '.t.JJJJJJ.t.',
  '...BBBBBB...',
  '...BBBBBB...',
  '...tt..tt...',
  '...tt..tt...',
  '...tt..tt...',
  '...tt..tt...',
  '..www..www..',
]);

/** Grandma with a gray bun, round glasses and a purple cardigan. */
const GRANDMA = sprite([
  '....EEEE....',
  '....eEEe....',
  '..EEEEEEEE..',
  '..EssssssE..',
  '..EkksskkE..',
  '..EssssssE..',
  '...pskksp...',
  '....ssss....',
  '..MMMMMMMM..',
  '.MMMMwwMMMM.',
  '.MMMMwwMMMM.',
  '.sMMMwwMMMs.',
  '.sMMMwwMMMs.',
  '..VVVVVVVV..',
  '..VVVVVVVV..',
  '..VVVVVVVV..',
  '...ss..ss...',
  '...ss..ss...',
  '...ss..ss...',
  '..kkk..kkk..',
]);

/** Construction worker: yellow hard hat, orange safety vest, jeans, boots. */
const WORKER = sprite([
  '...yyyyyy...',
  '..yyyyyyyy..',
  '.YYYYYYYYYY.',
  '...TTTTTT...',
  '...TkTTkT...',
  '...TTTTTT...',
  '...ThhhhT...',
  '....TTTT....',
  '..WWeeeeWW..',
  '.WWWeeeeWWW.',
  '.TWWWyyWWWT.',
  '.TWWeeeeWWT.',
  '.TWWeeeeWWT.',
  '..uuuuuuuu..',
  '..uuuuuuuu..',
  '..uuu..uuu..',
  '..uuu..uuu..',
  '..uuu..uuu..',
  '..uuu..uuu..',
  '.NNNN..NNNN.',
]);

export const CUSTOMER_SPRITES: Record<CustomerTypeId, PixelSprite> = {
  kid: KID,
  jogger: JOGGER,
  grandma: GRANDMA,
  worker: WORKER,
};

/** Kids are a bit shorter. */
export const CUSTOMER_HEIGHT: Record<CustomerTypeId, number> = { kid: 0.82, jogger: 1, grandma: 0.94, worker: 1.04 };

export const CUSTOMER_LABEL: Record<CustomerTypeId, string> = {
  kid: 'Allowance Kid',
  jogger: 'Jogger',
  grandma: 'Grandma',
  worker: 'Construction Worker',
};

/** Row of the mouth in every sprite (for happy / angry overlays). */
export const MOUTH_ROW = 6;
