import { type MapObstacles, buildObstacles } from '../map/obstacles';
import { FLAG_GUTTER, GUTTER_WIDTH, type RoadModel, buildRoad, bumpHeight, roadValleys } from '../map/road';
import { buildRoadObstacles } from '../map/roadObstacles';
import { type RoadShortcut, findRoadShortcuts, roadShortcutHeight } from '../map/roadShortcuts';
import { type RoadGround, buildRoadGround } from '../map/roadTerrain';
import { type Shortcut, insideShortcut } from '../map/shortcuts';
import { CLIFF_START, type Terrain, buildTerrain } from '../map/terrain';
import { DIR_YAW, type MapDefinition, type ParsedMap, parseMap, tileCenter } from '../map/tilemap';
import { type Course, buildCourse } from '../race/course';
import { type RoadCourse, buildRoadCourse } from '../race/roadCourse';
import { CAR_DIMENSIONS, Car, type Spawn } from '../sim/car';
import { type PhysicsWorld, type Rapier, createPhysicsWorld } from '../sim/physics';

/** 車体の中心が道路の端からこれ以上外へ出たら、崖から落ちたとみなす [m]（路肩の先の崖の縁） */
const FALL_DISTANCE = CLIFF_START + 0.5;
/** 落ちた車は、落ちた地点からこれだけ手前に戻す [m] */
const RECOVERY_BACK = 8;

/**
 * 1つのマップの物理ワールドとコース・地形（描画に依存しない部分）。車の置き方、路面の高さ・勾配、
 * 道路から外れたか・落ちたかの判定をまとめる。描画物を足したものが Level
 */
export class Track {
  readonly physics: PhysicsWorld;
  readonly map: ParsedMap;
  readonly obstacles: MapObstacles;
  /** スタート地点（道路の中央） */
  readonly spawn: Spawn;
  /** レース用のマップなら周回コース */
  readonly course: Course | null;
  /** 高低差のあるタイルのマップなら地形 */
  readonly terrain: Terrain | null;
  /** 中心線で描く道路のマップなら、その道路とコース（高さは地形ではなく道路から求める） */
  readonly road: RoadModel | null = null;
  readonly roadCourse: RoadCourse | null = null;
  /** 中心線で描く峠の地面（見た目） */
  readonly roadGround: RoadGround | null = null;
  /** ヘアピンの内側の近道の帯（MapDefinition.shortcuts のときだけ） */
  readonly shortcuts: readonly Shortcut[];
  private readonly roadShortcuts: readonly RoadShortcut[] = [];

  constructor(
    rapier: Rapier,
    readonly def: MapDefinition,
  ) {
    const map = parseMap(def);
    this.map = map;
    if (def.road) {
      const road = buildRoad(def.road);
      this.road = road;
      const shortcuts = def.shortcuts ? findRoadShortcuts(road) : [];
      this.roadShortcuts = shortcuts;
      this.shortcuts = shortcuts;
      this.obstacles = buildRoadObstacles(road, shortcuts);
      this.roadCourse = buildRoadCourse(map, road);
      this.course = this.roadCourse;
      this.terrain = null;
      this.roadGround =
        def.road.scenery === 'touge'
          ? buildRoadGround(road, roadValleys(road), shortcuts.length ? (x, z, ramp) => roadShortcutHeight(road, shortcuts, x, z, ramp) : undefined)
          : null;
      this.spawn = this.roadCourse.gridSpot(0);
    } else {
      this.obstacles = buildObstacles(map);
      this.terrain = buildTerrain(map);
      this.shortcuts = this.terrain?.shortcuts ?? [];
      const yaw = DIR_YAW[def.start.heading];
      this.spawn = { ...tileCenter(map, def.start.col, def.start.row), yaw };
      this.course = def.race ? buildCourse(map) : null;
    }
    this.physics = createPhysicsWorld(rapier, this.obstacles);
  }

