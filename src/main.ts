import { SoundSystem } from './audio/sound';
import { GamepadInput, KeyboardInput, PAD_BUTTON, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { FallRecovery } from './game/fall';
import { Level } from './game/level';
import { NpcField, npcEntries, rankEntrants, velocityOf } from './game/npcRace';
import { PLAYER_COLORS, RemoteCars, carStateOf, createLabel } from './game/remoteCars';
import { MAPS } from './map/maps';
import type { MapDefinition } from './map/tilemap';
import { NetClient } from './net/client';
import type { SubmitResult } from './net/leaderboard';
import { LeaderboardClient, myEntryId, playerId, uploadedTotal } from './net/leaderboardClient';
import { type GhostData, type GhostPose, GhostRecorder, ghostPoseAt } from './race/ghost';
import { NPC_LEVELS } from './race/npcDriver';
import { RIVALS, loadBeatenRivals, markRivalBeaten, rivalLevel } from './race/rivals';
import { type RaceRecord, loadRecord, mergeRecord, saveRecord } from './race/records';
import { TimeAttack, formatTime } from './race/timeAttack';
import { isRoomCode, normalizeRoomCode } from './net/protocol';
import { CameraRig } from './render/camera';
import { CarMesh, carStyle } from './render/carMesh';
import { createGhostMesh } from './render/raceMesh';
import { GameScene } from './render/scene';
import type { CarSnapshot } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS } from './sim/vehicle';
import { Hud, hideLoading, showError } from './ui/hud';
import { OnlinePanel, loadPlayerName } from './ui/onlinePanel';
import { RankingPanel } from './ui/rankingPanel';
import { Minimap } from './ui/minimap';
import { GameMenu } from './ui/menu';
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

/** レースの種類（タイムアタック・NPC 対戦・ライバルとのバトル） */
type RaceMode = 'timeAttack' | 'npc' | 'battle';

