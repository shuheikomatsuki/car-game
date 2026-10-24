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

/**
 * 道路の左（side = 1）か右（side = -1）に offset [m] 離れて並ぶ道を、逆向きに走る区間（U ターンの帰り道）。
 * 内側になるカーブは半径が offset だけ小さく、外側になるカーブは大きくなる。高さは行きと同じ所で同じ
 */
function alongside(pieces: readonly RoadPiece[], offset: number, side: 1 | -1): RoadPiece[] {
  return pieces.map((_, j) => {
    const i = pieces.length - 1 - j;
    const p = pieces[i];
    const piece: RoadPiece = p.arc
      ? { arc: { radius: p.arc.radius - Math.sign(p.arc.turn) * side * offset, turn: -p.arc.turn } }
      : { straight: p.straight };
    // 逆向きの区間の終わり = 行きの区間の始まり
    const h = i === 0 ? 0 : pieces[i - 1].h;
    if (h !== undefined) piece.h = h;
    return piece;
  });
}

/** U ターンの峠の行き（谷沿いに上る） */
const UTURN_OUT: RoadPiece[] = [
  { straight: 120, h: 0 },
  { arc: { radius: 80, turn: 50 } },
  { straight: 60 },
  { arc: { radius: 35, turn: -110 } },
  { straight: 70 },
  { arc: { radius: 65, turn: 90 }, h: 40 },
  { straight: 80 },
  { arc: { radius: 30, turn: -120 } },
  { straight: 60 },
  { arc: { radius: 90, turn: 70 }, h: 65 },
  { straight: 100 },
  { arc: { radius: 40, turn: -80 } },
  { straight: 60, h: 85 },
];

/**
 * 谷沿いに上り、頂上のヘアピンで折り返して、すぐ隣（38m 横）を並んで下る（約 2.1km）。ゴールはスタートのすぐそば。
 * 行きの高速コーナーは帰りの低速コーナーに、行きの低速コーナーは帰りの高速コーナーになる
 */
export const UTURN_MAP = roadMap('uturn', '峠（Uターン）', {
  scenery: 'touge',
  width: 11,
  start: 60,
  pieces: [...UTURN_OUT, { arc: { radius: 19, turn: 180 }, h: 85 }, ...alongside(UTURN_OUT, 38, 1)],
});

/** つづら折りの直線の長さと、その先のヘアピンの半径（ヘアピンは左右交互） */
const HAIRPIN_LEGS: [number, number][] = [
  [140, 13],
  [125, 12],
  [130, 14],
  [115, 12],
  [120, 13],
  [105, 11],
  [110, 12],
  [95, 12],
  [100, 13],
  [85, 11],
  [90, 12],
  [80, 12],
];

/** 斜面をつづら折りで上る（約 2.1km・高低差 160m）。ヘアピンが 12 個続く */
const HAIRPIN_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 10,
  start: 60,
  pieces: [
    { straight: 80, h: 0 },
    { arc: { radius: 70, turn: -35 } },
    { straight: 50 },
    ...HAIRPIN_LEGS.flatMap(([leg, radius], i): RoadPiece[] => [{ straight: leg }, { arc: { radius, turn: i % 2 === 0 ? -180 : 180 } }]),
    { straight: 85 },
    { arc: { radius: 60, turn: 40 } },
    { straight: 80, h: 160 },
  ],
};

export const HAIRPIN_MAP = roadMap('hairpin', 'つづら折り（ヒルクライム）', HAIRPIN_ROAD);

/**
 * つづら折りを上から下る。ヘアピンの内側には段差のある近道の帯があり、
 * 内側の内側を攻める「地元走り」ができる（段差で少し宙に浮く。src/map/roadShortcuts.ts）
 */
export const HAIRPIN_DOWN_MAP: MapDefinition = { ...roadMap('hairpin-down', 'つづら折り（ダウンヒル）', reverseRoad(HAIRPIN_ROAD, 60)), shortcuts: true };

/** 急な坂の峠（約 1.4km・高低差 230m）。きついヘアピンが 3 つある */
const STEEP_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 11,
  start: 50,
  pieces: [
    { straight: 70, h: 0 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 70 },
    { arc: { radius: 18, turn: -170 } },
    { straight: 90 },
    { arc: { radius: 60, turn: 70 } },
    { arc: { radius: 35, turn: -80 } },
    { straight: 100 },
    { arc: { radius: 16, turn: 175 } },
    { straight: 80 },
    { arc: { radius: 50, turn: -60 } },
    { straight: 60 },
    { arc: { radius: 25, turn: -120 } },
    { straight: 90 },
    { arc: { radius: 80, turn: 50 } },
    { straight: 70 },
    { arc: { radius: 20, turn: 170 } },
    { straight: 100 },
    { arc: { radius: 45, turn: -90 } },
    { straight: 80, h: 230 },
  ],
};