  /** このマップの物理ワールドに車を1台置く（坂道では重力がかかる） */
  createCar(spawn: Spawn): Car {
    const car = new Car(this.physics, spawn);
    if (this.roadCourse) {
      // コース上の距離を手がかりに、近くだけを探して位置を追う（立体交差・往復の同じ道を取り違えない）
      car.tracker = (c, x, z, yaw) => {
        c.courseS = this.locate(x, z, yaw, c.courseS);
        return this.layerAt(c.courseS);
      };
    }
    if (this.hasSlopes) car.slope = (x, z) => this.slopeAt(x, z, car.courseS);
    if (this.course) {
      // 車体の中心が道路の端にあれば半分、車幅の半分より外ならタイヤがすべて草地（近道の帯の上は舗装と同じ）
      const half = CAR_DIMENSIONS.width / 2;
      car.offRoad = (x, z) => (this.onShortcut(x, z) ? 0 : Math.min(1, Math.max(0, (this.offRoadDistance(x, z, car.courseS)! + half) / (2 * half))));
    }
    if (this.road?.flags.some((f) => f & FLAG_GUTTER)) car.gutter = (x, z) => this.gutterAt(x, z, car.courseS) !== 0;
    return car;
  }

  /**
   * 中心線で描く道路のマップで、位置と向きからコース上の距離を求める（hint は直前の距離）。
   * タイルのマップでは null
   */
  locate(x: number, z: number, yaw: number, hint?: number | null): number | null {
    return this.roadCourse ? this.roadCourse.project(x, z, { s: hint, dir: { x: Math.sin(yaw), z: Math.cos(yaw) } }).s : null;
  }

  /** コース上の距離 s の道路の、立体交差の層（src/map/road.ts の LAYER_*。交差のない所とタイルのマップは 0） */
  layerAt(s: number | null): number {
    if (!this.road || !this.roadCourse || s === null) return 0;
    return this.road.layer[this.road.indexAt(this.roadCourse.roadS(s))];
  }

  /** 坂のあるマップか（高低差のあるタイルのマップと、中心線で描く道路のマップ） */
  get hasSlopes(): boolean {
    return this.terrain !== null || this.road !== null;
  }

  /**
   * 車体の中心が道路の端から外へ出ている距離 [m]（道路の上なら負）。コースのないマップでは null。
   * s はコース上の距離の手がかり（中心線で描く道路のマップで、立体交差のどちらの道かを見分ける）
   */
  offRoadDistance(x: number, z: number, s?: number | null): number | null {
    if (!this.course) return null;
    if (this.roadCourse?.inPlaza(x, z)) return -1;
    const p = this.course.project(x, z, { s });
    return Math.abs(p.offset) - this.course.widthAt(p.s) / 2;
  }

  /** 道路の外が崖で、はみ出すと落ちるマップ（峠）か */
  get hasCliffs(): boolean {
    if (this.road) return this.road.spec.scenery === 'touge';
    return this.terrain !== null && this.course !== null;
  }

  /**
   * 路面の高さ [m]。中心線で描く道路のマップでは、s（コース上の距離の手がかり）と yaw（向き）から
   * どの道の上かを決め、荒れた路面の波も足す（bumps = false なら足さない）
   */
  heightAt(x: number, z: number, s?: number | null, yaw?: number, bumps = true): number {
    const rc = this.roadCourse;
    if (rc && this.road) {
      const p = rc.project(x, z, { s, dir: yaw === undefined ? null : { x: Math.sin(yaw), z: Math.cos(yaw) } });
      if (this.roadShortcuts.length && Math.abs(p.offset) > rc.widthAt(p.s) / 2) {
        const cut = roadShortcutHeight(this.road, this.roadShortcuts, x, z);
        if (cut !== null) return cut;
      }
      return rc.heightAt(p.s) + (bumps ? bumpHeight(this.road, rc.roadS(p.s), p.offset) : 0);
    }
    return this.terrain?.heightAt(x, z) ?? 0;
  }

