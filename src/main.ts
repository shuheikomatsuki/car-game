import { SoundSystem } from './audio/sound';
import { GamepadInput, KeyboardInput, PAD_BUTTON, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { Level } from './game/level';
import { NpcField, rankEntrants, velocityOf } from './game/npcRace';
import { PLAYER_COLORS, RemoteCars, carStateOf } from './game/remoteCars';
import { MAPS } from './map/maps';
import { NetClient } from './net/client';
import { GhostRecorder, ghostPoseAt } from './race/ghost';
import { NPC_LEVELS } from './race/npcDriver';
import { type RaceRecord, loadRecord, mergeRecord, saveRecord } from './race/records';
import { TimeAttack, formatTime } from './race/timeAttack';
import { isRoomCode, normalizeRoomCode } from './net/protocol';
import { CameraRig } from './render/camera';
import { CarMesh } from './render/carMesh';
import { createGhostMesh } from './render/raceMesh';
import { GameScene } from './render/scene';
import type { CarSnapshot } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS } from './sim/vehicle';
import { Hud, hideLoading, showError } from './ui/hud';
import { OnlinePanel } from './ui/onlinePanel';
import { Minimap } from './ui/minimap';
import { RaceHud } from './ui/raceHud';
import { canRequestFullscreen, enterFullscreen, isFullscreen, isStandalone, needsHomeScreenForFullscreen } from './ui/fullscreen';
import { TouchControls, prefersTouch } from './ui/touchControls';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;
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
  const cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
  const hud = new Hud();
  const sound = new SoundSystem();
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

  const remoteCars = new RemoteCars(view.scene);
  remoteCars.attachLevel(level);

  // --- タイムアタック・NPC 対戦 ---
  let race: TimeAttack | null = null;
  /** いま走っているレースの種類 */
  let raceMode: 'timeAttack' | 'npc' = 'timeAttack';
  /** NPC 対戦の NPC たち */
  let npcField: NpcField | null = null;
  /** NPC の強さ（?npc=pro のように指定できる） */
  let npcLevelIndex = Math.max(0, NPC_LEVELS.findIndex((l) => l.id === (params.get('npc') ?? 'hard')));
  /** NPC 対戦の NPC の台数 */
  const NPC_COUNT = 3;
  let ghostRecorder = new GhostRecorder();
  /** いまのコースと車での自己ベスト */
  let best: RaceRecord | null = null;
  const ghostMesh = createGhostMesh();
  ghostMesh.root.visible = false;
  view.scene.add(ghostMesh.root);
  const raceMapIndex = MAPS.findIndex((m) => m.race);
  const minimap = new Minimap(document.getElementById('minimap')!);
  const raceHud = new RaceHud({
    onRetry: () => race && startRace(raceMode),
    onQuit: () => stopRace(),
  });

  const placeCar = (spawn: { x: number; z: number; yaw: number }) => {
    level.car.reset(spawn);
    prev = curr = level.car.snapshot();
    cameraRig.snap();
    // スタート地点で他の車と重なっても弾き飛ばされないように
    remoteCars.ghost(performance.now());
  };
  const resetCar = () => {
    // レース中のリセットは、スタートからやり直し
    if (race) startRace(raceMode);
    else placeCar(level.spawn);
  };

  const raceLabel = () => (raceMode === 'npc' ? `NPC対戦（${NPC_LEVELS[npcLevelIndex].label}）` : 'タイムアタック');

  /**
   * レース用のコースのスタートラインの手前に並び、カウントダウンから始める。
   * いまのマップがレース用でなければサーキットへ移動する。NPC 対戦では NPC が前に並び、自分は最後尾から
   */
  function startRace(mode: 'timeAttack' | 'npc') {
    raceMode = mode;
    if (!level.course) {
      loadMap(raceMapIndex);
      // 同じ部屋の全員もサーキットへ
      net.send({ t: 'map', map: mapIndex });
    }
    npcField?.dispose();
    npcField = null;
    const course = level.course!;
    const laps = level.def.race!.laps;
    race = new TimeAttack(course, laps);
    ghostRecorder = new GhostRecorder();
    // NPC 対戦ではゴーストを出さず、記録も残さない
    best = mode === 'timeAttack' ? loadRecord(level.def.name, vehicle().id) : null;
    // 2列に互い違いに並ぶ。道幅に合わせて左右の間隔を決める
    const side = Math.min(3, level.def.roadWidth / 4);
    const slot = (i: number) => course.gridSpot(6 + 7 * i, i % 2 === 0 ? side : -side);
    if (mode === 'npc') {
      const grid = Array.from({ length: NPC_COUNT }, (_, i) => slot(i));
      npcField = new NpcField(level, view.scene, NPC_LEVELS[npcLevelIndex], vehicle().params, laps, grid);
      placeCar(slot(NPC_COUNT));
    } else {
      placeCar(course.gridSpot(6));
    }
    raceHud.show(true);
    minimap.setCourse(course);
    raceHud.hideResult();
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    hud.setMode(raceLabel());
    touch.refresh();
  }

  /** レースの表示と NPC を片付ける（車の位置はそのまま） */
  function clearRace() {
    race = null;
    npcField?.dispose();
    npcField = null;
    raceHud.show(false);
    minimap.setCourse(null);
    ghostMesh.root.visible = false;
  }

  function stopRace() {
    if (!race) return;
    clearRace();
    hud.setMode('自分で運転');
    resetCar();
    touch.refresh();
  }

  const toggleRace = (mode: 'timeAttack' | 'npc') => (race && raceMode === mode ? stopRace() : startRace(mode));
  const cycleNpcLevel = () => {
    npcLevelIndex = (npcLevelIndex + 1) % NPC_LEVELS.length;
    hud.toast(`NPCの強さ: ${NPC_LEVELS[npcLevelIndex].label}`);
    if (race && raceMode === 'npc') startRace('npc');
    touch.refresh();
  };

  /** NPC 対戦の順位（自分を含む） */
  const standings = () => {
    if (!race || !npcField) return [];
    return rankEntrants([
      { name: 'あなた', color: carMesh.color, isPlayer: true, timer: race, x: curr.x, z: curr.z },
      ...npcField.npcs.map((n) => ({ name: n.name, color: n.color, isPlayer: false, timer: n.timer, x: n.curr.x, z: n.curr.z })),
    ]);
  };

  const handleRaceEvents = (r: TimeAttack) => {
    for (const e of r.drainEvents()) {
      switch (e.type) {
        case 'count':
          raceHud.count(e.value);
          sound.beep(e.value === 0);
          break;
        case 'lap': {
          if (r.phase === 'finished') break;
          const ref = best?.laps[e.lap - 1];
          const diff = ref === undefined ? '' : `（${e.time - ref >= 0 ? '+' : '−'}${Math.abs(e.time - ref).toFixed(2)}）`;
          raceHud.split(`${e.lap}周目 ${formatTime(e.time)}${diff}`, ref !== undefined && e.time < ref);
          sound.beep();
          break;
        }
        case 'finish': {
          if (raceMode === 'npc') {
            raceHud.showStandings(standings(), r.totalLaps);
            raceHud.setWarning({ wrongWay: false, offCourse: false });
            sound.beep(true);
            break;
          }
          const previousBest = best?.total ?? null;
          const merged = mergeRecord(best, { total: e.total, laps: e.laps, ghost: ghostRecorder.frames });
          const saved = merged.newTotal || merged.newLap ? saveRecord(level.def.name, vehicle().id, merged.record) : true;
          best = merged.record;
          raceHud.showResult({
            total: e.total,
            laps: e.laps,
            previousBest,
            newTotal: merged.newTotal,
            newLap: merged.newLap,
            bestLap: merged.record.bestLap,
            notSaved: !saved,
          });
          raceHud.setWarning({ wrongWay: false, offCourse: false });
          sound.beep(true);
          break;
        }
        case 'wrongWay':
          raceHud.setWarning({ wrongWay: e.on });
          break;
        case 'offCourse':
          raceHud.setWarning({ offCourse: e.on });
          break;
      }
    }
  };

  const loadMap = (index: number, message = `マップ: ${MAPS[index].name}`) => {
    // NPC の車は古いマップの物理ワールドにいるので先に片付ける（レース中ならこの後で並び直す）
    npcField?.dispose();
    npcField = null;
    level.dispose();
    mapIndex = index;
    level = new Level(rapier, MAPS[mapIndex]);
    level.car.params = { ...vehicle().params };
    view.scene.add(level.group);
    remoteCars.attachLevel(level);
    // レース用でないマップに替わったらレースをやめる（レース用ならそのコースでやり直し）
    if (race && !level.course) {
      clearRace();
      hud.setMode('自分で運転');
      touch.refresh();
    }
    resetCar();
    hud.setMapName(level.def.name);
    hud.toast(message);
    net.updateJoin({ map: mapIndex });
  };
  const nextMap = () => {
    // タイムアタック中は、レース用のコースだけを順に替える
    let next = (mapIndex + 1) % MAPS.length;
    while (race && !MAPS[next].race) next = (next + 1) % MAPS.length;
    loadMap(next);
    // 同じ部屋の全員のマップも切り替える
    net.send({ t: 'map', map: mapIndex });
  };
  const cycleCar = () => {
    carIndex = (carIndex + 1) % VEHICLE_PRESETS.length;
    level.car.params = { ...vehicle().params };
    resetCar();
    hud.setCarName(vehicle().label);
    net.send({ t: 'profile', car: vehicle().id });
    net.updateJoin({ car: vehicle().id });
    hud.toast(`車: ${vehicle().label}（最高 ${Math.round(vehicle().params.maxForwardSpeed * 3.6)}km/h）`);
  };
  const cycleCamera = () => {
    cameraRig.cycle();
    hud.setCameraName(cameraRig.modeName);
  };
  const toggleMute = () => {
    const muted = sound.toggleMute();
    hud.setMuted(muted);
  };
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
  keyboard.onAction('KeyT', () => toggleRace('timeAttack'));
  keyboard.onAction('KeyY', () => toggleRace('npc'));
  keyboard.onAction('KeyC', cycleCamera);
  keyboard.onAction('KeyN', nextMap);
  keyboard.onAction('KeyP', cycleCar);
  keyboard.onAction('KeyM', toggleMute);
  keyboard.onAction('KeyH', () => hud.toggleHelp());
  keyboard.onAction('KeyK', () => race && raceMode === 'npc' && cycleNpcLevel());

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
      { label: () => (race ? 'やり直す' : 'リセット'), run: resetCar, quick: true },
      { label: () => (race && raceMode === 'timeAttack' ? 'タイムアタックをやめる' : 'タイムアタック'), run: () => toggleRace('timeAttack') },
      { label: () => (race && raceMode === 'npc' ? 'NPC対戦をやめる' : 'NPCと対戦'), run: () => toggleRace('npc') },
      { label: () => `NPCの強さ: ${NPC_LEVELS[npcLevelIndex].label}`, run: cycleNpcLevel, visible: () => race !== null && raceMode === 'npc' },
      {
        label: () => `ハンドル: ${touch.steerMode === 'tilt' ? '傾ける' : 'なぞる'}`,
        run: () => void toggleSteerMode(),
      },
      {
        label: () => '全画面で遊ぶ',
        run: () => void enterFullscreen(),
        visible: () => canRequestFullscreen() && !isFullscreen() && !isStandalone(),
      },
      { label: () => 'みんなで走る', run: () => onlinePanel.open() },
      { label: () => (race ? 'コースを切り替える' : 'マップを切り替える'), run: nextMap },
      { label: () => '車を切り替える', run: cycleCar },
      { label: () => `サウンド: ${sound.isMuted ? 'OFF' : 'ON'}`, run: toggleMute },
    ],
    () => `${level.def.name}・${race ? raceLabel() : '自分で運転'}・${vehicle().label}・カメラ: ${cameraRig.modeName}`,
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
  const unlockAudio = () => sound.start();
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('pointerup', unlockAudio);
  window.addEventListener('touchend', unlockAudio);
  window.addEventListener('click', unlockAudio);

  hud.setCameraName(cameraRig.modeName);
  hud.setMapName(level.def.name);
  hud.setCarName(vehicle().label);
  hud.setMuted(sound.isMuted);
  hud.setMode('自分で運転');
  if (touch.isShown && window.innerHeight > window.innerWidth) hud.toast('横向きにすると遊びやすくなります');

  const loop = new FixedStepLoop(
    (dt) => {
      const pad = gamepad.read();
      hud.setGamepadConnected(gamepad.isConnected);
      input = mergeInputs(mergeInputs(keyboard.read(), pad), touch.read());
      // カウントダウン中は発進させない（ハンドルだけ切れる）
      if (race && !race.canDrive) input = { ...NEUTRAL_INPUT, steer: input.steer };
      remoteCars.step(performance.now());
      level.physics.world.timestep = dt;
      level.car.applyInput(input, dt);
      npcField?.applyInputs(dt, race?.canDrive ?? false, [curr]);
      level.physics.world.step();
      npcField?.afterStep(dt);

      const impact = level.car.measureImpact();
      if (impact > IMPACT_THRESHOLD) {
        sound.impact(impact);
        cameraRig.addShake(impact);
      }

      prev = curr;
      curr = level.car.snapshot();
      // マップ外に落ちた場合の保険
      if (curr.y < -5) resetCar();
      if (race) {
        const r = race;
        r.update(dt, { x: curr.x, z: curr.z, ...velocityOf(curr) });
        if (r.phase === 'racing') ghostRecorder.sample(r.time, curr);
        handleRaceEvents(r);
      }
      // タブが裏に回っている間は送らない（他の人からは止まって見え、やがて放置として部屋から外れる）
      if (net.isOnline && !document.hidden && ++stepCount % SEND_EVERY_STEPS === 0) {
        net.send({ t: 'state', time: performance.now(), s: carStateOf(curr) });
      }

    },
    (alpha, frameDt) => {
      const s = level.ground(lerpSnapshot(prev, curr, alpha));
      carMesh.update(s);
      remoteCars.render(performance.now());
      npcField?.render(alpha);
      if (race) {
        const pose = best ? ghostPoseAt(best.ghost, Math.max(0, race.time)) : null;
        const list = npcField ? standings() : null;
        const rank = list ? { list, index: list.findIndex((e) => e.isPlayer) } : null;
        ghostMesh.root.visible = pose !== null;
        if (pose) ghostMesh.update(level.ground({ x: pose.x, y: 0.05, z: pose.z, yaw: pose.yaw, forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0, wheelSpin: 0 }));
        raceHud.update({
          lap: race.lap,
          totalLaps: race.totalLaps,
          time: race.time,
          best: best?.total ?? null,
          laps: race.laps,
          lapTime: race.lapTime,
          refLaps: best?.laps,
          finished: race.phase === 'finished',
          position: rank ? { rank: rank.index + 1, total: rank.list.length } : undefined,
        });
        // ゴールした後も、まだ走っている NPC がゴールするたびに順位表を更新する
        if (rank && race.phase === 'finished') raceHud.showStandings(rank.list, race.totalLaps);
        const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
        minimap.draw([
          ...(pose ? [{ x: pose.x, z: pose.z, color: '#7fd4ff' }] : []),
          ...(npcField?.npcs.map((n) => ({ x: n.curr.x, z: n.curr.z, color: hex(n.color) })) ?? []),
          { x: s.x, z: s.z, yaw: s.yaw, color: '#ff5a4f', size: 5 },
        ]);
      }
      level.syncProps();
      cameraRig.update(s, frameDt);
      view.followTarget(s.x, s.z, s.y);
      hud.update(s);
      sound.update(s.forwardSpeed, input.throttle, s.lateralSpeed, input.brake > 0 && s.forwardSpeed > 0);
      view.render(cameraRig.camera);
    },
  );

  // ?debug を付けるとブラウザの開発者ツールや自動テストから状態を触れる
  if (params.has('debug')) {
    Object.assign(window, {
      __game: { getLevel: () => level, getRace: () => race, getNpcs: () => npcField, startTimeAttack: () => startRace('timeAttack'), startNpcRace: () => startRace('npc'), stopRace, net, remoteCars, touch, onlinePanel, cameraRig, sound },
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