async function main() {
  const rapier = await loadRapier();
  const params = new URLSearchParams(location.search);
  // オンライン用のサーバー（みんなで走る・ランキング）
  const serverUrl: string = params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? '';

  const view = new GameScene(document.getElementById('app')!);
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
  /** オンラインの部屋で割り当てられた色（一人のときは車ごとの色） */
  let assignedColor: number | null = null;
  let carMesh = new CarMesh(undefined, carStyle(vehicle().id));
  view.scene.add(carMesh.root);
  /** 車を替えたら、その車の形の車体に作り直す */
  const rebuildCarMesh = () => {
    carMesh.dispose();
    carMesh = new CarMesh(assignedColor ?? undefined, carStyle(vehicle().id));
    view.scene.add(carMesh.root);
  };
  let level = new Level(rapier, MAPS[mapIndex]);
  level.car.params = { ...vehicle().params };
  view.scene.add(level.group);
  let prev = level.car.snapshot();
  let curr = prev;
  let input = { ...NEUTRAL_INPUT };
  /** 峠で道路から落ちたとき */
  const fall = new FallRecovery();

  const remoteCars = new RemoteCars(view.scene);
  remoteCars.attachLevel(level);

  // --- タイムアタック・NPC 対戦 ---
  let race: TimeAttack | null = null;
  /** いま走っているレースの種類 */
  let raceMode: RaceMode = 'timeAttack';
  /** ライバルとのバトルの相手（RIVALS の番号） */
  let battleIndex = 0;
  const battleRival = () => RIVALS[battleIndex];
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
  /** ランキングから選んだ人のゴースト（オレンジ色で一緒に走る） */
  let rival: { name: string; total: number; ghost: GhostData } | null = null;
  const rivalMesh = createGhostMesh(0xffa040);
  rivalMesh.root.visible = false;
  view.scene.add(rivalMesh.root);
  let rivalLabel: ReturnType<typeof createLabel> | null = null;
  const setRival = (r: typeof rival) => {
    rival = r;
    if (rivalLabel) {
      rivalMesh.root.remove(rivalLabel);
      rivalLabel.material.map?.dispose();
      rivalLabel.material.dispose();
      rivalLabel = null;
    }
    if (r) {
      rivalLabel = createLabel(r.name);
      rivalMesh.root.add(rivalLabel);
    }
    rivalMesh.root.visible = false;
  };
  /** ゴーストの位置を、描画用の車の状態にする */
  const ghostSnapshot = (p: GhostPose): CarSnapshot =>
    level.ground({ x: p.x, y: 0.05, z: p.z, yaw: p.yaw, forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0, wheelSpin: 0 });
  const raceMapIndex = MAPS.findIndex((m) => m.race);
  const minimap = new Minimap(document.getElementById('minimap')!);
  const raceHud = new RaceHud({
    onRetry: () => race && startRace(raceMode),
    onQuit: () => stopRace(),
    onRanking: () => openRanking(),
  });

  const placeCar = (spawn: { x: number; z: number; yaw: number }) => {
    level.car.reset(spawn);
    fall.cancel();
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

  const raceLabel = () =>
    raceMode === 'npc' ? `NPC対戦（${NPC_LEVELS[npcLevelIndex].label}）` : raceMode === 'battle' ? `バトル（${battleRival().name}）` : 'タイムアタック';

  /**
   * レース用のコースのスタートラインの手前に並び、カウントダウンから始める。
   * いまのマップがレース用でなければサーキットへ移動する。NPC 対戦では NPC が前に並び、自分は最後尾から。
   * ライバルとのバトルは、ライバルと横に並ぶ。toHome ならライバルの得意なコースへ移動する（他のコースでもバトルできる）
   */
  function startRace(mode: RaceMode, toHome = false) {
    raceMode = mode;
    if (mode !== 'timeAttack') setRival(null);
    const target = mode === 'battle' && toHome ? MAPS.findIndex((m) => m.id === battleRival().course) : level.course ? mapIndex : raceMapIndex;
    if (target !== mapIndex) {
      // 前のレースを片付けてから移動する（移動先でこの後並び直す）
      race = null;
      npcField?.dispose();
      npcField = null;
      loadMap(target);
      // 同じ部屋の全員も同じコースへ
      net.send({ t: 'map', map: mapIndex });
    }
    npcField?.dispose();
    npcField = null;
    const course = level.course!;
    const laps = level.def.race!.laps;
    // アクセルを踏むまでカウントダウンを始めない（自分のタイミングでスタートする）
    race = new TimeAttack(course, laps, true);
    ghostRecorder = new GhostRecorder();
    // NPC 対戦ではゴーストを出さず、記録も残さない
    best = mode === 'timeAttack' ? loadRecord(level.def.name, vehicle().id) : null;
    // 2列に互い違いに並ぶ。道幅に合わせて左右の間隔を決める
    const side = Math.min(3, level.def.roadWidth / 4);
    const slot = (i: number) => course.gridSpot(6 + 7 * i, i % 2 === 0 ? side : -side);
    if (mode === 'npc') {
      const grid = Array.from({ length: NPC_COUNT }, (_, i) => slot(i));
      npcField = new NpcField(level, view.scene, npcEntries(NPC_COUNT, NPC_LEVELS[npcLevelIndex], vehicle().params, carStyle(vehicle().id)), laps, grid);
      placeCar(slot(NPC_COUNT));
    } else if (mode === 'battle') {
      const r = battleRival();
      const preset = VEHICLE_PRESETS.find((v) => v.id === r.car) ?? VEHICLE_PRESETS[0];
      const style = carStyle(preset.id);
      const entry = { name: r.name, color: style.color, level: rivalLevel(r), params: preset.params, style, variation: 1 };
      npcField = new NpcField(level, view.scene, [entry], laps, [course.gridSpot(6, side)]);
      placeCar(course.gridSpot(6, -side));
    } else {
      placeCar(course.gridSpot(6));
    }
    raceHud.show(true);
    raceHud.showReady(touch.isShown ? 'アクセルを押すとスタート' : 'アクセル（W / ↑）でスタート');
    minimap.setCourse(course);
    raceHud.hideResult();
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    hud.setMode(raceLabel());
    touch.refresh();
    menu.refresh();
  }

  /** スタートの合図: カウントダウンを始める */
  function beginRace() {
    if (!race || race.phase !== 'ready') return;
    race.begin();
    npcField?.begin();
  }

  /** レースの表示と NPC を片付ける（車の位置はそのまま） */
  function clearRace() {
    race = null;
    npcField?.dispose();
    npcField = null;
    raceHud.show(false);
    minimap.setCourse(null);
    ghostMesh.root.visible = false;
    rivalMesh.root.visible = false;
  }

  function stopRace() {
    if (!race) return;
    clearRace();
    setRival(null);
    hud.setMode('自分で運転');
    resetCar();
    touch.refresh();
    menu.refresh();
  }

  const toggleRace = (mode: RaceMode) => (race && raceMode === mode ? stopRace() : startRace(mode, true));
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
      { name: loadPlayerName().trim() || 'あなた', color: carMesh.color, isPlayer: true, timer: race, x: curr.x, z: curr.z },
      ...npcField.npcs.map((n) => ({ name: n.name, color: n.color, isPlayer: false, timer: n.timer, x: n.curr.x, z: n.curr.z })),
    ]);
  };

  const handleRaceEvents = (r: TimeAttack) => {
    for (const e of r.drainEvents()) {
      switch (e.type) {
        case 'count':
          raceHud.showReady(null);
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
          if (raceMode !== 'timeAttack') {
            const list = standings();
            if (raceMode === 'battle' && list[0]?.isPlayer) markRivalBeaten(battleRival().id);
            raceHud.showStandings(list, r.totalLaps, raceMode === 'battle');
            raceHud.showRankingButton(false);
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
          reportToRanking(merged.newTotal);
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
    // ランキングの人のゴーストは、そのコースでだけ一緒に走る
    setRival(null);
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
    menu.refresh();
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
  const selectCar = (index: number) => {
    carIndex = index;
    level.car.params = { ...vehicle().params };
    rebuildCarMesh();
    // ランキングの人のゴーストは、同じ車のときだけ一緒に走る
    setRival(null);
    hud.setCarName(vehicle().label);
    net.send({ t: 'profile', car: vehicle().id });
    net.updateJoin({ car: vehicle().id });
  };
  const cycleCar = () => {
    selectCar((carIndex + 1) % VEHICLE_PRESETS.length);
    resetCar();
    hud.toast(`車: ${vehicle().label}（最高 ${Math.round(vehicle().params.maxForwardSpeed * 3.6)}km/h）`);
  };

  // --- ランキング ---
  const board = serverUrl ? new LeaderboardClient(serverUrl) : null;
  const raceMaps = MAPS.filter((m) => m.race);
  /** まだランキングに送っていない自己ベストを送る（名前を入れていなければ送らない） */
  async function uploadBest(def: MapDefinition, car: string): Promise<SubmitResult | null> {
    const name = loadPlayerName().trim();
    const record = loadRecord(def.name, car);
    if (!board || !name || !record || record.ghost.length === 0 || uploadedTotal(def.id, car) === record.total) return null;
    return board.submit(def.id, car, { player: playerId(), name, total: record.total, laps: record.laps, ghost: record.ghost });
  }
  /** タイムアタックでゴールしたら、自己ベストをランキングに送って順位を結果に出す */
  function reportToRanking(newBest: boolean) {
    raceHud.showRankingButton(board !== null);
    if (!board) return;
    if (!loadPlayerName().trim()) {
      raceHud.setResultNote('名前を入れると、自己ベストがランキングに載ります（ランキングの画面で入力）');
      return;
    }
    if (!newBest) return;
    raceHud.setResultNote('ランキングに送っています…');
    uploadBest(level.def, vehicle().id).then(
      (r) => r && raceHud.setResultNote(r.rank !== null ? `ランキング ${r.rank}位` : `ランキングの上位には入りませんでした`),
      () => raceHud.setResultNote('ランキングに送れませんでした（通信エラー）'),
    );
  }
  /** ランキングで選んだ人のゴーストと、そのコース・車でタイムアタックする */
  function raceAgainst(course: string, car: string, r: NonNullable<typeof rival>) {
    const map = MAPS.findIndex((m) => m.id === course);
    const vehicleIndex = VEHICLE_PRESETS.findIndex((v) => v.id === car);
    if (vehicleIndex >= 0 && vehicleIndex !== carIndex) selectCar(vehicleIndex);
    if (map >= 0 && map !== mapIndex) {
      loadMap(map);
      net.send({ t: 'map', map: mapIndex });
    }
    startRace('timeAttack');
    setRival(r);
    hud.toast(`${r.name} さんのゴーストと対戦（${formatTime(r.total)}）`);
  }
  const rankingPanel = new RankingPanel(
    raceMaps.map((m) => ({ id: m.id, label: m.name })),
    VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label })),
    {
      load: async (course, car) => {
        const def = MAPS.find((m) => m.id === course);
        // 前に走った自己ベストも、名前を入れた後なら送る
        if (def) await uploadBest(def, car).catch(() => null);
        return { entries: await board!.list(course, car), mine: myEntryId(course, car) };
      },
      onRace: async (course, car, entry) => {
        const ghost = await board!.ghost(course, car, entry.id);
        raceAgainst(course, car, { name: entry.name, total: entry.total, ghost });
      },
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
      },
    },
  );
  function openRanking() {
    if (!board) {
      hud.toast('このサイトにはオンライン用のサーバーがまだ設定されていません');
      return;
    }
    rankingPanel.open(level.def.race ? level.def.id : raceMaps[0].id, vehicle().id);
  }
  const cycleCamera = () => {
    cameraRig.cycle();
    hud.setCameraName(cameraRig.modeName);
  };
  const toggleMute = () => {
    const muted = sound.toggleMute();
    hud.setMuted(muted);
  };
  // --- オンライン ---
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
        assignedColor = null;
        carMesh.setColor(carStyle(vehicle().id).color);
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
          assignedColor = PLAYER_COLORS[m.color % PLAYER_COLORS.length];
          carMesh.setColor(assignedColor);
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
  /** アクセルを踏みっぱなしか（スタートは踏み直したときだけにする） */
  let throttleHeld = false;

  const keyboard = new KeyboardInput();
  keyboard.onAction('KeyO', () => onlinePanel.open());
  keyboard.onAction('KeyL', openRanking);
  keyboard.onAction('KeyR', resetCar);
  keyboard.onAction('KeyT', () => toggleRace('timeAttack'));
  keyboard.onAction('KeyY', () => toggleRace('npc'));
  keyboard.onAction('KeyB', () => toggleRace('battle'));
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
      },
      { label: () => (race ? 'やり直す' : 'リセット'), run: resetCar },
    ],
    () => menu.open(),
  );

  // --- メニュー（スマホは ☰、パソコンは Esc）: 走り方・コース・車を一覧から選ぶ ---
  const raceModeId = () => (race ? raceMode : 'free');
  const menu = new GameMenu(
    [
      {
        title: '走り方',
        choices: () => [
          { id: 'free', label: '自由に走る' },
          { id: 'timeAttack', label: 'タイムアタック' },
          { id: 'npc', label: 'NPCと対戦' },
          { id: 'battle', label: 'ライバルとバトル' },
        ],
        selected: raceModeId,
        select: (id) => {
          if (id === raceModeId()) return;
          if (id === 'free') stopRace();
          else startRace(id as RaceMode, true);
        },
        detail: () => (race ? 'スタートの位置で、アクセルを踏むとカウントダウンが始まります' : ''),
      },
      {
        title: 'ライバル（1対1・得意なコースで勝負）',
        choices: () => {
          const beaten = loadBeatenRivals();
          return RIVALS.map((r) => {
            const car = VEHICLE_PRESETS.find((v) => v.id === r.car)?.label ?? r.car;
            const course = MAPS.find((m) => m.id === r.course)?.name ?? r.course;
            return { id: r.id, label: `${beaten.has(r.id) ? '✓ ' : ''}${r.name}`, note: `${car}・${course}` };
          });
        },
        selected: () => battleRival().id,
        select: (id) => {
          battleIndex = Math.max(0, RIVALS.findIndex((r) => r.id === id));
          startRace('battle', true);
        },
        visible: () => race !== null && raceMode === 'battle',
        detail: () => `${battleRival().team}・強さ ${rivalLevel(battleRival()).label}。自分の車は下の「車」で選べます（✓ は勝ったことのある相手）`,
      },
      {
        title: 'NPCの強さ',
        choices: () => NPC_LEVELS.map((l) => ({ id: l.id, label: l.label })),
        selected: () => NPC_LEVELS[npcLevelIndex].id,
        select: (id) => {
          npcLevelIndex = Math.max(0, NPC_LEVELS.findIndex((l) => l.id === id));
          if (race && raceMode === 'npc') startRace('npc');
        },
        visible: () => race !== null && raceMode === 'npc',
      },
      {
        title: 'マップ・コース',
        choices: () =>
          MAPS.filter((m) => !race || m.race).map((m) => ({
            id: m.id,
            label: m.name,
            note: m.race ? (m.race.laps > 1 ? `周回 ${m.race.laps}周` : '一本道') : '自由に走る',
          })),
        selected: () => level.def.id,
        select: (id) => {
          const index = MAPS.findIndex((m) => m.id === id);
          if (index < 0 || index === mapIndex) return;
          loadMap(index);
          // 同じ部屋の全員のマップも切り替える
          net.send({ t: 'map', map: mapIndex });
        },
      },
      {
        title: '車',
        choices: () => VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, note: `最高 ${Math.round(v.params.maxForwardSpeed * 3.6)}km/h` })),
        detail: () => vehicle().description,
        selected: () => vehicle().id,
        select: (id) => {
          const index = VEHICLE_PRESETS.findIndex((v) => v.id === id);
          if (index < 0 || index === carIndex) return;
          selectCar(index);
          resetCar();
        },
      },
    ],
    [
      { label: () => 'ランキング（ゴーストと対戦）', run: () => openRanking(), visible: () => board !== null, closeOnRun: true },
      { label: () => 'みんなで走る', run: () => onlinePanel.open(), closeOnRun: true },
      { label: () => `カメラ: ${cameraRig.modeName}`, run: () => cycleCamera() },
      { label: () => `ハンドル: ${touch.steerMode === 'tilt' ? '傾ける' : 'なぞる'}`, run: () => void toggleSteerMode(), visible: () => touch.isShown },
      { label: () => '全画面で遊ぶ', run: () => void enterFullscreen(), visible: () => canRequestFullscreen() && !isFullscreen() && !isStandalone() },
      { label: () => `サウンド: ${sound.isMuted ? 'OFF' : 'ON'}`, run: toggleMute },
    ],
    {
      info: () => `${level.def.name}・${race ? raceLabel() : '自分で運転'}・${vehicle().label}`,
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
      },
      canOpen: () => !onlinePanel.isOpen && !rankingPanel.isOpen,
    },
  );
  touch.refresh();
  // iPhone の Safari はページから全画面にできないので、ホーム画面に追加する方法を案内する
  document.getElementById('touch-install')!.classList.toggle('hidden', !needsHomeScreenForFullscreen());

  async function toggleSteerMode() {
    const next = touch.steerMode === 'tilt' ? 'drag' : 'tilt';
    const ok = await touch.setSteerMode(next);
    if (next === 'tilt') hud.toast(ok ? '傾けてハンドル。今の持ち方がまっすぐです' : 'この端末では傾きを使えません');
    touch.refresh();
    menu.refresh();
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
      // スタートの位置で待っている間は、アクセルを踏み直したらカウントダウンを始める
      if (race?.phase === 'ready' && input.throttle > 0 && !throttleHeld) beginRace();
      throttleHeld = input.throttle > 0;
      // カウントダウン中は発進させない（ハンドルだけ切れる）
      if (race && !race.canDrive) input = { ...NEUTRAL_INPUT, steer: input.steer };
      if (fall.falling) input = NEUTRAL_INPUT;
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
      switch (fall.update(dt, level, level.car, curr)) {
        case 'fell':
          hud.toast('コースアウト！');
          sound.impact(6);
          break;
        case 'recovered':
          prev = curr = level.car.snapshot();
          cameraRig.snap();
          remoteCars.ghost(performance.now());
          break;
      }
      // 草地を走るとガタガタ揺れる
      const grass = level.car.offRoad?.(curr.x, curr.z) ?? 0;
      if (grass > 0 && !fall.falling) cameraRig.addShake(grass * Math.min(1, Math.abs(curr.forwardSpeed) / 15) * 0.6);
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
      s.y -= fall.drop;
      carMesh.update(s);
      remoteCars.render(performance.now());
      npcField?.render(alpha);
      if (race) {
        const pose = best ? ghostPoseAt(best.ghost, Math.max(0, race.time)) : null;
        const list = npcField ? standings() : null;
        const rank = list ? { list, index: list.findIndex((e) => e.isPlayer) } : null;
        ghostMesh.root.visible = pose !== null;
        if (pose) ghostMesh.update(ghostSnapshot(pose));
        const rivalPose = rival && raceMode === 'timeAttack' ? ghostPoseAt(rival.ghost, Math.max(0, race.time)) : null;
        rivalMesh.root.visible = rivalPose !== null;
        if (rivalPose) rivalMesh.update(ghostSnapshot(rivalPose));
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
          field: rank?.list,
          rival: rival && raceMode === 'timeAttack' ? { name: rival.name, total: rival.total } : undefined,
        });
        // ゴールした後も、まだ走っている NPC がゴールするたびに順位表を更新する
        if (rank && race.phase === 'finished') raceHud.showStandings(rank.list, race.totalLaps, raceMode === 'battle');
        const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
        minimap.draw([
          ...(pose ? [{ x: pose.x, z: pose.z, color: '#7fd4ff' }] : []),
          ...(rivalPose ? [{ x: rivalPose.x, z: rivalPose.z, color: '#ffa040' }] : []),
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
      __game: { getLevel: () => level, getRace: () => race, getNpcs: () => npcField, startTimeAttack: () => startRace('timeAttack'), startNpcRace: () => startRace('npc'), stopRace, openRanking, rankingPanel, net, remoteCars, touch, onlinePanel, cameraRig, sound },
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
