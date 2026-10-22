import type { MapDefinition } from './tilemap';

/**
 * テスト用のタイルのマップ。ゲームのコースは中心線で描く道路に作り直したが、タイルのコースの仕組み
 * （src/race/course.ts・src/map/obstacles.ts など）を確かめるために、前のタイルのレイアウトを残しておく
 */

/**
 * タイムアタック用の周回サーキット。交差点はなく、一周が1本道。
 * 速度を出せるよう、タイルを大きく（カーブの半径 20m）、道幅を広くしている。
 */
export const CIRCUIT_MAP: MapDefinition = {
  id: 'circuit',
  name: 'サーキット',
  tileSize: 40,
  roadWidth: 16,
  layout: [
    '...............',
    '.RRRRRRRRRRRRR.',
    '.R..T.....T..R.',
    '.R..RRRRR....R.',
    '.R..R.T.R..T.R.',
    '.RRRR...R..RRR.',
    '..T.....R..R...',
    '...RRRRRR..R.T.',
    '...R..B..T.R...',
    '...RRRRRRRRR...',
    '...............',
  ],
  start: { col: 6, row: 1, heading: 'E' },
  guardrails: true,
  race: { laps: 3 },
};


/** 短い直線とコーナーが続く周回コース。カーブの半径は 15m と小さめ */
export const TECHNICAL_MAP: MapDefinition = {
  id: 'technical',
  name: 'テクニカルコース',
  tileSize: 30,
  roadWidth: 14,
  layout: [
    '.................',
    '.RRRRR..T..RRRRR.',
    '.R.T.R.....R.T.R.',
    '.R...RRR.RRR...R.',
    '.R..T..R.R..T..R.',
    '.RRR...RRR...RRR.',
    '...R..T...T..R...',
    '.RRR..RRRRR..RRR.',
    '.R....R.B.R....R.',
    '.R..RRR...RRR..R.',
    '.R..R..T.T..R..R.',
    '.RRRR.......RRRR.',
    '.................',
  ],
  start: { col: 8, row: 7, heading: 'E' },
  guardrails: true,
  race: { laps: 2 },
};