/** 急な坂を上る。パワーのない車は坂の途中で伸びなくなる */
export const STEEP_UP_MAP = roadMap('steep-up', '激坂（ヒルクライム）', STEEP_ROAD);
/** 同じ激坂を下る。ブレーキを早めに踏まないとコーナーで止まりきれない */
export const STEEP_DOWN_MAP = roadMap('steep-down', '激坂（ダウンヒル）', reverseRoad(STEEP_ROAD, 50));

/** 上りと下りを何度もくり返す、全長 6km を超える峠 */
export const MARATHON_MAP = roadMap('marathon', '峠（超ロング）', {
  scenery: 'touge',
  width: 11,
  start: 60,
  pieces: [
    { straight: 150, h: 0 },
    { arc: { radius: 60, turn: 70 } },
    { straight: 90 },
    { arc: { radius: 30, turn: -120 } },
    { straight: 80 },
    { arc: { radius: 90, turn: 60 } },
    { straight: 120, h: 60 },
    { arc: { radius: 22, turn: -170 } },
    { straight: 100 },
    { arc: { radius: 45, turn: 110 } },
    { straight: 70 },
    { arc: { radius: 120, turn: 40 }, h: 30 },
    { straight: 150 },
    { arc: { radius: 35, turn: -90 } },
    { straight: 80 },
    { arc: { radius: 70, turn: 80 } },
    { straight: 60 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 110, h: 90 },
    { arc: { radius: 55, turn: 100 } },
    { straight: 90 },
    { arc: { radius: 160, turn: -30 } },
    { straight: 200, h: 85 },
    { arc: { radius: 28, turn: 140 } },
    { straight: 80 },
    { arc: { radius: 40, turn: -110 } },
    { straight: 70 },
    { arc: { radius: 80, turn: 60 } },
    { straight: 130, h: 140 },
    { arc: { radius: 20, turn: -170 } },
    { straight: 90 },
    { arc: { radius: 50, turn: 90 } },
    { straight: 100, h: 115 },
    { arc: { radius: 35, turn: -100 } },
    { straight: 80 },
    { arc: { radius: 100, turn: 60 } },
    { straight: 140 },
    { arc: { radius: 24, turn: 160 }, h: 170 },
    { straight: 100 },
    { arc: { radius: 60, turn: -80 } },
    { straight: 70 },
    { arc: { radius: 30, turn: 120 }, h: 200 },
    { straight: 120 },
    { arc: { radius: 45, turn: -90 } },
    { straight: 90, h: 175 },
    { arc: { radius: 130, turn: 50 } },
    { straight: 110 },
    { arc: { radius: 26, turn: -150 } },
    { straight: 90, h: 140 },
    { arc: { radius: 70, turn: 90 } },
    { straight: 80 },
    { arc: { radius: 38, turn: -100 } },
    { straight: 120, h: 100 },
    { arc: { radius: 90, turn: -60 } },
    { straight: 100 },
    { arc: { radius: 22, turn: 165 } },
    { straight: 150, h: 60 },
    { arc: { radius: 50, turn: -90 } },
    { straight: 100 },
    { arc: { radius: 30, turn: 130 } },
    { straight: 90 },
    { arc: { radius: 80, turn: -60 }, h: 80 },
    { straight: 120 },
    { arc: { radius: 24, turn: -160 } },
    { straight: 110 },
    { arc: { radius: 60, turn: 90 } },
    { straight: 130, h: 30 },
  ],
});

/** 首都高の最後: 215° ほど曲がり続ける大きなカーブでロングストレートに戻る（周回が閉じる長さを計算する） */
function closeShutoko(pieces: RoadPiece[]): RoadPiece[] {
  const out = closeLoop(ROAD_ORIGIN, pieces, 200, 1);
  out[out.length - 1] = { ...out[out.length - 1], h: 0 };
  return out;
}

/**
 * 首都高のような高架の周回コース（オリジナル・約 5.9km）。中心線で描く道路（src/map/road.ts）なので、
 * カーブはなめらかな円で、道路が自分の上を越える立体交差がある。
 *
 * 湾岸線のような 1.3km のロングストレートの先で、左に 540° 回りながら上る二重のループ（下の輪の真上を
 * 上の輪が通る）、海を渡る吊り橋（レインボーブリッジ）、都心環状線のような曲がりくねった区間、
 * 405° 回って自分の上を越えていくループ、200° あまり曲がり続ける大きなカーブを通ってロングストレートに戻る。
 * 道路の両側は壁で、3車線
 */