  /** 高さの勾配（x・z 方向にそれぞれ 1m 進んだときに上がる高さ） */
  gradientAt(x: number, z: number, s?: number | null, yaw?: number, bumps = true): { x: number; z: number } {
    if (this.roadCourse) {
      // 手がかりの距離を1回だけ求めて、まわりの4点に使う
      const hint = this.roadCourse.project(x, z, { s, dir: yaw === undefined ? null : { x: Math.sin(yaw), z: Math.cos(yaw) } }).s;
      const d = 0.7;
      const h = (px: number, pz: number) => this.heightAt(px, pz, hint, undefined, bumps);
      return { x: (h(x + d, z) - h(x - d, z)) / (2 * d), z: (h(x, z + d) - h(x, z - d)) / (2 * d) };
    }
    return this.terrain?.gradientAt(x, z) ?? { x: 0, z: 0 };
  }

  /**
   * 坂で車にかかる重力を求めるための勾配（荒れた路面の細かい波は含めない）。
   * 中心線で描く道路のマップでは、道路に沿った勾配を進む向きに向ける
   */
  slopeAt(x: number, z: number, s?: number | null): { x: number; z: number } {
    const rc = this.roadCourse;
    if (rc) {
      const p = rc.project(x, z, { s });
      const g = rc.gradeAt(p.s);
      const yaw = rc.pointAt(p.s).yaw;
      return { x: g * Math.sin(yaw), z: g * Math.cos(yaw) };
    }
    return this.terrain?.gradientAt(x, z) ?? { x: 0, z: 0 };
  }

  /** 路面の荒れ具合（0..1。中心線で描く道路の荒れた区間だけ） */
  roughnessAt(x: number, z: number, s?: number | null): number {
    const rc = this.roadCourse;
    if (!rc || !this.road) return 0;
    return this.road.bump[this.road.indexAt(rc.roadS(rc.project(x, z, { s }).s))];
  }

  /**
   * 内側のタイヤがカーブの内側の側溝に落ちているか（溝落とし）。落ちていれば溝のある側（左 = 1、右 = -1）、
   * 落ちていなければ 0。側溝は道路の端から外へ GUTTER_WIDTH [m] の幅
   */
  gutterAt(x: number, z: number, s?: number | null): number {
    const rc = this.roadCourse;
    const road = this.road;
    if (!rc || !road) return 0;
    const p = rc.project(x, z, { s });
    const i = road.indexAt(rc.roadS(p.s));
    if (!(road.flags[i] & FLAG_GUTTER) || road.curvature[i] === 0) return 0;
    // コースの向きと道路の向きが逆（往復の帰り）なら、左右も逆になる
    const inside = Math.sign(road.curvature[i]) * Math.sign(Math.cos(rc.pointAt(p.s).yaw - road.yaw[i]));
    const wheel = p.offset * inside + CAR_DIMENSIONS.track;
    const edge = rc.widthAt(p.s) / 2;
    return wheel >= edge && wheel <= edge + GUTTER_WIDTH + 0.1 ? inside : 0;
  }

  /** ヘアピンの内側の近道の帯の上か */
  onShortcut(x: number, z: number): boolean {
    return this.shortcuts.some((sc) => insideShortcut(sc, x, z));
  }

  /** 崖から落ちたかどうか（路肩の先の崖の縁を越えた。近道の帯の上は落ちない） */
  fellOff(x: number, z: number, s?: number | null): boolean {
    return this.hasCliffs && this.offRoadDistance(x, z, s)! > FALL_DISTANCE && !this.onShortcut(x, z);
  }

  /** 落ちた車を戻す位置: 落ちた地点より少し手前の、道路の中央 */
  recoverySpot(x: number, z: number, hint?: number | null): Spawn {
    const course = this.course!;
    const projected = course.project(x, z, { s: hint }).s - RECOVERY_BACK;
    const s = course.closed ? projected : Math.max(this.roadCourse ? -this.roadCourse.road.spec.start : 0, projected);
    const p = course.pointAt(s);
    return { x: p.x, z: p.z, yaw: p.yaw, s };
  }
}
