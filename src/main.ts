import { FixedStepLoop } from './core/loop';
import { KeyboardInput } from './core/input';
import { TOWN_MAP } from './map/maps';
import { buildObstacles } from './map/obstacles';
import { DIR_YAW, parseMap, tileCenter } from './map/tilemap';
import { ChaseCamera } from './render/camera';
import { CarMesh } from './render/carMesh';
import { buildMapMesh, createConeMesh } from './render/mapMesh';
import { GameScene } from './render/scene';
import { Car, type CarSnapshot } from './sim/car';
import { createPhysicsWorld, loadRapier } from './sim/physics';
import { Hud, hideLoading, showError } from './ui/hud';

/** 2つのスナップショットの間を補間する（描画を物理ステップより滑らかにするため） */
function lerpSnapshot(a: CarSnapshot, b: CarSnapshot, t: number): CarSnapshot {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  let dyaw = b.yaw - a.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return {
    ...b,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z),
    yaw: a.yaw + dyaw * t,
    wheelSpin: lerp(a.wheelSpin, b.wheelSpin),
  };
}

async function main() {
  const rapier = await loadRapier();

  const map = parseMap(TOWN_MAP);
  const obstacles = buildObstacles(map);
  const physics = createPhysicsWorld(rapier, obstacles);

  const startCenter = tileCenter(map, map.def.start.col, map.def.start.row);
  const spawn = { ...startCenter, yaw: DIR_YAW[map.def.start.heading] };
  const car = new Car(physics, spawn);

  const view = new GameScene(document.getElementById('app')!);
  view.scene.add(buildMapMesh(map, obstacles));
  const carMesh = new CarMesh();
  view.scene.add(carMesh.root);
  const coneMeshes = physics.cones.map(() => {
    const m = createConeMesh();
    view.scene.add(m);
    return m;
  });

  const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
  const hud = new Hud();
  hud.setCameraName(chase.modeName);
  window.addEventListener('resize', () => view.resize(chase.camera));

  const input = new KeyboardInput();
  const resetCar = () => {
    car.reset(spawn);
    prev = curr = car.snapshot();
    chase.snap();
  };
  input.onAction('KeyR', resetCar);
  input.onAction('KeyC', () => {
    chase.cycle();
    hud.setCameraName(chase.modeName);
  });
  input.onAction('KeyH', () => hud.toggleHelp());

  let prev = car.snapshot();
  let curr = prev;

  const loop = new FixedStepLoop(
    (dt) => {
      physics.world.timestep = dt;
      car.applyInput(input.read(), dt);
      physics.world.step();
      prev = curr;
      curr = car.snapshot();
      // マップ外に落ちた場合の保険
      if (curr.y < -5) resetCar();
    },
    (alpha, frameDt) => {
      const s = lerpSnapshot(prev, curr, alpha);
      carMesh.update(s);
      physics.cones.forEach((c, i) => {
        const t = c.body.translation();
        const r = c.body.rotation();
        coneMeshes[i].position.set(t.x, t.y, t.z);
        coneMeshes[i].quaternion.set(r.x, r.y, r.z, r.w);
      });
      chase.update(s, frameDt);
      view.followTarget(s.x, s.z);
      hud.update(s);
      view.render(chase.camera);
    },
  );

  hideLoading();
  loop.start();
}

main().catch((err) => {
  console.error(err);
  showError(`起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
});
