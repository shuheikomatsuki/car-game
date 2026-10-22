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
import { PLAYER_COLORS, RemoteCars, carStateOf } from './game/remoteCars';
import { MAPS } from './map/maps';
import { NetClient } from './net/client';
import { isRoomCode, normalizeRoomCode } from './net/protocol';
import { CameraRig } from './render/camera';
import { CarMesh } from './render/carMesh';
import { CharacterMesh } from './render/character';
import { GameScene } from './render/scene';
import type { CarSnapshot } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS } from './sim/vehicle';
import { AssistPanel, commandLabel } from './ui/assistPanel';
import { Hud, hideLoading, showError } from './ui/hud';
import { OnlinePanel } from './ui/onlinePanel';
import { canRequestFullscreen, enterFullscreen, isFullscreen, isStandalone, needsHomeScreenForFullscreen } from './ui/fullscreen';
import { TouchControls, prefersTouch } from './ui/touchControls';
import { VoiceInput } from './voice/recognition';
import { VoiceOutput } from './voice/speech';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;
/** キャラクターが黙っている時間がこれを超えたら、何か話す [s] */
const IDLE_CHAT_SECONDS = 25;
/** 自分の車の状態を送る間隔（物理ステップ数。60Hz / 3 = 20Hz） */
const SEND_EVERY_STEPS = 3;

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

  const remoteCars = new RemoteCars(view.scene);
  remoteCars.attachLevel(level);

  const resetCar = () => {
    level.car.reset(assist ? level.laneSpawn : level.spawn);
    prev = curr = level.car.snapshot();
    driver.reset();
    cameraRig.snap();
    // スタート地点で他の車と重なっても弾き飛ばされないように
    remoteCars.ghost(performance.now());
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

  const loadMap = (index: number, message = `マップ: ${MAPS[index].name}`) => {
    level.dispose();
    mapIndex = index;
    level = new Level(rapier, MAPS[mapIndex]);
    level.car.params = { ...vehicle().params };
    view.scene.add(level.group);
    remoteCars.attachLevel(level);
    driver = createDriver();
    resetCar();
    hud.setMapName(level.def.name);
    hud.toast(message);
    net.updateJoin({ map: mapIndex });
  };
  const nextMap = () => {
    loadMap((mapIndex + 1) % MAPS.length);
    // 同じ部屋の全員のマップも切り替える
    net.send({ t: 'map', map: mapIndex });
  };
  const cycleCar = () => {
    carIndex = (carIndex + 1) % VEHICLE_PRESETS.length;
    level.car.params = { ...vehicle().params };
    // キャラクターも新しい車の性能（ハンドルの効き・最高速）に合わせて運転し直す
    driver = createDriver();
    resetCar();
    hud.setCarName(vehicle().label);
    net.send({ t: 'profile', car: vehicle().id });
    net.updateJoin({ car: vehicle().id });
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
      touch.enabled = !open;
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

  // --- オンライン ---
  const serverUrl: string = params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? '';
  const netStatus = document.getElementById('net-status')!;
  let roomCode = '';
  const nameOf = (id: number) => remoteCars.list.find((p) => p.id === id)?.name ?? '誰か';
  const refreshNetStatus = () => {
    const online = net.status !== 'offline' && net.status !== 'error';
    netStatus.classList.toggle('hidden', !online);
    if (!online) return;
    const state = net.status === 'online' ? '' : '（接続中…）';
    const names = remoteCars.list.map((p) => p.name).join('、');
    netStatus.innerHTML = `🌐 部屋 <span class="code">${roomCode}</span>${state}<br>${
      names ? `一緒に走っている人: ${escapeHtml(names)}` : '他の人を待っています'
    }`;
  };
  const net: NetClient = new NetClient({
    onStatus: (status, detail) => {
      if (status === 'offline' || status === 'error') {
        remoteCars.clear();
        carMesh.setColor(PLAYER_COLORS[0]);
      }
      if (status === 'reconnecting') remoteCars.clear();
      onlinePanel.setConnected(status === 'online' || status === 'connecting' || status === 'reconnecting');
      onlinePanel.setStatus(
        detail ??
          (status === 'online'
            ? `部屋 ${roomCode} に参加しています`
            : status === 'connecting' || status === 'reconnecting'
              ? '接続しています…'
              : ''),
      );
      if (detail) hud.toast(detail);
      refreshNetStatus();
    },
    onMessage: (m) => {
      const now = performance.now();
      switch (m.t) {
        case 'welcome':
          remoteCars.clear();
          for (const p of m.players) remoteCars.add(p);
          carMesh.setColor(PLAYER_COLORS[m.color % PLAYER_COLORS.length]);
          if (m.map !== mapIndex && m.map >= 0 && m.map < MAPS.length) loadMap(m.map, `部屋のマップ「${MAPS[m.map].name}」に移動しました`);
          hud.toast(`部屋 ${roomCode} に参加しました`);
          onlinePanel.close();
          break;
        case 'join':
          remoteCars.add(m.player);
          hud.toast(`${m.player.name} が来ました`);
          break;
        case 'leave':
          hud.toast(`${nameOf(m.id)} が抜けました`);
          remoteCars.remove(m.id);
          break;
        case 'profile':
          remoteCars.update(m.player);
          break;
        case 'state':
          remoteCars.pushState(m.id, m.time, m.s, now);
          break;
        case 'map':
          if (m.map >= 0 && m.map < MAPS.length && m.map !== mapIndex) {
            loadMap(m.map, `${nameOf(m.by)} がマップを「${MAPS[m.map].name}」に変えました`);
          }
          break;
      }
      refreshNetStatus();
    },
  });
  const onlinePanel = new OnlinePanel(
    {
      onJoin: (name, room) => {
        roomCode = room;
        net.connect(serverUrl, room, { name, car: vehicle().id, map: mapIndex });
      },
      onLeave: () => {
        net.disconnect();
        hud.toast('部屋から退出しました');
      },
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
      },
    },
    serverUrl !== '',
  );
  let stepCount = 0;

  const keyboard = new KeyboardInput();
  keyboard.onAction('KeyO', () => onlinePanel.open());
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

  // --- スマホのタッチ操作 ---
  const touch = new TouchControls(
    [
      {
        label: () => 'カメラ',
        run: () => {
          cycleCamera();
          hud.toast(`カメラ: ${cameraRig.modeName}`);
        },
        quick: true,
      },
      { label: () => 'リセット', run: resetCar, quick: true },
      { label: () => (assist ? '自分で運転する' : `${CHARACTER_NAME}に運転してもらう`), run: () => setAssist(!assist) },
      {
        label: () => `ハンドル: ${touch.steerMode === 'tilt' ? '傾ける' : 'なぞる'}`,
        run: () => void toggleSteerMode(),
        visible: () => !assist,
      },
      {
        label: () => '全画面で遊ぶ',
        run: () => void enterFullscreen(),
        visible: () => canRequestFullscreen() && !isFullscreen() && !isStandalone(),
      },
      { label: () => 'みんなで走る', run: () => onlinePanel.open() },
      { label: () => 'マップを切り替える', run: nextMap },
      { label: () => '車を切り替える', run: cycleCar },
      { label: () => `運転のうまさ: ${PERSONALITIES[personalityIndex].label}`, run: cyclePersonality, visible: () => assist },
      { label: () => '顔写真', run: openFaceEditor, visible: () => assist },
      { label: () => `サウンド: ${sound.isMuted ? 'OFF' : 'ON'}`, run: toggleMute },
    ],
    () => `${level.def.name}・${assist ? `${CHARACTER_NAME}に指示` : '自分で運転'}・${vehicle().label}・カメラ: ${cameraRig.modeName}`,
  );
  touch.refresh();
  // iPhone の Safari はページから全画面にできないので、ホーム画面に追加する方法を案内する
  document.getElementById('touch-install')!.classList.toggle('hidden', !needsHomeScreenForFullscreen());

  async function toggleSteerMode() {
    const next = touch.steerMode === 'tilt' ? 'drag' : 'tilt';
    const ok = await touch.setSteerMode(next);
    if (next === 'tilt') hud.toast(ok ? '傾けてハンドル。今の持ち方がまっすぐです' : 'この端末では傾きを使えません');
    touch.refresh();
  }

  // スマホ・タブレットなら最初から、そうでなくても画面に触れたら操作画面を出す（?touch で強制表示）
  if (prefersTouch() || params.has('touch')) touch.show();
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touch.show();
  });

  // ブラウザの制約で、音はユーザー操作の後でないと鳴らせない（タッチは指を離したときが操作とみなされる）
  const unlockAudio = () => {
    sound.start();
    voiceOut.unlock();
  };
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('pointerup', unlockAudio);
  window.addEventListener('touchend', unlockAudio);

  hud.setCameraName(cameraRig.modeName);
  hud.setMapName(level.def.name);
  hud.setCarName(vehicle().label);
  hud.setMuted(sound.isMuted);
  voiceOut.enabled = !sound.isMuted;
  setAssist(assist);
  if (touch.isShown && window.innerHeight > window.innerWidth) hud.toast('横向きにすると遊びやすくなります');

  const loop = new FixedStepLoop(
    (dt) => {
      clock += dt;
      const pad = gamepad.read();
      hud.setGamepadConnected(gamepad.isConnected);
      if (assist) {
        input = driver.update(dt, curr, level.sense);
      } else {
        input = mergeInputs(mergeInputs(keyboard.read(), pad), touch.read());
      }
      remoteCars.step(performance.now());
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
      // タブが裏に回っている間は送らない（他の人からは止まって見え、やがて放置として部屋から外れる）
      if (net.isOnline && !document.hidden && ++stepCount % SEND_EVERY_STEPS === 0) {
        net.send({ t: 'state', time: performance.now(), s: carStateOf(curr) });
      }

      if (assist) {
        for (const e of driver.drainEvents()) speak(e);
        if (driver.state === 'driving' && clock - lastLineAt > IDLE_CHAT_SECONDS) speak({ type: 'idle' });
      }
    },
    (alpha, frameDt) => {
      const s = lerpSnapshot(prev, curr, alpha);
      carMesh.update(s);
      remoteCars.render(performance.now());
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
      __game: { getLevel: () => level, getDriver: () => driver, faceEditor, net, remoteCars, touch, onlinePanel, cameraRig, sound, giveCommand, setAssist },
    });
  }

  hideLoading();
  loop.start();

  // 招待リンク（?room=XXXX）から開いたら、参加画面を出す
  const invited = normalizeRoomCode(params.get('room') ?? '');
  if (isRoomCode(invited)) {
    onlinePanel.presetRoom(invited);
    onlinePanel.open();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

main().catch((err) => {
  console.error(err);
  showError(`起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
});
