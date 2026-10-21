import {
  DIR_OFFSET,
  type Direction,
  type ParsedMap,
  type Tile,
  tileCenter,
} from '../map/tilemap';

/**
 * キャラクター運転用の経路計画。
 * 道路タイルを「入ってきた方向 → 出ていく方向」で区切り、左側通行の走行ライン（点列）をつなげて経路にする。
 * 交差点でどちらへ行くかは、指示（次を右／左）があればそれに従い、無ければ直進する。
 * 直進できない交差点で指示が無ければ、その手前で経路が途切れる（＝止まって聞く）。
 */

export type Turn = 'left' | 'right' | 'straight';

export interface Point {
  x: number;
  z: number;
}

/** 進行方向のベクトル（x: 東, z: 南） */
export function dirVector(d: Direction): Point {
  const { dc, dr } = DIR_OFFSET[d];
  return { x: dc, z: dr };
}

export function opposite(d: Direction): Direction {
  return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[d];
}

/** 進行方向 d から見て左の方向 */
export function leftOf(d: Direction): Direction {
  return ({ N: 'W', W: 'S', S: 'E', E: 'N' } as const)[d];
}

export function rightOf(d: Direction): Direction {
  return opposite(leftOf(d));
}

export function turnBetween(din: Direction, dout: Direction): Turn | 'uturn' {
  if (din === dout) return 'straight';
  if (dout === leftOf(din)) return 'left';
  if (dout === rightOf(din)) return 'right';
  return 'uturn';
}

export function applyTurn(din: Direction, turn: Turn): Direction {
  return turn === 'straight' ? din : turn === 'left' ? leftOf(din) : rightOf(din);
}

/** そのタイルに din 方向で入ったときに選べる出口（Uターンは除く） */
export function exitOptions(tile: Tile, din: Direction): Direction[] {
  return tile.connections.filter((d) => d !== opposite(din));
}

/** タイル1枚分の走行ライン。左側通行なので進行方向の左へ laneOffset ずらす */
export function lanePoints(
  map: ParsedMap,
  col: number,
  row: number,
  din: Direction,
  dout: Direction,
  laneOffset: number,
): Point[] {
  const half = map.def.tileSize / 2;
  const c = tileCenter(map, col, row);
  const vi = dirVector(din);
  const vo = dirVector(dout);
  const li = dirVector(leftOf(din));
  const lo = dirVector(leftOf(dout));
  const p0 = { x: c.x - vi.x * half + li.x * laneOffset, z: c.z - vi.z * half + li.z * laneOffset };
  const p2 = { x: c.x + vo.x * half + lo.x * laneOffset, z: c.z + vo.z * half + lo.z * laneOffset };

  if (din === dout) {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => ({
      x: p0.x + ((p2.x - p0.x) * i) / n,
      z: p0.z + ((p2.z - p0.z) * i) / n,
    }));
  }

  // 曲がる場合: 入口の車線と出口の車線の交点を制御点にした2次ベジェ曲線
  const p1 = vi.x !== 0 ? { x: p2.x, z: p0.z } : { x: p0.x, z: p2.z };
  const n = 10;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    return { x: a * p0.x + b * p1.x + d * p2.x, z: a * p0.z + b * p1.z + d * p2.z };
  });
}

export interface Segment {
  col: number;
  row: number;
  din: Direction;
  dout: Direction;
  /** 交差点（出口が複数）で方向を選んだ区間 */
  junction: boolean;
  /** 性格による間違いで、意図と違う方向を選んだ */
  mistaken: boolean;
  /** 曲がる区間の推奨最高速度 [m/s]（直進なら Infinity） */
  speedLimit: number;
  points: Point[];
}

export type PlannerEvent =
  | { type: 'askDirection' }
  | { type: 'enterJunction'; turn: Turn; mistaken: boolean }
  | { type: 'pendingUsed'; turn: Turn };

/**
 * 交差点で方向を決めるときのフック（キャラクターの性格で間違えさせる）。
 * intended は本来選ぶ方向、options は選べる方向。戻り値が実際に進む方向。
 */
export type ExitChooser = (intended: Direction, options: Direction[], din: Direction) => Direction;

export interface PlannerOptions {
  laneOffset?: number;
  /** 曲がるときの横加速度の目安 [m/s^2] */
  turnLateralAccel?: number;
  chooseExit?: ExitChooser;
}

export class RoutePlanner {
  readonly laneOffset: number;
  private readonly turnLateralAccel: number;
  private readonly chooseExit: ExitChooser;
  private segments: Segment[] = [];
  /** 経路の点列（全区間をつないだもの）と、各点までの距離 */
  private points: Point[] = [];
  private cumulative: number[] = [];
  private pointLimits: number[] = [];
  /** 各区間の先頭の点の番号（区間の境目の点は前の区間の終点と共有） */
  private segStarts: number[] = [];
  private s = 0;
  private currentIndex = 0;
  private pending: Turn | null = null;
  /** 訂正で取り消した方向。次の交差点ではこの方向を避ける */
  private avoid: Direction | null = null;
  private waiting = false;
  private readonly events: PlannerEvent[] = [];

