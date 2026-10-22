import { ROAD_ORIGIN, type RoadPiece, type RoadSpec, closeLoop, reverseRoad } from './road';
import type { MapDefinition } from './tilemap';

/** 最初の練習用の小さな街 */
export const TOWN_MAP: MapDefinition = {
  id: 'town',
  name: '小さな街',
  tileSize: 20,
  roadWidth: 12,
  layout: [
    '...........',
    '.RRRRRRRRR.',
    '.R.B.R.B.R.',
    '.R.B.R.T.R.',
    '.RRRRRRcRR.',
    '.R.T.R.T.R.',
    '.R.B.R.BBR.',
    '.RRRRR...R.',
    '.T.B.RRRRR.',
    '...........',
  ],
  start: { col: 2, row: 4, heading: 'E' },
  signs: [
    { col: 3, row: 4, type: 'speed40', corner: 'NW', facing: 'W' },
    { col: 5, row: 3, type: 'stop', corner: 'SE', facing: 'N' },
    { col: 5, row: 5, type: 'stop', corner: 'NW', facing: 'S' },
  ],
};

/** 教習所のような練習コース。外周、S字・クランク風の連続カーブ、内側の交差点 */
export const SCHOOL_MAP: MapDefinition = {
  id: 'school',
  name: '教習所コース',
  tileSize: 20,
  roadWidth: 12,
  layout: [
    '.............',
    '.RRRRRRcRRRR.',
    '.R....B....R.',
    '.R.RRR.RRR.R.',
    '.R.R.R.R.R.R.',
    '.RRR.RRR.RRR.',
    '.R.........R.',
    '.R..RRRRR..R.',
    '.RRRR.R.RRRR.',
    '.T..RRRRR..T.',
    '.............',
  ],
  start: { col: 2, row: 1, heading: 'E' },
  guardrails: true,
  signs: [
    { col: 3, row: 1, type: 'speed30', corner: 'NW', facing: 'W' },
    { col: 11, row: 4, type: 'stop', corner: 'SE', facing: 'N' },
    { col: 3, row: 8, type: 'stop', corner: 'NE', facing: 'W' },
    { col: 9, row: 8, type: 'stop', corner: 'SW', facing: 'E' },
  ],
};






/** 中心線で描く道路のマップ（タイルのレイアウトは使わない） */
function roadMap(id: string, name: string, road: RoadSpec, laps = 1): MapDefinition {
  return { id, name, tileSize: 20, roadWidth: road.width, layout: [], start: { col: 0, row: 0, heading: 'E' }, race: { laps }, road };
}

/** ごく僅かに左右へくねりながら続く直線（半径 radius [m] の円弧で ±turn [度] ずつ、count 回） */
function wiggle(count: number, radius: number, turn: number, extra: Omit<RoadPiece, 'straight' | 'arc'> = {}): RoadPiece[] {
  // 最初と最後は半分だけ曲げて、入る向きと出る向きを直線と同じにする
  return Array.from({ length: count }, (_, i) => {
    const t = i === 0 || i === count - 1 ? turn / 2 : turn;
    return { arc: { radius, turn: i % 2 === 0 ? t : -t }, ...extra };
  });
}

/**
 * 周回のサーキット（約 3.5km）。1km のメインストレートの先の低速のヘアピン、退避帯の広い高速の S 字、
 * バックストレート、複合コーナー、半径 200m の高速コーナーと、速さの違うコーナーがそろう
 */
const CIRCUIT_PIECES: RoadPiece[] = [
  { straight: 700 },
  // 1コーナー: 低速のヘアピン
  { arc: { radius: 28, turn: -150 } },
  { straight: 160 },
  // 高速の S 字
  { arc: { radius: 130, turn: 55 } },
  { arc: { radius: 110, turn: -70 } },
  { straight: 120 },
  // 中速の左
  { arc: { radius: 55, turn: 80 } },
  // バックストレート
  { straight: 420 },
  // 複合の右（2つの頂点）
  { arc: { radius: 40, turn: -80 } },
  { straight: 40 },
  { arc: { radius: 50, turn: -70 } },
  { straight: 200 },
  // 高速の左
  { arc: { radius: 200, turn: 60 } },
  { straight: 150 },
  { arc: { radius: 70, turn: -90 } },
  // 500m のストレートの先の右で、メインストレートに戻る
];