export const SHUTOKO_MAP: MapDefinition = {
  // 形を変えたので id も変えた（前の形のタイム・ゴーストと混ざらないように）
  id: 'shutoko-loop-2',
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
    pieces: closeShutoko([
      // 湾岸線のロングストレート
      { straight: 1300 },
      { arc: { radius: 500, turn: -20 } },
      { straight: 200, h: 0 },
      // 左に 540° 回りながら上る二重のループ
      { arc: { radius: 65, turn: 540 }, width: 10, h: 16 },
      { straight: 250, h: 22 },
      // レインボーブリッジ
      { straight: 120, h: 24 },
      { straight: 620, suspension: true, h: 26 },
      { straight: 150, h: 16 },
      // 都心環状線のような曲がりくねった区間（百数十キロで曲がれるくらいの半径）
      { arc: { radius: 90, turn: 70 }, width: 9 },
      { straight: 100, width: 9 },
      { arc: { radius: 80, turn: -90 }, width: 9 },
      { straight: 60, width: 9 },
      { arc: { radius: 100, turn: 80 }, width: 9 },
      { arc: { radius: 80, turn: -60 }, width: 9, h: 6 },
      { straight: 150, width: 9, h: 6 },
      // 405° 回って、自分の上を越えていくループ
      { arc: { radius: 60, turn: 405 }, width: 9, h: 18 },
      { straight: 200, width: 10, h: 8 },
      { arc: { radius: 90, turn: -60 } },
    ]),
    // 東京湾（北側）と、吊り橋の下の運河
    sea: [
      [-900, -1400, 2100, -470],
      [880, -470, 1500, -45],
    ],
  },
};

/**
 * 谷を橋で渡り、山をトンネルで抜ける 5km ほどの峠（高低差 230m）。橋は 3 か所（コーナーの続く区間の途中）、
 * トンネルは短いもの（90m）と長いもの（360m）が 1 本ずつ
 */
const VALLEY_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 11,
  start: 60,
  pieces: [
    { straight: 120, h: 0 },
    { arc: { radius: 50, turn: 70 } },
    { straight: 60 },
    { arc: { radius: 30, turn: -110 } },
    { straight: 60 },
    { straight: 150, bridge: true, valley: 35 },
    { straight: 40 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 70 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 80 },
    { straight: 90, tunnel: true },
    { arc: { radius: 70, turn: 60 } },
    { straight: 100, h: 50 },
    { arc: { radius: 35, turn: -100 } },
    { straight: 60 },
    { arc: { radius: 60, turn: 80 } },
    { straight: 50 },
    { arc: { radius: 28, turn: -130 } },
    { straight: 60 },
    { straight: 180, bridge: true, valley: 45 },
    { straight: 40 },
    { arc: { radius: 45, turn: 100 } },
    { straight: 80 },
    { arc: { radius: 22, turn: -160 }, h: 95 },
    { straight: 90 },
    { arc: { radius: 80, turn: 50 } },
    { straight: 120 },
    { arc: { radius: 150, turn: -60 }, tunnel: true },
    { straight: 200, tunnel: true, h: 130 },
    { straight: 60 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 70 },
    { arc: { radius: 30, turn: -120 } },
    { straight: 50 },
    { straight: 160, bridge: true, valley: 40 },
    { straight: 40 },
    { arc: { radius: 55, turn: 80 } },
    { straight: 90 },
    { arc: { radius: 24, turn: -150 }, h: 165 },
    { straight: 100 },
    { arc: { radius: 100, turn: 40 } },
    { straight: 80 },
    { arc: { radius: 35, turn: -100 } },
    { straight: 120, h: 190 },
    { arc: { radius: 60, turn: 90 } },
    { straight: 100 },
    { arc: { radius: 35, turn: -80 } },
    { straight: 70 },
    { arc: { radius: 45, turn: 80 } },
    { straight: 130 },
    { arc: { radius: 30, turn: -110 } },
    { straight: 90 },
    { arc: { radius: 80, turn: 60 } },
    { straight: 120 },
    { arc: { radius: 26, turn: -150 } },
    { straight: 120, h: 230 },
  ],
};

/** 橋とトンネルの峠を上る */
export const VALLEY_UP_MAP = roadMap('valley-up', '橋とトンネルの峠（ヒルクライム）', VALLEY_ROAD);
/** 橋とトンネルの峠を下る */
export const VALLEY_DOWN_MAP = roadMap('valley-down', '橋とトンネルの峠（ダウンヒル）', reverseRoad(VALLEY_ROAD, 60));