  constructor(
    private readonly map: ParsedMap,
    options: PlannerOptions = {},
  ) {
    this.laneOffset = options.laneOffset ?? 3;
    this.turnLateralAccel = options.turnLateralAccel ?? 2.6;
    this.chooseExit = options.chooseExit ?? ((intended) => intended);
  }

  /** 次の交差点で曲がる方向（指示済みでまだ使われていないもの） */
  get pendingTurn(): Turn | null {
    return this.pending;
  }

  /** 方向の指示待ちで経路が途切れている */
  get isWaitingForDirection(): boolean {
    return this.waiting;
  }

  /** 経路上の現在位置 [m] */
  get progress(): number {
    return this.s;
  }

  get segmentList(): readonly Segment[] {
    return this.segments;
  }

  /** 溜まったイベントを取り出す */
  drainEvents(): PlannerEvent[] {
    return this.events.splice(0);
  }

  /** 現在位置と向きから、いま走っている道路と進行方向を決めて経路を作り直す */
  localize(x: number, z: number, yaw: number): boolean {
    const { tileSize } = this.map.def;
    const tile = this.map.tileAt(Math.round(x / tileSize), Math.round(z / tileSize));
    this.segments = [];
    this.currentIndex = 0;
    this.waiting = false;
    this.avoid = null;
    if (tile?.kind !== 'road' || tile.connections.length === 0) {
      this.rebuild();
      return false;
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const score = (d: Direction) => {
      const v = dirVector(d);
      return v.x * fx + v.z * fz;
    };
    const dout = [...tile.connections].sort((a, b) => score(b) - score(a))[0];
    // 入ってきた方向: 直進で来られるならそれ、無理なら残りのつながりのうち向きに近いもの
    const dinCandidates = tile.connections.filter((c) => c !== dout).map(opposite);
    const din = dinCandidates.includes(dout)
      ? dout
      : (dinCandidates.sort((a, b) => score(b) - score(a))[0] ?? dout);
    this.segments.push(this.makeSegment(tile, din, dout, false, false));
    this.rebuild();
    this.s = this.project(x, z, 0, Infinity).s;
    return true;
  }

  /** 「次を右／左／まっすぐ」の指示 */
  setTurn(turn: Turn): void {
    this.pending = turn;
    this.waiting = false;
  }

  /**
   * 「そこじゃなくて、次を○」の指示。
   * まだ入っていない交差点で曲がる予定なら取り消して直進し、その次の交差点で turn する。
   * 戻り値: 'cancelled' 取り消した / 'tooLate' もう曲がり始めている / 'none' 取り消す対象が無い
   */
  correct(turn: Turn): 'cancelled' | 'tooLate' | 'none' {
    const current = this.segments[this.currentIndex];
    const targetIndex = this.segments.findIndex(
      (seg, i) => i > this.currentIndex && seg.junction && seg.din !== seg.dout,
    );
    this.pending = turn;
    this.waiting = false;
    if (targetIndex >= 0) {
      this.avoid = this.segments[targetIndex].dout;
      this.segments.splice(targetIndex);
      this.rebuild();
      return 'cancelled';
    }
    if (current?.junction && current.din !== current.dout) return 'tooLate';
    return 'none';
  }

  /**
   * 毎ステップ呼ぶ。現在位置を経路に投影し、通り過ぎた区間を捨て、先の区間を commitDistance 分まで決める。
   * 経路から大きく外れていたら false（呼び出し側で localize し直す）。
   */
  update(x: number, z: number, commitDistance: number): boolean {
    if (this.points.length < 2) return false;
    const proj = this.project(x, z, this.s - 5, this.s + 30);
    if (proj.distance > 7) return false;
    this.s = proj.s;

    const newIndex = this.segmentIndexAt(this.s);
    if (newIndex !== this.currentIndex) {
      for (let i = this.currentIndex + 1; i <= newIndex; i++) {
        const seg = this.segments[i];
        if (seg.junction) {
          const turn = turnBetween(seg.din, seg.dout);
          if (turn !== 'uturn') this.events.push({ type: 'enterJunction', turn, mistaken: seg.mistaken });
        }
      }
      this.currentIndex = newIndex;
    }

    // 2区間以上前は捨てる（点列が増え続けないように）
    if (this.currentIndex >= 2) {
      const drop = this.currentIndex - 1;
      const offset = this.cumulative[this.segStarts[drop]];
      this.segments.splice(0, drop);
      this.rebuild();
      this.s -= offset;
      this.currentIndex -= drop;
    }

    while (!this.waiting && this.remaining() < commitDistance) {
      if (!this.extend()) break;
    }
    return true;
  }

  /** 経路の終端までの距離 [m] */
  remaining(): number {
    return (this.cumulative[this.cumulative.length - 1] ?? 0) - this.s;
  }

  /** 経路上で距離 s の位置 */
  pointAt(s: number): Point {
    const pts = this.points;
    if (pts.length === 0) return { x: 0, z: 0 };
    const cum = this.cumulative;
    if (s <= 0) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] >= s) {
        const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
      }
    }
    return pts[pts.length - 1];
  }

  /**
   * 現在位置から horizon [m] 先までのカーブ・経路終端を考慮した、いま出してよい速度 [m/s]。
   * decel は想定する減速度。
   */
  safeSpeed(horizon: number, decel: number, stopMargin = 3): number {
    let limit = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const d = this.cumulative[i] - this.s;
      if (d < -2 || d > horizon) continue;
      const v = this.pointLimits[i];
      if (v < Infinity) limit = Math.min(limit, Math.sqrt(v * v + 2 * decel * Math.max(0, d)));
    }
    const toEnd = this.remaining() - stopMargin;
    limit = Math.min(limit, Math.sqrt(2 * decel * Math.max(0, toEnd)));
    return limit;
  }

  private extend(): boolean {
    const last = this.segments[this.segments.length - 1];
    if (!last) return false;
    const { dc, dr } = DIR_OFFSET[last.dout];
    const tile = this.map.tileAt(last.col + dc, last.row + dr);
    if (tile?.kind !== 'road') return false;
    const din = last.dout;
    const options = exitOptions(tile, din);
    if (options.length === 0) return false;

    if (options.length === 1) {
      this.segments.push(this.makeSegment(tile, din, options[0], false, false));
      this.rebuild();
      return true;
    }

    // 交差点: 方向を決める
    let intended: Direction | null = null;
    const avoid = this.avoid;
    if (avoid) {
      // 訂正で取り消した交差点: 直進優先、無理なら取り消した方向以外
      intended = options.includes(din) ? din : (options.find((d) => d !== avoid) ?? null);
      this.avoid = null;
    } else if (this.pending) {
      const want = applyTurn(din, this.pending);
      if (options.includes(want)) {
        intended = want;
        this.events.push({ type: 'pendingUsed', turn: this.pending });
        this.pending = null;
      } else if (options.includes(din)) {
        // 指示された方向に曲がれない交差点は直進して、指示は次に持ち越す
        intended = din;
      }
    } else if (options.includes(din)) {
      intended = din;
    }

    if (!intended) {
      // 直進できず指示も無い → 手前で止まって聞く
      this.waiting = true;
      this.events.push({ type: 'askDirection' });
      return false;
    }

    const actual = this.chooseExit(intended, options, din);
    this.segments.push(this.makeSegment(tile, din, actual, true, actual !== intended));
    this.rebuild();
    return true;
  }

  private makeSegment(tile: Tile, din: Direction, dout: Direction, junction: boolean, mistaken: boolean): Segment {
    const turn = turnBetween(din, dout);
    const half = this.map.def.tileSize / 2;
    const radius = turn === 'left' ? half - this.laneOffset : half + this.laneOffset;
    return {
      col: tile.col,
      row: tile.row,
      din,
      dout,
      junction,
      mistaken,
      speedLimit: turn === 'straight' ? Infinity : Math.sqrt(this.turnLateralAccel * radius),
      points: lanePoints(this.map, tile.col, tile.row, din, dout, this.laneOffset),
    };
  }

  private rebuild(): void {
    this.points = [];
    this.pointLimits = [];
    this.segStarts = [];
    for (const seg of this.segments) {
      // 区間の境目の点は重複するので2区間目以降は先頭を省く
      this.segStarts.push(Math.max(0, this.points.length - 1));
      const pts = this.points.length ? seg.points.slice(1) : seg.points;
      for (const p of pts) {
        this.points.push(p);
        this.pointLimits.push(seg.speedLimit);
      }
    }
    this.cumulative = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.segments.length - 1));
  }

  private segmentIndexAt(s: number): number {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.cumulative[this.segStarts[i]] <= s) return i;
    }
    return 0;
  }

  private project(x: number, z: number, minS: number, maxS: number): { s: number; distance: number } {
    let best = { s: this.s, distance: Infinity };
    for (let i = 1; i < this.points.length; i++) {
      if (this.cumulative[i] < minS || this.cumulative[i - 1] > maxS) continue;
      const a = this.points[i - 1];
      const b = this.points[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2));
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.distance) best = { s: this.cumulative[i - 1] + Math.sqrt(len2) * t, distance: d };
    }
    return best;
  }
}