export const CIRCUIT_MAP = roadMap(
  'circuit-gp',
  'サーキット',
  { scenery: 'circuit', width: 14, runoff: 8, start: 200, closed: true, pieces: closeLoop(ROAD_ORIGIN, CIRCUIT_PIECES, 80, -1) },
  3,
);

/** 低速のコーナーが続く周回のテクニカルサーキット（約 2.4km）。クランク、ヘアピン、シケイン、180° 回り込むコーナー */
const TECHNICAL_PIECES: RoadPiece[] = [
  { straight: 260 },
  { arc: { radius: 30, turn: 90 } },
  { straight: 60 },
  // クランク
  { arc: { radius: 18, turn: -90 } },
  { arc: { radius: 18, turn: 90 } },
  { straight: 140 },
  // ヘアピン
  { arc: { radius: 16, turn: 175 } },
  { straight: 90 },
  // シケイン
  { arc: { radius: 22, turn: -60 } },
  { arc: { radius: 22, turn: 60 } },
  { straight: 70 },
  // 180° 回り込む右
  { arc: { radius: 35, turn: -180 } },
  { straight: 60 },
  { arc: { radius: 25, turn: 110 } },
  { straight: 150 },
  { arc: { radius: 20, turn: -120 } },
  { arc: { radius: 45, turn: 50 } },
  { straight: 80 },
  { arc: { radius: 25, turn: 100 } },
  { straight: 90 },
  // シケイン
  { arc: { radius: 20, turn: -75 } },
  { arc: { radius: 20, turn: 75 } },
  { straight: 40 },
];

export const TECHNICAL_MAP = roadMap(
  'technical-circuit',
  'テクニカルサーキット',
  { scenery: 'circuit', width: 12, runoff: 5, start: 150, closed: true, pieces: closeLoop(ROAD_ORIGIN, TECHNICAL_PIECES, 35, 1) },
  2,
);

/**
 * 峠（約 2km・高低差 150m）。ふもとから頂上まで、半径の大きな高速コーナー、S 字、低速のヘアピンが
 * 混じる。下りは同じ道を頂上から
 */
const PASS_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 150 },
    { arc: { radius: 120, turn: 35 } },
    { straight: 100 },
    { arc: { radius: 40, turn: -80 } },
    { straight: 60 },
    // ヘアピン
    { arc: { radius: 18, turn: 170 }, h: 30 },
    { straight: 120 },
    { arc: { radius: 80, turn: -60 } },
    { arc: { radius: 80, turn: 45 } },
    { straight: 90 },
    { arc: { radius: 22, turn: -165 } },
    { straight: 80, h: 70 },
    // 高速コーナー
    { arc: { radius: 150, turn: 40 } },
    { straight: 150 },
    { arc: { radius: 35, turn: 95 } },
    { arc: { radius: 45, turn: -110 } },
    { straight: 70 },
    { arc: { radius: 20, turn: 175 }, h: 110 },
    { straight: 100 },
    { arc: { radius: 100, turn: -50 } },
    { arc: { radius: 60, turn: 70 } },
    { straight: 170, h: 150 },
  ],
};

export const HILLCLIMB_MAP = roadMap('pass-up', '峠（ヒルクライム）', PASS_ROAD);
export const DOWNHILL_MAP = roadMap('pass-down', '峠（ダウンヒル）', reverseRoad(PASS_ROAD, 60));

/** 上って峠を越え、反対側へ下る（約 2.1km）。頂上の前後で上りと下りが入れ替わる */
export const PASS_OVER_MAP = roadMap('pass-over-r', '峠（山越え）', {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 120 },
    { arc: { radius: 60, turn: 70 } },
    { straight: 80 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 100 },
    { arc: { radius: 90, turn: 60 } },
    { arc: { radius: 30, turn: -90 }, h: 60 },
    { straight: 140 },
    { arc: { radius: 20, turn: 170 } },
    { straight: 90, h: 95 },
    // 頂上: 見通しのよい高速の左右
    { arc: { radius: 160, turn: -35 }, h: 105 },
    { arc: { radius: 160, turn: 35 } },
    { straight: 100, h: 100 },
    // 下り
    { arc: { radius: 35, turn: 120 } },
    { straight: 120 },
    { arc: { radius: 22, turn: -160 } },
    { straight: 80, h: 60 },
    { arc: { radius: 70, turn: 80 } },
    { arc: { radius: 45, turn: -100 } },
    { straight: 150 },
    { arc: { radius: 120, turn: 50 } },
    { straight: 160, h: 15 },
  ],
});