/**
 * 八方ヶ原のような、4 つの区間に分かれた峠の往復（オリジナル・道路 3.5km、往復 6.8km）。中心線で描く道路
 * （src/map/road.ts）。ふもとからスタートし、頂上の広場で U ターンして、同じ道を戻ってきたらゴール。
 *
 * - 第1セクション: 道幅の狭い古い道。木が道路のすぐ脇まで茂り、コーナーの先が見えない
 * - 第2セクション: 拡幅工事を終えた新設の広い道。両側に新しいガードレール、削った斜面は吹き付けたばかりのコンクリート。
 *   ただし路面は荒れていて、細かく波打って車が跳ねる
 * - ハイポイントコーナーを過ぎた第3セクション: きついダウンヒル。その先で高さ 55m の谷に架かる大きな橋を渡る
 * - 第4セクション: きついヒルクライム（道幅 10m で追い抜きやすい）。330° 回り込むループ橋（自分の下をくぐってきた道の上を越える）、
 *   カーブの途中にある 240m のトンネルを抜け、さらに上り切った先の平らな道を 200m ほど走って頂上の広場へ
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
      // 頂上: 登り切った後、少し平らな道を走ってから U ターンの広場へ
      { straight: 50, h: 96, width: 10 },
      { arc: { radius: 160, turn: 25 }, width: 10 },
      { straight: 90, h: 96, width: 10 },
    ],
  },
};

/**
 * 秋名（榛名山）のダウンヒル（約 5km・高低差 330m）。頂上の旧料金所跡から、湖を背に伊香保側へ下る。
 * 実際の道の形のデータは使っておらず、原作・アニメ・アーケードで知られる区間の並びを再現している:
 *
 * - スタート直後: 緩い下りの直線から、中速の左右が続く
 * - 長い下りのストレートの先に、最初のヘアピン
 * - 中速〜低速の連続コーナー
 * - スケートセンター前のストレート（いちばん長い直線。パワーのある車はここで抜きにかかる）
 * - 5連続ヘアピン（左右交互）。どのヘアピンも内側の路肩に側溝があり、内側のタイヤを落とすと速く曲がれる（溝落とし）
 * - ヘアピンを抜けた後の中速区間と S 字、最後の直線でゴール
 */
export const AKINA_DOWN_MAP = roadMap('akina-down', '秋名（ダウンヒル）', {
  scenery: 'touge',
  width: 8,
  start: 40,
  pieces: [
    // スタート（旧料金所跡）: 緩い下り
    { straight: 200, h: 330 },
    { arc: { radius: 120, turn: -35 } },
    { straight: 120 },
    { arc: { radius: 70, turn: 60 } },
    { straight: 90 },
    { arc: { radius: 55, turn: -80 } },
    { straight: 150 },
    { arc: { radius: 150, turn: 40 } },
    // 長い下りのストレートの先の、最初のヘアピン
    { straight: 260 },
    { arc: { radius: 18, turn: -175 }, gutter: true },
    { straight: 110 },
    // 中速〜低速の連続コーナー
    { arc: { radius: 40, turn: 100 }, gutter: true },
    { straight: 80 },
    { arc: { radius: 30, turn: -120 }, gutter: true },
    { straight: 60 },
    { arc: { radius: 60, turn: 70 } },
    { straight: 70 },
    { arc: { radius: 25, turn: 140 }, gutter: true },
    { straight: 90 },
    { arc: { radius: 45, turn: -90 } },
    // スケートセンター前のストレート
    { straight: 450 },
    { arc: { radius: 220, turn: 20 } },
    { straight: 140 },
    // 5連続ヘアピン（左右交互・内側に側溝）
    { arc: { radius: 16, turn: -178 }, gutter: true },
    { straight: 70 },
    { arc: { radius: 15, turn: 178 }, gutter: true },
    { straight: 60 },
    { arc: { radius: 17, turn: -178 }, gutter: true },
    { straight: 65 },
    { arc: { radius: 15, turn: 178 }, gutter: true },
    { straight: 70 },
    { arc: { radius: 18, turn: -170 }, gutter: true },
    { straight: 120 },
    // ヘアピンを抜けた後の中速区間と S 字
    { arc: { radius: 80, turn: 60 } },
    { straight: 140 },
    { arc: { radius: 35, turn: -110 }, gutter: true },
    { straight: 100 },
    { arc: { radius: 50, turn: 80 } },
    { arc: { radius: 50, turn: -80 } },
    { straight: 120 },
    { arc: { radius: 28, turn: 130 }, gutter: true },
    { straight: 150 },
    { arc: { radius: 90, turn: -50 } },
    // 最後の直線でゴール
    { straight: 200, h: 0 },
  ],
});

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
  AKINA_DOWN_MAP,
];

/**
 * タイトル画面の後ろに映すコース: 練習用（街・教習所）とサーキットを除いた、峠・首都高。
 * 起動が遅くならないよう、作るのに特に時間のかかる長いコース（超ロング・八方ヶ原）も除く
 */
export const TITLE_MAPS: readonly MapDefinition[] = MAPS.filter(
  (m) => ![TOWN_MAP, SCHOOL_MAP, CIRCUIT_MAP, TECHNICAL_MAP, MARATHON_MAP, HAPPOGAHARA_MAP].includes(m),
);
