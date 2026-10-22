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