/** 上りと下りを何度もくり返す、全長 2.9km ほどの長い峠 */
export const LONG_MAP = roadMap('long-r', '峠（ロング）', {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 140 },
    { arc: { radius: 100, turn: -45 } },
    { straight: 90 },
    { arc: { radius: 30, turn: 120 } },
    { straight: 70 },
    { arc: { radius: 45, turn: -90 }, h: 40 },
    { straight: 160 },
    { arc: { radius: 200, turn: 40 } },
    { straight: 120, h: 55 },
    { arc: { radius: 20, turn: 170 } },
    { straight: 110 },
    { arc: { radius: 50, turn: -70 }, h: 25 },
    { straight: 140 },
    { arc: { radius: 35, turn: -110 } },
    { straight: 80 },
    { arc: { radius: 70, turn: 90 }, h: 70 },
    { straight: 120 },
    { arc: { radius: 25, turn: -165 } },
    { straight: 100, h: 95 },
    { arc: { radius: 130, turn: 50 } },
    { straight: 200, h: 70 },
    { arc: { radius: 40, turn: 100 } },
    { arc: { radius: 40, turn: -100 } },
    { straight: 130 },
    { arc: { radius: 22, turn: 170 }, h: 110 },
    { straight: 120 },
    { arc: { radius: 90, turn: -60 } },
    { straight: 150, h: 125 },
  ],
});

/**
 * 峠の途中に、まっすぐな 800m のロングストレートと、ごく僅かに左右へくねる 650m のロングストレートがある
 * （約 2.9km・高低差 170m）。ストレートの前後と間は、ふつうの峠のコーナーが続く
 */
const STRAIGHT_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 100 },
    { arc: { radius: 35, turn: 90 } },
    { straight: 60 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 80 },
    { arc: { radius: 60, turn: 60 }, h: 25 },
    // まっすぐなロングストレート
    { straight: 800, h: 75 },
    // 間の峠のコーナー
    { arc: { radius: 30, turn: 120 } },
    { straight: 70 },
    { arc: { radius: 20, turn: -170 } },
    { straight: 90 },
    { arc: { radius: 80, turn: 70 } },
    { arc: { radius: 40, turn: -100 }, h: 100 },
    { straight: 60 },
    // ごく僅かに左右へくねるロングストレート
    ...wiggle(12, 450, 7),
    { straight: 60, h: 140 },
    // ふつうの峠のコーナー
    { arc: { radius: 35, turn: 110 } },
    { straight: 80 },
    { arc: { radius: 22, turn: -160 } },
    { straight: 90 },
    { arc: { radius: 100, turn: 45 } },
    { straight: 150, h: 170 },
  ],
};

export const STRAIGHT_UP_MAP = roadMap('straight-up-r', 'ロングストレート（ヒルクライム）', STRAIGHT_ROAD);
export const STRAIGHT_DOWN_MAP = roadMap('straight-down-r', 'ロングストレート（ダウンヒル）', reverseRoad(STRAIGHT_ROAD, 60));

