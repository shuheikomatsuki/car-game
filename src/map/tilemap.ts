/**
 * タイルベースのマップ定義と解析。
 *
 * マップは文字のグリッドで書く。1文字 = 1タイル（tileSize 四方）。
 * 道路のつながりは隣接する道路タイルから自動で決まるため、
 * 平行する道路の間には必ず1タイル以上の非道路タイルを挟むこと。
 *
 * 座標: 列(col) → +X、行(row) → +Z。タイル中心 = (col * tileSize, row * tileSize)。
 */

export type Direction = 'N' | 'E' | 'S' | 'W';

export const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

/** 方向ごとのグリッド上の移動量 */
export const DIR_OFFSET: Record<Direction, { dc: number; dr: number }> = {
  N: { dc: 0, dr: -1 },
  E: { dc: 1, dr: 0 },
  S: { dc: 0, dr: 1 },
  W: { dc: -1, dr: 0 },
};

/** 方向のヨー角（前方 +Z を 0 とし、上から見て反時計回りが正） */
export const DIR_YAW: Record<Direction, number> = {
  S: 0,
  E: Math.PI / 2,
  N: Math.PI,
  W: -Math.PI / 2,
};

export type TileKind = 'grass' | 'road' | 'building' | 'tree';

export interface Tile {
  col: number;
  row: number;
  kind: TileKind;
  /** 道路タイルのみ: つながっている方向 */
  connections: Direction[];
  /** 道路上に置くコーンの有無 */
  cones: boolean;
}

export type SignType = 'stop' | 'speed30' | 'speed40';

/** 道路標識。タイルの四隅のどこに立て、どの方向を向けるかで指定する */
export interface SignPlacement {
  col: number;
  row: number;
  type: SignType;
  corner: 'NE' | 'NW' | 'SE' | 'SW';
  /** 標識の面が向く方向（その方向から来る車に見える） */
  facing: Direction;
}

export interface MapDefinition {
  /**
   * 変わらない id（オンラインのランキングの区別に使う）。表示名 name は変えてもよいが、
   * id を変えるとそのコースのランキングは別のものになる
   */
  id: string;
  name: string;
  tileSize: number;
  /** 道路の幅 [m] */
  roadWidth: number;
  /**
   * 凡例:
   *   . 草地   R 道路   c 道路＋コーン
   *   B 建物   T 木
   */
  layout: string[];
  start: { col: number; row: number; heading: Direction };
  /** カーブの外側にガードレールを置くか */
  guardrails?: boolean;
  signs?: SignPlacement[];
  /**
   * レース用のコースなら、タイムアタックの周回数。スタート地点から一周をたどれる周回コースか、
   * 行き止まりで終わる一本道のコース（周回数は 1）にする
   */
  race?: { laps: number };
  /**
   * 高低差。道路の行き止まり from から、道路に沿って反対の端まで rise [m] 上る。
   * profile を書くと、上ってから下るなどの形にできる（from から反対の端までの等間隔の点の高さ。rise に対する割合）
   */
  elevation?: { from: { col: number; row: number }; rise: number; profile?: readonly number[] };
}

export interface ParsedMap {
  def: MapDefinition;
  cols: number;
  rows: number;
  tiles: Tile[];
  tileAt(col: number, row: number): Tile | undefined;
}

const KIND_BY_CHAR: Record<string, { kind: TileKind; cones?: boolean }> = {
  '.': { kind: 'grass' },
  R: { kind: 'road' },
  c: { kind: 'road', cones: true },
  B: { kind: 'building' },
  T: { kind: 'tree' },
};

export function parseMap(def: MapDefinition): ParsedMap {
  const rows = def.layout.length;
  const cols = Math.max(...def.layout.map((line) => line.length));
  const grid: Tile[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: Tile[] = [];
    for (let col = 0; col < cols; col++) {
      const ch = def.layout[row][col] ?? '.';
      const entry = KIND_BY_CHAR[ch];
      if (!entry) throw new Error(`Unknown map char '${ch}' at (${col}, ${row})`);
      line.push({ col, row, kind: entry.kind, connections: [], cones: entry.cones ?? false });
    }
    grid.push(line);
  }

  const tileAt = (col: number, row: number) => grid[row]?.[col];

  for (const line of grid) {
    for (const tile of line) {
      if (tile.kind !== 'road') continue;
      tile.connections = DIRECTIONS.filter((d) => {
        const { dc, dr } = DIR_OFFSET[d];
        return tileAt(tile.col + dc, tile.row + dr)?.kind === 'road';
      });
    }
  }

  for (const sign of def.signs ?? []) {
    if (!tileAt(sign.col, sign.row)) {
      throw new Error(`Sign at (${sign.col}, ${sign.row}) is outside the map`);
    }
  }

  const start = tileAt(def.start.col, def.start.row);
  if (start?.kind !== 'road') {
    throw new Error(`Start position (${def.start.col}, ${def.start.row}) is not on a road`);
  }

  return { def, cols, rows, tiles: grid.flat(), tileAt };
}

export type RoadShape = 'deadEnd' | 'straight' | 'curve' | 'tJunction' | 'crossroads' | 'isolated';

export function roadShape(tile: Tile): RoadShape {
  const c = tile.connections;
  switch (c.length) {
    case 0:
      return 'isolated';
    case 1:
      return 'deadEnd';
    case 2: {
      const opposite =
        (c.includes('N') && c.includes('S')) || (c.includes('E') && c.includes('W'));
      return opposite ? 'straight' : 'curve';
    }
    case 3:
      return 'tJunction';
    default:
      return 'crossroads';
  }
}

export function tileCenter(map: ParsedMap, col: number, row: number): { x: number; z: number } {
  return { x: col * map.def.tileSize, z: row * map.def.tileSize };
}
