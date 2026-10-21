import { SoundSystem } from './audio/sound';
import { GamepadInput, KeyboardInput, PAD_BUTTON, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { Level } from './game/level';
import { MAPS } from './map/maps';
import { CameraRig } from './render/camera';
import { CarMesh } from './render/carMesh';
import { GameScene } from './render/scene';
import type { CarSnapshot } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT } from './sim/vehicle';
import { Hud, hideLoading, showError } from './ui/hud';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;

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

  const view = new GameScene(document.getElementById('app')!);
  const carMesh = new CarMesh();
  view.scene.add(carMesh.root);
  const cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
  const hud = new Hud();
  const sound = new SoundSystem();
  window.addEventListener('resize', () => view.resize(cameraRig.camera));

  // ?map=1 のように開始マップを指定できる
  const requested = Number(new URLSearchParams(location.search).get('map'));
  let mapIndex = Number.isInteger(requested) && requested >= 0 && requested < MAPS.length ? requested : 0;
  let level = new Level(rapier, MAPS[mapIndex]);
  view.scene.add(level.group);
  let prev = level.car.snapshot();
  let curr = prev;
  let input = { ...NEUTRAL_INPUT };

  const resetCar = () => {
    level.car.reset(level.spawn);
    prev = curr = level.car.snapshot();
    cameraRig.snap();
  };
  const nextMap = () => {
    level.dispose();
    mapIndex = (mapIndex + 1) % MAPS.length;
    level = new Level(rapier, MAPS[mapIndex]);
    view.scene.add(level.group);
    resetCar();
    hud.setMapName(level.def.name);
    hud.toast(`マップ: ${level.def.name}`);
  };
  const cycleCamera = () => {
    cameraRig.cycle();
    hud.setCameraName(cameraRig.modeName);
  };
  const toggleMute = () => {
    hud.setMuted(sound.toggleMute());
  };

  const keyboard = new KeyboardInput();
  keyboard.onAction('KeyR', resetCar);
  keyboard.onAction('KeyC', cycleCamera);
  keyboard.onAction('KeyN', nextMap);
  keyboard.onAction('KeyM', toggleMute);
  keyboard.onAction('KeyH', () => hud.toggleHelp());

  const gamepad = new GamepadInput();
  gamepad.onButton(PAD_BUTTON.north, cycleCamera);
  gamepad.onButton(PAD_BUTTON.start, resetCar);
  gamepad.onButton(PAD_BUTTON.select, nextMap);

  // ブラウザの制約で、音はユーザー操作の後でないと鳴らせない
  const unlockAudio = () => sound.start();
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);

  hud.setCameraName(cameraRig.modeName);
  hud.setMapName(level.def.name);
  hud.setMuted(sound.isMuted);

  const loop = new FixedStepLoop(
    (dt) => {
      const pad = gamepad.read();
      hud.setGamepadConnected(gamepad.isConnected);
      input = mergeInputs(keyboard.read(), pad);
      level.physics.world.timestep = dt;
      level.car.applyInput(input, dt);
      level.physics.world.step();

      const impact = level.car.measureImpact();
      if (impact > IMPACT_THRESHOLD) {
        sound.impact(impact);
        cameraRig.addShake(impact);
      }

      prev = curr;
      curr = level.car.snapshot();
      // マップ外に落ちた場合の保険
      if (curr.y < -5) resetCar();
    },
    (alpha, frameDt) => {
      const s = lerpSnapshot(prev, curr, alpha);
      carMesh.update(s);
      level.syncProps();
      cameraRig.update(s, frameDt);
      view.followTarget(s.x, s.z);
      hud.update(s);
      sound.update(s.forwardSpeed, input.throttle, s.lateralSpeed, input.brake > 0 && s.forwardSpeed > 0);
      view.render(cameraRig.camera);
    },
  );

  // ?debug を付けるとブラウザの開発者ツールや自動テストから状態を触れる
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, { __game: { getLevel: () => level, cameraRig, sound } });
  }

  hideLoading();
  loop.start();
}

main().catch((err) => {
  console.error(err);
  showError(`起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
});
