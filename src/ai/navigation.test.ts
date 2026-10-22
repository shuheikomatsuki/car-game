import { describe, expect, it } from 'vitest';
import { DIR_YAW, type MapDefinition, parseMap } from '../map/tilemap';
import { type PlannerEvent, RoutePlanner, lanePoints, turnBetween, uturnPoints } from './navigation';

/**
 *   0123456789
 * 0 .........
 * 1 .RRRRRRR.     (1,4): T字（西・東・南）
 * 2 .R..R..R.
 * 3 .RRRRRRR.     (3,4): T字（西・東・北）
 * 4 .........
 */
const DEF: MapDefinition = {
  name: 'test',
  tileSize: 20,
  roadWidth: 12,
  layout: ['.........', '.RRRRRRR.', '.R..R..R.', '.RRRRRRR.', '.........'],
  start: { col: 2, row: 1, heading: 'E' },
};
const map = parseMap(DEF);

/** 経路どおりに走る仮想の車で、planner を進める */
function drive(planner: RoutePlanner, meters: number, onStep?: (step: number) => void) {
  const events: PlannerEvent[] = [];
  let pos = planner.pointAt(planner.progress);
  for (let i = 0; i < meters; i++) {
    onStep?.(i);
    expect(planner.update(pos.x, pos.z, 25)).toBe(true);
    events.push(...planner.drainEvents());
    if (planner.remaining() < 1) break;
    pos = planner.pointAt(planner.progress + 1);
  }
  return { events, pos };
}

function startPlanner(opts = {}) {
  const planner = new RoutePlanner(map, opts);
  expect(planner.localize(40, 20, DIR_YAW.E)).toBe(true);
  return planner;
}

describe('lanePoints', () => {
  it('keeps to the left lane when going straight', () => {
    // 東向きの左は北（-z）
    const pts = lanePoints(map, 2, 1, 'E', 'E', 3);
    for (const p of pts) expect(p.z).toBeCloseTo(20 - 3);
    expect(pts[0].x).toBeCloseTo(30);
    expect(pts[pts.length - 1].x).toBeCloseTo(50);
  });

  it('turns left on a tight arc and right on a wide arc', () => {
    const left = lanePoints(map, 4, 1, 'E', 'N', 3);
    const right = lanePoints(map, 4, 1, 'E', 'S', 3);
    const end = (pts: { x: number; z: number }[]) => pts[pts.length - 1];
    // 左折の出口は北の辺、車線は北向きの左（西）
    expect(end(left)).toEqual({ x: 80 - 3, z: 10 });
    expect(end(right)).toEqual({ x: 80 + 3, z: 30 });
  });
});

describe('turnBetween', () => {
  it('classifies turns relative to the travel direction', () => {
    expect(turnBetween('E', 'N')).toBe('left');
    expect(turnBetween('E', 'S')).toBe('right');
    expect(turnBetween('N', 'N')).toBe('straight');
    expect(turnBetween('N', 'S')).toBe('uturn');
  });
});