/** 峠道のレイアウト。左下の行き止まりがふもと、左上の行き止まりが頂上 */
const PASS_LAYOUT = [
  '...................',
  '.RRRRRR..T....T....',
  '..T...R..RRRR...T..',
  '......R..R..R......',
  '.T....RRRR..R..T...',
  '....T.......R......',
  '..RRRRRR..RRR...T..',
  '..R....R..R...T....',
  '..R..T.RRRR.....T..',
  '..R.........T......',
  '..RRRR..RRRRRRRRR..',
  '.T...R..R..T....R..',
  '.....RRRR...RRRRR..',
  '..T.....T...R...T..',
  '..RRRRRRRRRRR......',
  '...................',
];
const PASS_ELEVATION = { from: { col: 2, row: 14 }, rise: 150 };
/** ふもとから頂上まで上る一本道。坂で車が重くなる */
export const HILLCLIMB_MAP: MapDefinition = {
  id: 'hillclimb',
  name: '峠（ヒルクライム）',
  tileSize: 30,
  roadWidth: 11,
  layout: PASS_LAYOUT,
  start: { col: 5, row: 14, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: PASS_ELEVATION,
};


/** 同じ峠を頂上から下る。スピードが乗るので早めのブレーキが大事 */
export const DOWNHILL_MAP: MapDefinition = {
  id: 'downhill',
  name: '峠（ダウンヒル）',
  tileSize: 30,
  roadWidth: 11,
  layout: PASS_LAYOUT,
  start: { col: 4, row: 1, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: PASS_ELEVATION,
};


/** 川を4回渡る周回コース。橋の上は欄干に囲まれ、川岸には柵がある */
export const RIVERSIDE_MAP: MapDefinition = {
  id: 'riverside',
  name: '川と橋のコース',
  tileSize: 30,
  roadWidth: 12,
  layout: [
    '.........~~.........',
    '.RRRRRRRR==RRRRRRRR.',
    '.R.......~~.......R.',
    '.R..T....~~...T...R.',
    '.R.RRRRRR==RRRRRRRR.',
    '.R.R.....~~.....T...',
    '.R.R..T..~~.........',
    '.R.RRRRRR==RRRRRRRR.',
    '.R.......~~.......R.',
    '.R...T...~~...T...R.',
    '.RRRRRRRR==RRRRRRRR.',
    '.........~~.........',
  ],
  start: { col: 4, row: 1, heading: 'E' },
  guardrails: true,
  race: { laps: 2 },
};


const HAIRPIN_LAYOUT = [
  '.............',
  '.............',
  '......RRR....',
  '..T...R......',
  '......R...T..',
  '...RRRR......',
  '...R.........',
  '...RRRRRRRR..',
  'T.........R.T',
  '....RRRRRRR..',
  '....R........',
  '.T..RRRRRR...',
  '.........R...',
  '..RRRRRRRR...',
  '..R..........',
  '..RRRRRRR....',
  '........R...T',
  '...RRRRRR....',
  '...R.........',
  '...RRRRRRRR..',
  '..........R..',
  '.T...RRRRRR..',
  '.T...R.......',
  '..RRRR....T..',
  '.............',
  '...T.........',
];

const HAIRPIN_DOWN_LAYOUT = [
  '.............',
  '.............',
  '......RRRRR..',
  '..T...R......',
  '......R...T..',
  '...RRRR......',
  '...R.........',
  '...RRRRRRRR..',
  'T.........R.T',
  '....RRRRRRR..',
  '....R........',
  '.T..RRRRRR...',
  '.........R...',
  '..RRRRRRRR...',
  '..R..........',
  '..RRRRRRR....',
  '........R...T',
  '...RRRRRR....',
  '...R.........',
  '...RRRRRRRR..',
  '..........R..',
  '.T...RRRRRR..',
  '.T...R.......',
  '..RRRR....T..',
  '.............',
  '...T.........',
];

/** 斜面をつづら折りで上る。ヘアピンが十数個続く */
export const HAIRPIN_MAP: MapDefinition = {
  id: 'hairpin',
  name: 'つづら折り（ヘアピン）',
  tileSize: 22,
  roadWidth: 10,
  layout: HAIRPIN_LAYOUT,
  start: { col: 4, row: 23, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: { from: { col: 2, row: 23 }, rise: 150 },
};

/**
 * つづら折りを上から下る。ヘアピンの内側には段差のある近道の帯があり、
 * 内側の内側を攻める「地元走り」ができる（段差で少し宙に浮く）
 */
export const HAIRPIN_DOWN_MAP: MapDefinition = {
  id: 'hairpin-down',
  name: 'つづら折り（ダウンヒル）',
  tileSize: 22,
  roadWidth: 10,
  layout: HAIRPIN_DOWN_LAYOUT,
  start: { col: 8, row: 2, heading: 'W' },
  guardrails: true,
  race: { laps: 1 },
  elevation: { from: { col: 2, row: 23 }, rise: 160 },
  shortcuts: true,
};

/**
 * 谷を橋で渡り、山をトンネルで抜ける 5km あまりの峠。橋は 3 か所（コーナーの続く区間の途中）、
 * トンネルは短いもの（90m）と長いもの（360m）が 1 本ずつ。左下の行き止まりがふもと、右上の行き止まりが頂上
 */
const VALLEY_LAYOUT = [
    '.T....T.TTT...............................T.....TT.....',
    '.....T.........T.RRRRRR############RR.T...........RRRR.',
    '..TTT..T....T....R..................R.T........~..R....',
    '...T.T.......TTT.RRRR.........T.....R....T.TT..~..RRR..',
    'T......TT...........R....T........RRR.T........~....R..',
    '..TT...TT....T......RRR..T........R........RRR===RR.R..',
    '.TT.T.T...T......T.T..R.....TT....RRRR..T..R...~..R.R.T',
    '.T...T................R..T.T.........R.....RRR.~..RRR..',
    '.......T.RRRR###RR..RRR.....TT.......RRR.....R.........',
    'T........R.......R..R......TT.T....~...R.....RRRR...T..',
    '...T.....RRRRR...RRRR...T........T.~.RRR........R...TT.',
    '.......TT....R.............T.......~.R..T..TT...R......',
    '.T.........RRR.....T.TTT.T......RR===R.......T..R......',
    'TT.T.......R....T..T.........T..R.........RRR...R.T..T.',
    '..T........R......T...TT....TT..RRRRR.....R.R...R..TTT.',
    '...........RRRR.........T...........R.....R.R...R......',
    '.....RRR......R........T............R.....R.R.RRR......',
    '.....R.R...~..R...T....T.T.T..T..RRRR..RRRR.R.R..T.T...',
    '.RRRRR.RRR===RR...T..T..T.T..T...R.....R....R.R.....T..',
    'T.....T....~...T.........TTT.....RRRRRRR....RRR.T.T.T..',
    '..T........~.......TT..........TT..........T.....TTT.TT',
];
const VALLEY_ELEVATION = { from: { col: 1, row: 18 }, rise: 230 };

/** 橋とトンネルの峠を上る */
export const VALLEY_UP_MAP: MapDefinition = {
  id: 'valley-up',
  name: '橋とトンネルの峠（ヒルクライム）',
  tileSize: 30,
  roadWidth: 11,
  layout: VALLEY_LAYOUT,
  start: { col: 3, row: 18, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: VALLEY_ELEVATION,
};