const UTURN_LAYOUT = [
  '....................',
  '....................',
  '...............RRR.T',
  'T............T.R.R..',
  '.........T..T..R.R..',
  '......T....T...R.R.T',
  '....T....T..RRRR.R..',
  '......T.....R....R..',
  '.T.....T....R.RRRR..',
  '.........RRRR.R.....',
  '.TT......R....R.....',
  'T........R.RRRR.....',
  '......RRRR.R...T....',
  '......R....R..T.....',
  '.T....R.RRRR........',
  '..RRRRR.R...........',
  '........R...T.......',
  '...RRRRRR...TT......',
  '....................',
  '....................',
];
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
const STEEP_LAYOUT = [
  '......T.T......',
  '......T........',
  'T...........R..',
  '............R..',
  '...RRRRRRR..R..',
  '...R.....R..R..',
  '...R.....RRRR..',
  '...RRRRRR......',
  '..T.....R......',
  'TT....RRR..T..T',
  '......R........',
  '......R......T.',
  '......RRRRR....',
  '..........R....',
  '..........R....',
  '.....RRR..R....',
  '.....R.R..R...T',
  '.....R.RRRR....',
  '.....R.........',
  '..RRRR..T....T.',
  'T..............',
  '...............',
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
const MARATHON_LAYOUT = [
  '......T............................',
  '....T.T....T.......................',
  '....TT.T......RRRRRRRR..T..........',
  '....T...RRRR..R......R.............',
  '........R..RRRR.....RR.............',
  '........R...........R.RRR......T...',
  'T..T....RR.RRRR.....R.R.R..........',
  '.T.....T.R.R..R.....R.R.R.RRRR.....',
  '.........R.R..R.....R.R.RRR..R....T',
  '......RRRR.R..R.....R.R......RRRR..',
  '..T...R....R..R.T..RR.RRRRRR....R..',
  '......R....R..R....R.......RRR..R..',
  '..RRRRR....R..R....RRRR......R..R..',
  '..R.....RRRR..RR......RRRRRRRR..R..',
  '..R.....R......R...............RR..',
  '..RRR...R......R.....T.........R..T',
  'T...R.T.R...RRRR.........T.....R...',
  '....R...RRR.R....RRRRR.........R..T',
  'T...R.....R.R........R....RRRRRR...',
  '....RRRRRRR.RRRR...T.R....R........',
  '...............R.....R....R........',
  'T..........RRRRR.RRRRR....R.....T..',
  '...........R.....R........R....T...',
  '.T.........R...RRR........R......T.',
  '....T......R...R....RRRRRRR........',
  '...........R.T.R...............T...',
  '...........R...RRRR................',
  '..T.......RR......R................',
  '.....RRRRRR.RRRRRRR..T...T....T....',
  '.....R......R.........TT.......T...',
  '.....R..RRRRR........T.............',
  '.....R..R...........T..............',
  '.....RRRR....T......T..............',
  '.T.T...........................T...',
  '..............T...........T..T.....',
];


/** 谷沿いに上り、頂上のヘアピンで折り返して隣の道を下る。ゴールはスタートのすぐそば */
export const UTURN_MAP: MapDefinition = {
  id: 'uturn',
  name: '峠（Uターン）',
  tileSize: 30,
  roadWidth: 11,
  layout: UTURN_LAYOUT,
  start: { col: 4, row: 15, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: { from: { col: 2, row: 15 }, rise: 85, profile: [0, 0.55, 1, 0.55, 0] },
};

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

const STEEP_ELEVATION = { from: { col: 2, row: 19 }, rise: 230 };

/** 急な坂を上る。パワーのない車は坂の途中で伸びなくなる */
export const STEEP_UP_MAP: MapDefinition = {
  id: 'steep-up',
  name: '激坂（ヒルクライム）',
  tileSize: 26,
  roadWidth: 10,
  layout: STEEP_LAYOUT,
  start: { col: 4, row: 19, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: STEEP_ELEVATION,
};

/** 同じ激坂を下る。ブレーキを早めに踏まないとコーナーで止まりきれない */
export const STEEP_DOWN_MAP: MapDefinition = {
  id: 'steep-down',
  name: '激坂（ダウンヒル）',
  tileSize: 26,
  roadWidth: 10,
  layout: STEEP_LAYOUT,
  start: { col: 12, row: 4, heading: 'S' },
  guardrails: true,
  race: { laps: 1 },
  elevation: STEEP_ELEVATION,
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

/** 上りと下りを何度もくり返す、全長 6km を超える峠 */
export const MARATHON_MAP: MapDefinition = {
  id: 'marathon',
  name: '峠（超ロング）',
  tileSize: 30,
  roadWidth: 11,
  layout: MARATHON_LAYOUT,
  start: { col: 19, row: 17, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: { from: { col: 17, row: 17 }, rise: 200, profile: [0, 0.3, 0.15, 0.45, 0.35, 0.7, 0.5, 0.85, 1, 0.75, 0.55, 0.3, 0.1] },
};





/**
 * 首都高のような高架の周回コース（オリジナル・約 5.9km）。中心線で描く道路（src/map/road.ts）なので、
 * カーブはなめらかな円で、道路が自分の上を越える立体交差がある。
 *
 * 湾岸線のような 1.3km のロングストレートの先で、左に 540° 回りながら上る二重のループ（下の輪の真上を
 * 上の輪が通る）、海を渡る吊り橋（レインボーブリッジ）、都心環状線のような曲がりくねった区間、
 * 405° 回って自分の上を越えていくループ、215° 曲がり続ける大きなカーブを通ってロングストレートに戻る。
 * 道路の両側は壁で、3車線
 */
export const SHUTOKO_MAP: MapDefinition = {
  id: 'shutoko-loop',
  name: '首都高（湾岸線・ループ）',
  tileSize: 20,
  roadWidth: 11,
  layout: [],
  start: { col: 0, row: 0, heading: 'E' },
  race: { laps: 1 },
  road: {
    scenery: 'highway',
    highway: { ground: -14, lanes: 3 },
    width: 11,
    start: 100,
    closed: true,
    pieces: [
      // 湾岸線のロングストレート
      { straight: 1300 },
      { arc: { radius: 500, turn: -20 } },
      { straight: 200, h: 0 },
      // 左に 540° 回りながら上る二重のループ
      { arc: { radius: 55, turn: 540 }, width: 10, h: 16 },
      { straight: 250, h: 22 },
      // レインボーブリッジ
      { straight: 120, h: 24 },
      { straight: 620, suspension: true, h: 26 },
      { straight: 150, h: 16 },
      // 都心環状線のような曲がりくねった区間
      { arc: { radius: 60, turn: 70 }, width: 9 },
      { straight: 120, width: 9 },
      { arc: { radius: 45, turn: -90 }, width: 9 },
      { straight: 80, width: 9 },
      { arc: { radius: 70, turn: 80 }, width: 9 },
      { arc: { radius: 50, turn: -60 }, width: 9, h: 6 },
      { straight: 150, width: 9, h: 6 },
      // 405° 回って、自分の上を越えていくループ
      { arc: { radius: 45, turn: 405 }, width: 9, h: 18 },
      { straight: 200, width: 10, h: 8 },
      { arc: { radius: 90, turn: -60 } },
      // 215° 曲がり続けて、ロングストレートに戻る（周回が閉じるよう長さを合わせてある）
      { straight: 119.5019 },
      { arc: { radius: 200, turn: 215 } },
      { straight: 441.0961, h: 0 },
    ],
    // 東京湾（北側）と、吊り橋の下の運河
    sea: [
      [-900, -1400, 2100, -470],
      [880, -470, 1500, -45],
    ],
  },
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

/** 橋とトンネルの峠を下る */
export const VALLEY_DOWN_MAP: MapDefinition = {
  id: 'valley-down',
  name: '橋とトンネルの峠（ダウンヒル）',
  tileSize: 30,
  roadWidth: 11,
  layout: VALLEY_LAYOUT,
  start: { col: 51, row: 1, heading: 'W' },
  guardrails: true,
  race: { laps: 1 },
  elevation: VALLEY_ELEVATION,
};

/**
 * 八方ヶ原のような、4 つの区間に分かれた峠の往復（オリジナル・道路 3.3km、往復 6.4km）。中心線で描く道路
 * （src/map/road.ts）。ふもとからスタートし、頂上の広場で U ターンして、同じ道を戻ってきたらゴール。
 *
 * - 第1セクション: 道幅の狭い古い道。木が道路のすぐ脇まで茂り、コーナーの先が見えない
 * - 第2セクション: 拡幅工事を終えた広くきれいな道。ただし路面は荒れていて、細かく波打って車が跳ねる
 * - ハイポイントコーナーを過ぎた第3セクション: きついダウンヒル。その先で高さ 55m の谷に架かる大きな橋を渡る
 * - 第4セクション: きついヒルクライム（道幅 10m で追い抜きやすい）。330° 回り込むループ橋（自分の下をくぐってきた道の上を越える）、
 *   カーブの途中にある 240m のトンネルを抜け、さらに上って頂上の広場へ
 */
export const HAPPOGAHARA_MAP: MapDefinition = {
  id: 'happogahara',
  name: '八方ヶ原風の峠（往復）',
  tileSize: 20,
  roadWidth: 10,
  layout: [],
  start: { col: 0, row: 0, heading: 'E' },
  race: { laps: 1 },
  road: {
    scenery: 'touge',
    width: 8,
    start: 150,
    turnaround: { radius: 11 },
    pieces: [
      // 第1セクション: 狭く見通しの悪い古い道
      { straight: 200, width: 6.2, surface: 'old' },
      { arc: { radius: 40, turn: 70 }, width: 6.2, surface: 'old' },
      { straight: 40, width: 6.2, surface: 'old' },
      { arc: { radius: 30, turn: -95 }, width: 6.2, surface: 'old' },
      { straight: 30, width: 6.2, surface: 'old' },
      { arc: { radius: 55, turn: 60 }, width: 6.2, surface: 'old' },
      { arc: { radius: 35, turn: -80 }, width: 6.2, surface: 'old' },
      { straight: 50, width: 6.2, surface: 'old' },
      { arc: { radius: 28, turn: 110 }, width: 6.2, surface: 'old' },
      { straight: 35, width: 6.2, surface: 'old' },
      { arc: { radius: 45, turn: -70 }, width: 6.2, surface: 'old' },
      { straight: 60, width: 6.2, surface: 'old' },
      { arc: { radius: 32, turn: -60 }, width: 6.2, surface: 'old' },
      { arc: { radius: 60, turn: 85 }, width: 6.2, surface: 'old', h: 30 },
      // 第2セクション: 拡幅済みの広い新しい舗装。路面は荒れている
      { straight: 120, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 110, turn: -45 }, width: 10, surface: 'new', bumpy: true },
      { straight: 80, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 90, turn: 50 }, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 130, turn: -35 }, width: 10, surface: 'new', bumpy: true },
      { straight: 100, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 75, turn: 60 }, width: 10, surface: 'new', bumpy: true },
      { straight: 60, width: 10, surface: 'new', bumpy: true, h: 64 },
      // ハイポイントコーナー（いちばん高い所）
      { arc: { radius: 42, turn: -95 }, width: 10, surface: 'new', h: 70 },
      // 第3セクション: きついダウンヒル
      { straight: 60 },
      { arc: { radius: 35, turn: 120 } },
      { straight: 50 },
      { arc: { radius: 26, turn: -150 } },
      { straight: 60 },
      { arc: { radius: 40, turn: 110 } },
      { straight: 40 },
      { arc: { radius: 45, turn: -80 } },
      { straight: 50, h: 4 },
      // 谷に架かる高い橋
      { straight: 240, bridge: true, valley: 55, h: 0, width: 9 },
      // 第4セクション: きついヒルクライム
      { straight: 70, width: 10 },
      { arc: { radius: 60, turn: -40 }, width: 10 },
      { straight: 50, h: 10, width: 10 },
      // 330° 回り込むループ橋（くぐってきた道の上を越える）
      { arc: { radius: 22, turn: -330 }, bridge: true, width: 10 },
      { straight: 40, bridge: true, width: 10 },
      { straight: 20, h: 32, width: 10 },
      // カーブの途中のトンネル
      { arc: { radius: 80, turn: 110 }, tunnel: true, width: 10 },
      { straight: 90, tunnel: true, width: 10 },
      { arc: { radius: 45, turn: -70 }, width: 10 },
      { straight: 60, width: 10 },
      { arc: { radius: 35, turn: 90 }, width: 10 },
      { straight: 50, width: 10 },
      { arc: { radius: 50, turn: -60 }, width: 10 },
      { straight: 60, h: 95, width: 10 },
    ],
  },
};

export const MAPS: readonly MapDefinition[] = [
  TOWN_MAP,
  SCHOOL_MAP,
  CIRCUIT_MAP,
  TECHNICAL_MAP,
  SHUTOKO_MAP,
  HILLCLIMB_MAP,
  DOWNHILL_MAP,
  PASS_OVER_MAP,
  UTURN_MAP,
  HAIRPIN_MAP,
  HAIRPIN_DOWN_MAP,
  STEEP_UP_MAP,
  STEEP_DOWN_MAP,
  LONG_MAP,
  MARATHON_MAP,
  STRAIGHT_UP_MAP,
  STRAIGHT_DOWN_MAP,
  VALLEY_UP_MAP,
  VALLEY_DOWN_MAP,
  HAPPOGAHARA_MAP,
];