describe('RoutePlanner', () => {
  it('goes straight through a junction when no turn was requested', () => {
    const planner = startPlanner();
    drive(planner, 50);
    const junction = planner.segmentList.find((s) => s.col === 4 && s.row === 1);
    expect(junction?.dout).toBe('E');
  });

  it('turns at the next junction when told to, then picks a way by itself at a T where it cannot go straight', () => {
    const planner = startPlanner();
    planner.setTurn('right');
    const { events } = drive(planner, 70);
    expect(events).toContainEqual({ type: 'pendingUsed', turn: 'right' });
    expect(events).toContainEqual({ type: 'enterJunction', turn: 'right', mistaken: false });
    // 南へ曲がった先の (3,4) は西か東しか無い → 止まらずに左（東）へ
    expect(events).toContainEqual({ type: 'autoTurn', turn: 'left' });
    expect(planner.pendingTurn).toBeNull();
    const rest = drive(planner, 40);
    expect([...events, ...rest.events]).toContainEqual({ type: 'enterJunction', turn: 'left', mistaken: false });
  });

  it('re-plans a junction it already decided on when told in time', () => {
    const planner = startPlanner();
    // 何も言わずに進むと (4,1) は直進で決まる
    drive(planner, 8);
    expect(planner.segmentList.find((s) => s.col === 4 && s.row === 1)?.dout).toBe('E');
    planner.setTurn('right', 5);
    drive(planner, 40);
    expect(planner.segmentList.find((s) => s.col === 4 && s.row === 1)?.dout ?? 'S').toBe('S');
  });

  it('keeps the junction as it is when the turn comes too late, and uses it at the next one', () => {
    const planner = startPlanner();
    drive(planner, 8);
    planner.setTurn('right', 100);
    const { events } = drive(planner, 30);
    expect(events).toContainEqual({ type: 'enterJunction', turn: 'straight', mistaken: false });
    expect(planner.pendingTurn).toBe('right');
  });

  it('makes a U-turn inside the paved square of a road tile', () => {
    const pts = uturnPoints(map, 2, 1, 'E', 3);
    // 東向きの左は北（-z）。出口は同じ辺の反対車線
    expect(pts[0]).toEqual({ x: 30, z: 20 - 3 });
    expect(pts[pts.length - 1].x).toBeCloseTo(30);
    expect(pts[pts.length - 1].z).toBeCloseTo(20 + 3);
    for (const p of pts) {
      expect(Math.abs(p.z - 20)).toBeLessThanOrEqual(DEF.roadWidth / 2 - 1);
      expect(p.x).toBeLessThanOrEqual(40 + DEF.roadWidth / 2 - 1);
    }
  });

  it('turns back on a U-turn and keeps driving the other way', () => {
    const planner = startPlanner();
    expect(planner.uturn(5)).toBe(true);
    const { events, pos } = drive(planner, 60);
    expect(events).toContainEqual({ type: 'enterUturn' });
    // 西へ戻って (1,1) の角へ向かう
    expect(pos.x).toBeLessThan(40);
  });

  it('keeps a turn it cannot make for the next junction and goes straight', () => {
    const planner = startPlanner();
    // (1,4) では左（北）に行けない → 直進して持ち越す
    planner.setTurn('left');
    drive(planner, 50);
    const junction = planner.segmentList.find((s) => s.col === 4 && s.row === 1);
    expect(junction?.dout).toBe('E');
    expect(planner.pendingTurn).toBe('left');
  });

  it('cancels a committed turn with a correction and turns at the following junction instead', () => {
    // 右下の (3,7) まで回り込むと、(3,4) に西向きで入る。そこで「右（北）」→ 訂正して次へ
    const planner = new RoutePlanner(map);
    expect(planner.localize(140, 60, DIR_YAW.S)).toBe(true);
    planner.setTurn('right');
    let result: string | null = null;
    drive(planner, 200, () => {
      const committed = planner.segmentList.find((s) => s.col === 4 && s.row === 3);
      if (!result && committed?.dout === 'N') result = planner.correct('left');
    });
    expect(result).toBe('cancelled');
    const junction = planner.segmentList.find((s) => s.col === 4 && s.row === 3);
    // 取り消したので北には曲がらない
    expect(junction?.dout ?? 'W').toBe('W');
  });

  it('can be made to take a wrong turn by the exit chooser', () => {
    const planner = startPlanner({
      chooseExit: (intended: string, options: string[]) => options.find((d) => d !== intended) ?? intended,
    });
    const { events } = drive(planner, 50);
    expect(events).toContainEqual({ type: 'enterJunction', turn: 'right', mistaken: true });
  });

  it('slows down for turns and stops at the end of the route', () => {
    const planner = startPlanner();
    planner.setTurn('right');
    drive(planner, 15);
    const farFromTurn = planner.safeSpeed(40, 2.5);
    drive(planner, 20);
    const nearTurn = planner.safeSpeed(40, 2.5);
    expect(nearTurn).toBeLessThan(farFromTurn);
    // 右折の半径 13m・横加速度 2.6 m/s^2 → 約 5.8 m/s
    expect(nearTurn).toBeLessThan(8);
    expect(nearTurn).toBeGreaterThan(5);
  });
});
