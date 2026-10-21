import { type Command, COMMAND_BUTTONS, isEmergency } from './ai/commands';
import { CHARACTER_NAME, Dialogue, type DialogueTrigger } from './ai/dialogue';
import { CharacterDriver } from './ai/driver';
import { PERSONALITIES, createRng } from './ai/personality';
import { SoundSystem } from './audio/sound';
import { FaceEditor } from './face/editor';
import { loadFace, saveFace } from './face/store';
import { GamepadInput, KeyboardInput, PAD_BUTTON, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { Level } from './game/level';
import { MAPS } from './map/maps';
import { CameraRig } from './render/camera';
import { CarMesh } from './render/carMesh';
import { CharacterMesh } from './render/character';
import { GameScene } from './render/scene';
import type { CarSnapshot } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS } from './sim/vehicle';
import { AssistPanel, commandLabel } from './ui/assistPanel';
import { Hud, hideLoading, showError } from './ui/hud';
import { VoiceInput } from './voice/recognition';
import { VoiceOutput } from './voice/speech';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;
/** キャラクターが黙っている時間がこれを超えたら、何か話す [s] */
const IDLE_CHAT_SECONDS = 25;

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
  const params = new URLSearchParams(location.search);

  const view = new GameScene(document.getElementById('app')!);
  const carMesh = new CarMesh();
  view.scene.add(carMesh.root);
  const character = new CharacterMesh();
  carMesh.root.add(character.root);
  const cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
  const hud = new Hud();
  const sound = new SoundSystem();
  const voiceOut = new VoiceOutput();
  window.addEventListener('resize', () => view.resize(cameraRig.camera));

  // ?map=1 のように開始マップを指定できる
  const requested = Number(params.get('map'));
  let mapIndex = Number.isInteger(requested) && requested >= 0 && requested < MAPS.length ? requested : 0;
  // ?car=sport のように開始時の車を指定できる
  let carIndex = Math.max(0, VEHICLE_PRESETS.findIndex((v) => v.id === params.get('car')));
  const vehicle = () => VEHICLE_PRESETS[carIndex];
  let level = new Level(rapier, MAPS[mapIndex]);
  level.car.params = { ...vehicle().params };
  view.scene.add(level.group);
  let prev = level.car.snapshot();
  let curr = prev;
  let input = { ...NEUTRAL_INPUT };

  // --- キャラクター運転（音声指示モード） ---
  let assist = params.has('assist');
  let personalityIndex = 0;
  const rng = createRng(Date.now());
  const dialogue = new Dialogue(rng);
  const createDriver = () => new CharacterDriver(level.map, PERSONALITIES[personalityIndex], rng, vehicle().params);
  let driver = createDriver();
  let lastLinePriority = 0;
  let lastLineAt = 0;
  let clock = 0;

  const speak = (trigger: DialogueTrigger) => {
    const line = dialogue.lineFor(trigger);
    if (!line) return;
    // 優先度の低いセリフは、直前のセリフを話している最中なら飛ばす
    const busy = clock - lastLineAt < 1.8;
    if (busy && line.priority < lastLinePriority) return;
    lastLinePriority = line.priority;
    lastLineAt = clock;
    panel.say(CHARACTER_NAME, line.text);
    character.setMood(line.mood, 1.2 + line.text.length * 0.08);
    voiceOut.speak(line.text);
  };

  const giveCommand = (command: Command, spoken?: string) => {
    if (!assist) return;
    driver.command(command);
    panel.showHeard(spoken ?? commandLabel(command), command, true);
  };

  const panel = new AssistPanel(
    (c) => giveCommand(c),
    () => voiceIn.toggle(),
  );
  const voiceIn = new VoiceInput({
    onCommand: (command, text) => {
      // 自分（キャラクター）の声を拾った可能性があるときは、緊急の指示以外は無視する
      if (voiceOut.speaking && !isEmergency(command)) return;
      giveCommand(command, text);
    },
    onTranscript: (text, final, command) => {
      if (!assist || (voiceOut.speaking && !command)) return;
      if (!command || !final) panel.showHeard(text, command, final);
      if (final && !command && text.trim().length > 1 && !voiceOut.speaking) speak({ type: 'notUnderstood' });
    },
    onError: (message) => hud.toast(message),
    onListeningChange: (listening) => panel.setMic(listening),
  });
  panel.setMic(false);

  const updateAssistStatus = () => {
    const pending = driver.pendingTurn;
    const turn = pending === 'left' ? '次は左' : pending === 'right' ? '次は右' : pending === 'straight' ? '次はまっすぐ' : '';
    panel.setStatus(
      `運転のうまさ: ${PERSONALITIES[personalityIndex].label}（K）　巡航 ${driver.speedKmh}km/h${turn ? `　${turn}` : ''}`,
    );
  };

  const resetCar = () => {
    level.car.reset(assist ? level.laneSpawn : level.spawn);
    prev = curr = level.car.snapshot();
    driver.reset();
    cameraRig.snap();
  };

  const setAssist = (on: boolean) => {
    assist = on;
    character.root.visible = on;
    panel.show(on);
    hud.setMode(on, on ? `${CHARACTER_NAME}に指示` : '自分で運転');
    driver = createDriver();
    resetCar();
    if (on || cameraRig.modeId === 'passenger' || cameraRig.modeId === 'faceCam') {
      cameraRig.select(on ? 'passenger' : 'chaseNear');
    }
    hud.setCameraName(cameraRig.modeName);
    if (on) {
      updateAssistStatus();
      speak({ type: 'greeting' });
    } else {
      voiceIn.stop();
      voiceOut.cancel();
    }
  };

  const nextMap = () => {
    level.dispose();
    mapIndex = (mapIndex + 1) % MAPS.length;
    level = new Level(rapier, MAPS[mapIndex]);
    level.car.params = { ...vehicle().params };
    view.scene.add(level.group);
    driver = createDriver();
    resetCar();
    hud.setMapName(level.def.name);
    hud.toast(`マップ: ${level.def.name}`);
  };
  const cycleCar = () => {
    carIndex = (carIndex + 1) % VEHICLE_PRESETS.length;
    level.car.params = { ...vehicle().params };
    // キャラクターも新しい車の性能（ハンドルの効き・最高速）に合わせて運転し直す
    driver = createDriver();
    resetCar();
    hud.setCarName(vehicle().label);
    hud.toast(`車: ${vehicle().label}（最高 ${Math.round(vehicle().params.maxForwardSpeed * 3.6)}km/h）`);
    if (assist) updateAssistStatus();
  };
  const cycleCamera = () => {
    cameraRig.cycle(assist ? [] : ['faceCam']);
    hud.setCameraName(cameraRig.modeName);
  };
  const toggleMute = () => {
    const muted = sound.toggleMute();
    voiceOut.enabled = !muted;
    if (muted) voiceOut.cancel();
    hud.setMuted(muted);
  };
  const cyclePersonality = () => {
    if (!assist) return;
    personalityIndex = (personalityIndex + 1) % PERSONALITIES.length;
    driver = createDriver();
    driver.reset();
    hud.toast(`運転のうまさ: ${PERSONALITIES[personalityIndex].label}`);
    updateAssistStatus();
  };

  // --- 顔写真 ---
  const savedFace = loadFace();
  if (savedFace) {
    const img = new Image();
    img.onload = () => character.setFace(img);
    img.src = savedFace;
  }
  const faceEditor = new FaceEditor({
    onApply: (texture) => {
      character.setFace(texture);
      const saved = saveFace(texture ? texture.toDataURL('image/jpeg', 0.9) : null);
      if (texture && !saved) hud.toast('このブラウザでは保存できないため、ページを閉じるまでの間だけ使います');
      else hud.toast(texture ? '顔写真を設定しました' : '顔写真をやめました');
    },
    onOpenChange: (open) => {
      keyboard.enabled = !open;
      // 貼った顔を確認しやすいよう、顔を映す視点にする
      if (open && assist) {
        cameraRig.select('faceCam');
        hud.setCameraName(cameraRig.modeName);
      }
    },
  });
  const openFaceEditor = () => assist && faceEditor.open();
  const faceButton = document.getElementById('face-button')!;
  faceButton.addEventListener('mousedown', (e) => e.preventDefault());
  faceButton.addEventListener('click', openFaceEditor);

  const keyboard = new KeyboardInput();
  keyboard.onAction('KeyR', resetCar);
  keyboard.onAction('KeyC', cycleCamera);
  keyboard.onAction('KeyN', nextMap);
  keyboard.onAction('KeyP', cycleCar);
  keyboard.onAction('KeyM', toggleMute);
  keyboard.onAction('KeyH', () => hud.toggleHelp());
  keyboard.onAction('KeyQ', () => setAssist(!assist));
  keyboard.onAction('KeyV', () => assist && voiceIn.toggle());
  keyboard.onAction('KeyK', cyclePersonality);
  keyboard.onAction('KeyF', openFaceEditor);
  for (const b of COMMAND_BUTTONS) keyboard.onAction(`Digit${b.key}`, () => giveCommand(b.command));

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
  hud.setCarName(vehicle().label);
  hud.setMuted(sound.isMuted);
  voiceOut.enabled = !sound.isMuted;
  setAssist(assist);

  const loop = new FixedStepLoop(
    (dt) => {
      clock += dt;
      const pad = gamepad.read();
      hud.setGamepadConnected(gamepad.isConnected);
      if (assist) {
        input = driver.update(dt, curr, level.sense);
      } else {
        input = mergeInputs(keyboard.read(), pad);
      }
      level.physics.world.timestep = dt;
      level.car.applyInput(input, dt);
      level.physics.world.step();

      const impact = level.car.measureImpact();
      if (impact > IMPACT_THRESHOLD) {
        sound.impact(impact);
        cameraRig.addShake(impact);
        if (assist) driver.notifyCollision();
      }

      prev = curr;
      curr = level.car.snapshot();
      // マップ外に落ちた場合の保険
      if (curr.y < -5) resetCar();

      if (assist) {
        for (const e of driver.drainEvents()) speak(e);
        if (driver.state === 'driving' && clock - lastLineAt > IDLE_CHAT_SECONDS) speak({ type: 'idle' });
      }
    },
    (alpha, frameDt) => {
      const s = lerpSnapshot(prev, curr, alpha);
      carMesh.update(s);
      character.update(frameDt, s.steerAngle);
      level.syncProps();
      cameraRig.update(s, frameDt);
      view.followTarget(s.x, s.z);
      hud.update(s);
      if (assist) updateAssistStatus();
      sound.update(s.forwardSpeed, input.throttle, s.lateralSpeed, input.brake > 0 && s.forwardSpeed > 0);
      view.render(cameraRig.camera);
    },
  );

  // ?debug を付けるとブラウザの開発者ツールや自動テストから状態を触れる
  if (params.has('debug')) {
    Object.assign(window, {
      __game: { getLevel: () => level, getDriver: () => driver, faceEditor, cameraRig, sound, giveCommand, setAssist },
    });
  }

  hideLoading();
  loop.start();
}

main().catch((err) => {
  console.error(err);
  showError(`起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
});
