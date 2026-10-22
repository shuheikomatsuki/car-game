import { SoundSystem } from './audio/sound';
import { GamepadInput, KeyboardInput, PAD_BUTTON, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { Airborne } from './game/airborne';
import { TIMES_OF_DAY, type TimeOfDay, WEATHERS, type Weather, loadEnvironment, paramsForWeather, saveEnvironment } from './game/environment';
import { FallRecovery } from './game/fall';
import { Level } from './game/level';
import { NpcField, npcEntries, rankEntrants, velocityOf } from './game/npcRace';
import { PLAYER_COLORS, RemoteCars, carStateOf, createLabel } from './game/remoteCars';
import { MAPS } from './map/maps';
import type { MapDefinition } from './map/tilemap';
import { NetClient } from './net/client';
import { type SubmitResult, mergeBoards } from './net/leaderboard';
import { LeaderboardClient, myEntryId, playerId, uploadedTotal } from './net/leaderboardClient';
import { type GhostData, type GhostPose, GhostRecorder, ghostPoseAt } from './race/ghost';
import { NPC_LEVELS } from './race/npcDriver';
import { RIVALS, loadBeatenRivals, markRivalBeaten, rivalLevel } from './race/rivals';
import { CHASE_START_GAP, type Runner, SAFE_SECONDS, SuddenDeath } from './race/suddenDeath';
import { type RaceRecord, loadRecord, mergeRecord, saveRecord } from './race/records';
import { TimeAttack, formatTime } from './race/timeAttack';
import { isRoomCode, normalizeRoomCode } from './net/protocol';
import { CameraRig } from './render/camera';
import { CarMesh, carStyle } from './render/carMesh';
import { createGhostMesh } from './render/raceMesh';
import { GameScene } from './render/scene';
import type { CarSnapshot, Spawn } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS } from './sim/vehicle';
import { Hud, hideLoading, showError } from './ui/hud';
import { OnlinePanel, loadPlayerName } from './ui/onlinePanel';
import { ALL_CARS, RankingPanel } from './ui/rankingPanel';
import { Minimap } from './ui/minimap';
import { GameMenu, type MenuMode, type MenuScreen } from './ui/menu';
import { RaceHud } from './ui/raceHud';
import { canRequestFullscreen, enterFullscreen, isFullscreen, isStandalone, needsHomeScreenForFullscreen } from './ui/fullscreen';
import { TouchControls, prefersTouch } from './ui/touchControls';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;
/** 段差から着地したときに、この下向きの速さ [m/s] 以上なら音・揺れを出す */
const LANDING_THRESHOLD = 3;
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
/** ライバルとのバトルのルール: 横に並んでスタート・先行後追い（自分が先行から／後追いから） */
type BattleRule = 'side' | 'leadFirst' | 'chaseFirst';

const BATTLE_RULES: readonly { id: BattleRule; label: string; note: string }[] = [
  { id: 'side', label: '横に並んでスタート', note: '先にゴールしたほうの勝ち' },
  { id: 'leadFirst', label: '先行後追い（自分が先行）', note: 'サドンデス方式' },
  { id: 'chaseFirst', label: '先行後追い（自分が後追い）', note: 'サドンデス方式' },
];

/** 引き分けのあと、次の1本を始めるまでの時間 [ms] */
const NEXT_ROUND_DELAY = 3500;

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
  // 時間帯と天気（?time=night&weather=rain のように指定もできる）
  const env = loadEnvironment();
  const timeParam = TIMES_OF_DAY.find((t) => t.id === params.get('time'));
  const weatherParam = WEATHERS.find((w) => w.id === params.get('weather'));
  if (timeParam) env.time = timeParam.id;
  if (weatherParam) env.weather = weatherParam.id;
  view.setEnvironment(env);
  /** いまの天気での自分の車の性能（雨は滑りやすい） */
  const carParams = () => paramsForWeather(vehicle().params, env.weather);
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
  level.car.params = carParams();
  view.scene.add(level.group);
  let prev = level.car.snapshot();
  let curr = prev;
  let input = { ...NEUTRAL_INPUT };
  /** 峠で道路から落ちたとき */
  const fall = new FallRecovery();
  /** 段差で宙に浮いたとき */
  const air = new Airborne();
  const groundAt = (s: CarSnapshot) => level.heightAt(s.x, s.z, s.courseS, s.yaw);

  const remoteCars = new RemoteCars(view.scene);
  remoteCars.attachLevel(level);

  // --- タイムアタック・NPC 対戦 ---
  let race: TimeAttack | null = null;
  /** いま走っているレースの種類 */
  let raceMode: RaceMode = 'timeAttack';
  /** ライバルとのバトルの相手（RIVALS の番号） */
  let battleIndex = 0;
  const battleRival = () => RIVALS[battleIndex];
  /** バトルのルール */
  let battleRule: BattleRule = 'side';
  /** 先行後追いのバトルの進行（それ以外のレースでは null） */
  let suddenDeath: SuddenDeath | null = null;
  let nextRoundTimer: number | undefined;
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
  /** ゴーストのコース上の距離（立体交差のどちらの道を走っているかを、前の位置から追う） */
  const ghostCourseS = { best: null as number | null, rival: null as number | null };
  const ghostSnapshot = (p: GhostPose, which: keyof typeof ghostCourseS): CarSnapshot => {
    const courseS = level.locate(p.x, p.z, p.yaw, ghostCourseS[which]);
    ghostCourseS[which] = courseS;
    return level.ground({ x: p.x, y: 0.05, z: p.z, yaw: p.yaw, forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0, wheelSpin: 0, ...(courseS !== null ? { courseS } : {}) });
  };
  const raceMapIndex = MAPS.findIndex((m) => m.race);
  const minimap = new Minimap(document.getElementById('minimap')!);
  const raceHud = new RaceHud({
    onRetry: () => race && startRace(raceMode),
    onQuit: () => stopRace(),
    onRanking: () => openRanking(),
  });

  const placeCar = (spawn: Spawn) => {
    level.car.reset(spawn);
    fall.cancel();
    prev = curr = level.car.snapshot();
    air.reset(groundAt(curr));
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
    raceMode === 'npc'
      ? `NPC対戦（${NPC_LEVELS[npcLevelIndex].label}）`
      : raceMode === 'battle'
        ? `バトル（${battleRival().name}${battleRule === 'side' ? '' : '・先行後追い'}）`
        : 'タイムアタック';

  /**
   * レース用のコースのスタートラインの手前に並び、カウントダウンから始める。
   * いまのマップがレース用でなければサーキットへ移動する。NPC 対戦では NPC が前に並び、自分は最後尾から。
   * ライバルとのバトルは、ライバルと横に並ぶ。toHome ならライバルの得意なコースへ移動する（他のコースでもバトルできる）
   */
  function startRace(mode: RaceMode, toHome = false, nextRound = false) {
    raceMode = mode;
    window.clearTimeout(nextRoundTimer);
    // 先行後追いは、引き分けで次の1本へ進むときだけ続きから。それ以外は1本目から
    suddenDeath = mode === 'battle' && battleRule !== 'side' ? (nextRound && suddenDeath ? suddenDeath : new SuddenDeath(battleRule === 'leadFirst')) : null;
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
    // 先行後追いは周回コースでも1周で1本
    const laps = suddenDeath ? 1 : level.def.race!.laps;
    // アクセルを踏むまでカウントダウンを始めない（自分のタイミングでスタートする）
    race = new TimeAttack(course, laps, true);
    ghostRecorder = new GhostRecorder();
    ghostCourseS.best = ghostCourseS.rival = 0;
    // NPC 対戦ではゴーストを出さず、記録も残さない
    best = mode === 'timeAttack' ? loadRecord(level.def.name, vehicle().id) : null;
    // 2列に互い違いに並ぶ。道幅に合わせて左右の間隔を決める
    const side = Math.min(3, course.widthAt(0) / 4);
    const slot = (i: number) => course.gridSpot(6 + 7 * i, i % 2 === 0 ? side : -side);
    if (mode === 'npc') {
      const grid = Array.from({ length: NPC_COUNT }, (_, i) => slot(i));
      npcField = new NpcField(level, view.scene, npcEntries(NPC_COUNT, NPC_LEVELS[npcLevelIndex], carParams(), carStyle(vehicle().id)), laps, grid);
      placeCar(slot(NPC_COUNT));
    } else if (mode === 'battle') {
      const r = battleRival();
      const preset = VEHICLE_PRESETS.find((v) => v.id === r.car) ?? VEHICLE_PRESETS[0];
      const style = carStyle(preset.id);
      const entry = { name: r.name, color: style.color, level: rivalLevel(r), params: paramsForWeather(preset.params, env.weather), style, variation: 1 };
      if (suddenDeath) {
        // 先行が前、後追いはその後ろに同じ列で並ぶ
        const lead = course.gridSpot(6);
        const chase = course.gridSpot(6 + CHASE_START_GAP);
        npcField = new NpcField(level, view.scene, [entry], laps, [suddenDeath.playerLeads ? chase : lead]);
        placeCar(suddenDeath.playerLeads ? lead : chase);
      } else {
        npcField = new NpcField(level, view.scene, [entry], laps, [course.gridSpot(6, side)]);
        placeCar(course.gridSpot(6, -side));
      }
    } else {
      placeCar(course.gridSpot(6));
    }
    raceHud.show(true);
    const go = touch.isShown ? 'アクセルを押すとスタート' : 'アクセル（W / ↑）でスタート';
    raceHud.showReady(suddenDeath ? `${suddenDeath.round}本目・あなたが${suddenDeath.playerLeads ? '先行' : '後追い'}　${go}` : go);
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
    suddenDeath = null;
    window.clearTimeout(nextRoundTimer);
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
          // 先行後追いの勝ち負けは judgeSuddenDeath で決める
          if (suddenDeath) break;
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

  /** 先行後追いの1本の走り（自分と、NPC のライバル） */
  const runners = (): { player: Runner; rival: Runner } | null => {
    const npc = npcField?.npcs[0];
    if (!race || !npc) return null;
    return {
      player: { distance: race.distance(curr.x, curr.z), finishTime: race.phase === 'finished' ? race.time : null },
      rival: { distance: npc.timer.distance(npc.curr.x, npc.curr.z), finishTime: npc.timer.phase === 'finished' ? npc.timer.time : null },
    };
  };

  /** 先行後追いの判定。決着がついたら結果を出し、引き分けなら先行と後追いを入れ替えて次の1本へ */
  const judgeSuddenDeath = () => {
    const sd = suddenDeath;
    const r = runners();
    if (!sd || !r || race?.phase === 'ready' || race?.phase === 'countdown') return;
    // ゴールした側の時計は止まるので、まだ走っている側の時計で測る
    const npc = npcField!.npcs[0];
    const outcome = sd.update(r.player, r.rival, Math.max(race!.time, npc.timer.time));
    if (!outcome) return;
    const name = battleRival().name;
    const lead = sd.playerLeads ? 'あなた' : name;
    const chase = sd.playerLeads ? name : 'あなた';
    sound.beep(true);
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    raceHud.showRankingButton(false);
    if (outcome === 'draw') {
      raceHud.showBattleResult(
        `${sd.round}本目は引き分け`,
        `${chase}（後追い）が ${SAFE_SECONDS}秒以内に続いてゴールし、抜くこともできませんでした。先行と後追いを入れ替えて、${sd.round + 1}本目へ…`,
      );
      nextRoundTimer = window.setTimeout(() => {
        if (suddenDeath !== sd) return;
        sd.nextRound();
        startRace('battle', false, true);
      }, NEXT_ROUND_DELAY);
      return;
    }
    const why = outcome === 'leadWins' ? `${lead}（先行）が ${SAFE_SECONDS}秒より大きな差をつけてゴールした` : `${chase}（後追い）が抜いて先にゴールした`;
    const won = sd.winner === 'player';
    if (won) markRivalBeaten(battleRival().id);
    raceHud.showBattleResult(won ? `勝利！ ${name} に勝った` : `敗北… ${name} の勝ち`, `${sd.round}本目で決着：${why}`);
  };

  /** 先行後追いの走行中の表示（何本目・先行か後追いか・差） */
  const battleInfo = (): string | undefined => {
    const sd = suddenDeath;
    const r = runners();
    if (!sd || !r) return undefined;
    const gap = Math.max(0, Math.round(sd.gap(r.player, r.rival)));
    return `${sd.round}本目・あなたが${sd.playerLeads ? '先行' : '後追い'}　差 ${gap}m（ゴールで ${SAFE_SECONDS}秒より離れたら先行の勝ち）`;
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
    level.car.params = carParams();
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
    level.car.params = carParams();
    rebuildCarMesh();
    // ランキングの人のゴーストは、同じ車のときだけ一緒に走る
    setRival(null);
    hud.setCarName(vehicle().label);
    net.send({ t: 'profile', car: vehicle().id });
    net.updateJoin({ car: vehicle().id });
  };
  /** 時間帯・天気を変える。天気で車の性能が変わるので、レース中ならやり直す */
  const setEnvironment = (time: TimeOfDay, weather: Weather, restart = true) => {
    const weatherChanged = weather !== env.weather;
    env.time = time;
    env.weather = weather;
    saveEnvironment(env);
    view.setEnvironment(env);
    if (!weatherChanged) return;
    level.car.params = carParams();
    if (race && restart) startRace(raceMode);
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
        const cars = car === ALL_CARS ? VEHICLE_PRESETS.map((v) => v.id) : [car];
        const boards = await Promise.all(
          cars.map(async (id) => {
            // 前に走った自己ベストも、名前を入れた後なら送る
            if (def) await uploadBest(def, id).catch(() => null);
            return { car: id, entries: await board!.list(course, id) };
          }),
        );
        const mine = new Set(cars.map((id) => myEntryId(course, id)).filter((id): id is string => id !== null));
        return { entries: mergeBoards(boards), mine };
      },
      onRace: async (course, entry) => {
        const ghost = await board!.ghost(course, entry.car, entry.id);
        raceAgainst(course, entry.car, { name: entry.name, total: entry.total, ghost });
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
    rankingPanel.open(level.def.race ? level.def.id : raceMaps[0].id, ALL_CARS);
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

  // --- メニュー（スマホは ☰、パソコンは Esc）: プレイモードを選び、コース・対戦相手・車などを順に選ぶ ---
  /** メニューで選んでいる途中の内容（最後に「スタート」を押したときに反映する） */
  const draft = {
    map: level.def.id,
    car: vehicle().id,
    npc: NPC_LEVELS[npcLevelIndex].id,
    rival: battleRival().id,
    rule: battleRule as BattleRule,
    time: env.time,
    weather: env.weather,
  };
  const draftMap = () => MAPS.find((m) => m.id === draft.map) ?? MAPS[0];
  const draftCar = () => VEHICLE_PRESETS.find((v) => v.id === draft.car) ?? VEHICLE_PRESETS[0];
  const draftRival = () => RIVALS.find((r) => r.id === draft.rival) ?? RIVALS[0];
  const draftNpc = () => NPC_LEVELS.find((l) => l.id === draft.npc) ?? NPC_LEVELS[0];
  const carLabel = (id: string) => VEHICLE_PRESETS.find((v) => v.id === id)?.label ?? id;
  const mapLabel = (id: string) => MAPS.find((m) => m.id === id)?.name ?? id;
  const levelNote = (l: (typeof NPC_LEVELS)[number]) =>
    `カーブの速さ ${Math.round(l.grip * 100)}%・ブレーキ ${Math.round(l.brake * 100)}%・ライン取り ${Math.round(l.line * 100)}%・最高速 ${Math.round(l.topSpeed * 100)}%`;
  /** 選び始めるときに、下書きを今の状態にする（レースならレース用のコースから選ぶ） */
  const beginDraft = (raceOnly: boolean) => {
    draft.map = raceOnly && !level.def.race ? raceMaps[0].id : level.def.id;
    draft.car = vehicle().id;
    draft.npc = NPC_LEVELS[npcLevelIndex].id;
    draft.rival = battleRival().id;
    draft.rule = battleRule;
    draft.time = env.time;
    draft.weather = env.weather;
  };
  /** 選んだ内容を反映して、そのモードで始める */
  const applyDraft = (mode: RaceMode | 'free') => {
    setEnvironment(draft.time, draft.weather, false);
    const car = VEHICLE_PRESETS.findIndex((v) => v.id === draft.car);
    if (car >= 0 && car !== carIndex) selectCar(car);
    npcLevelIndex = Math.max(0, NPC_LEVELS.findIndex((l) => l.id === draft.npc));
    battleIndex = Math.max(0, RIVALS.findIndex((r) => r.id === draft.rival));
    battleRule = draft.rule;
    if (mode === 'free') stopRace();
    const map = MAPS.findIndex((m) => m.id === draft.map);
    if (map >= 0 && map !== mapIndex) {
      loadMap(map);
      // 同じ部屋の全員のマップも切り替える
      net.send({ t: 'map', map: mapIndex });
    }
    if (mode !== 'free') startRace(mode);
    else resetCar();
  };

  const courseScreen = (raceOnly: boolean, home?: string): MenuScreen => ({
    title: 'コース',
    groups: [
      {
        choices: () => {
          const maps = MAPS.filter((m) => !raceOnly || m.race);
          // ライバルの得意なコースを先頭に
          if (home) maps.sort((a, b) => Number(b.id === home) - Number(a.id === home));
          return maps.map((m) => ({
            id: m.id,
            label: `${m.id === home ? '★ ' : ''}${m.name}`,
            note: m.id === home ? '得意なコース' : m.race ? (m.elevation ? '一本道' : `周回 ${m.race.laps}周`) : '自由に走る',
          }));
        },
        selected: () => draft.map,
        select: (id) => (draft.map = id),
        detail: () => (home ? '★ はライバルの得意なコース。先行後追いは周回コースでも1周で1本です' : ''),
      },
    ],
  });
  const carScreen: MenuScreen = {
    title: '自分の車',
    groups: [
      {
        choices: () => VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, note: `最高 ${Math.round(v.params.maxForwardSpeed * 3.6)}km/h` })),
        selected: () => draft.car,
        select: (id) => (draft.car = id),
        detail: () => draftCar().description,
      },
    ],
  };
  const npcScreen: MenuScreen = {
    title: 'NPCの強さ',
    groups: [
      {
        choices: () => NPC_LEVELS.map((l) => ({ id: l.id, label: l.label })),
        selected: () => draft.npc,
        select: (id) => (draft.npc = id),
        detail: () => `${draftNpc().label}: ${levelNote(draftNpc())}`,
      },
    ],
  };
  const rivalScreen: MenuScreen = {
    title: '対戦相手',
    groups: [
      {
        choices: () => {
          const beaten = loadBeatenRivals();
          return RIVALS.map((r) => ({
            id: r.id,
            label: `${beaten.has(r.id) ? '✓ ' : ''}${r.name}`,
            note: `${carLabel(r.car)}・${rivalLevel(r).label}`,
          }));
        },
        selected: () => draft.rival,
        select: (id) => {
          draft.rival = id;
          // コースは、まずライバルの得意なコースにしておく（次の画面で変えられる）
          draft.map = draftRival().course;
        },
        detail: () => {
          const r = draftRival();
          return `${r.team}・${carLabel(r.car)}・得意なコース「${mapLabel(r.course)}」・強さ ${rivalLevel(r).label}（✓ は勝ったことのある相手）`;
        },
      },
    ],
  };
  const ruleScreen: MenuScreen = {
    title: 'ルール',
    groups: [
      {
        choices: () => BATTLE_RULES,
        selected: () => draft.rule,
        select: (id) => (draft.rule = id as BattleRule),
        detail: () =>
          draft.rule === 'side'
            ? '2台が横に並んでスタートし、先にゴールしたほうの勝ち'
            : `先行と後追いに分かれて1本ずつ走り、ゴールの時点で判定する。後追いが抜いて先にゴールすれば後追いの勝ち、後追いが先行から ${SAFE_SECONDS}秒より遅れてゴールすれば先行の勝ち。${SAFE_SECONDS}秒以内に続いてゴールすれば引き分けで、先行と後追いを入れ替えて次の1本へ`,
      },
    ],
  };
  const envScreen: MenuScreen = {
    title: '時間帯・天気',
    groups: [
      {
        title: '時間帯',
        choices: () => TIMES_OF_DAY,
        selected: () => draft.time,
        select: (id) => (draft.time = id as TimeOfDay),
      },
      {
        title: '天気',
        choices: () => WEATHERS,
        selected: () => draft.weather,
        select: (id) => (draft.weather = id as Weather),
        detail: () => (draft.weather === 'rain' ? '雨の日はタイヤが滑りやすく、ブレーキも効きにくくなります' : ''),
      },
    ],
  };
  const envSummary = () => `${TIMES_OF_DAY.find((t) => t.id === draft.time)!.label}・${WEATHERS.find((w) => w.id === draft.weather)!.label}`;
  const menuModes: MenuMode[] = [
    {
      id: 'free',
      label: '自由に走る',
      note: '好きなマップを自由にドライブ',
      begin: () => beginDraft(false),
      screens: () => [courseScreen(false), carScreen, envScreen],
      summary: () => `${draftMap().name}・${draftCar().label}・${envSummary()}`,
      finish: () => applyDraft('free'),
    },
    {
      id: 'timeAttack',
      label: 'タイムアタック',
      note: '自己ベストとゴーストに挑戦',
      begin: () => beginDraft(true),
      screens: () => [courseScreen(true), carScreen, envScreen],
      summary: () => `${draftMap().name}・${draftCar().label}・${envSummary()}`,
      finish: () => applyDraft('timeAttack'),
    },
    {
      id: 'npc',
      label: 'NPCと対戦',
      note: `${NPC_COUNT}台のNPCとレース`,
      begin: () => beginDraft(true),
      screens: () => [courseScreen(true), npcScreen, carScreen, envScreen],
      summary: () => `${draftMap().name}・NPC ${draftNpc().label}・${draftCar().label}・${envSummary()}`,
      finish: () => applyDraft('npc'),
    },
    {
      id: 'battle',
      label: 'ライバルとバトル',
      note: '1対1。先行後追いも選べる',
      begin: () => {
        beginDraft(true);
        draft.map = draftRival().course;
      },
      screens: () => [rivalScreen, ruleScreen, courseScreen(true, draftRival().course), carScreen, envScreen],
      summary: () => `VS ${draftRival().name}・${BATTLE_RULES.find((r) => r.id === draft.rule)!.label}・${draftMap().name}・${draftCar().label}・${envSummary()}`,
      finish: () => applyDraft('battle'),
    },
  ];
  const menu = new GameMenu(
    menuModes,
    [
      { label: () => 'やり直す', run: () => race && startRace(raceMode), visible: () => race !== null, closeOnRun: true },
      { label: () => 'レースをやめる', run: () => stopRace(), visible: () => race !== null, closeOnRun: true },
      { label: () => 'ランキング（ゴーストと対戦）', run: () => openRanking(), visible: () => board !== null, closeOnRun: true },
      { label: () => 'みんなで走る', run: () => onlinePanel.open(), closeOnRun: true },
      { label: () => `カメラ: ${cameraRig.modeName}`, run: () => cycleCamera() },
      { label: () => `ハンドル: ${touch.steerMode === 'tilt' ? '傾ける' : 'なぞる'}`, run: () => void toggleSteerMode(), visible: () => touch.isShown },
      { label: () => '全画面で遊ぶ', run: () => void enterFullscreen(), visible: () => canRequestFullscreen() && !isFullscreen() && !isStandalone() },
      { label: () => `サウンド: ${sound.isMuted ? 'OFF' : 'ON'}`, run: toggleMute },
    ],
    {
      info: () =>
        `いま: ${level.def.name}・${race ? raceLabel() : '自分で運転'}・${vehicle().label}・${TIMES_OF_DAY.find((t) => t.id === env.time)!.label}・${WEATHERS.find((w) => w.id === env.weather)!.label}`,
      currentMode: () => (race ? raceMode : 'free'),
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
          air.reset(groundAt(curr));
          cameraRig.snap();
          remoteCars.ghost(performance.now());
          break;
      }
      // 段差で浮いている間はタイヤが効かない。強く着地したら音と揺れ
      const landing = air.update(dt, groundAt(curr));
      level.car.airborne = air.inAir && !fall.falling;
      if (landing !== null && landing > LANDING_THRESHOLD) {
        sound.impact(landing);
        cameraRig.addShake(landing * 0.25);
      }
      // 草地を走るとガタガタ揺れる
      const grass = level.car.offRoad?.(curr.x, curr.z) ?? 0;
      if (grass > 0 && !fall.falling) cameraRig.addShake(grass * Math.min(1, Math.abs(curr.forwardSpeed) / 15) * 0.6);
      // 荒れた路面でも小刻みに揺れる
      const rough = level.roughnessAt(curr.x, curr.z, curr.courseS);
      if (rough > 0 && !fall.falling) cameraRig.addShake(rough * Math.min(1, Math.abs(curr.forwardSpeed) / 25) * 0.3);
      if (race) {
        const r = race;
        r.update(dt, { x: curr.x, z: curr.z, ...velocityOf(curr) });
        if (r.phase === 'racing') ghostRecorder.sample(r.time, curr);
        handleRaceEvents(r);
        judgeSuddenDeath();
      }
      // タブが裏に回っている間は送らない（他の人からは止まって見え、やがて放置として部屋から外れる）
      if (net.isOnline && !document.hidden && ++stepCount % SEND_EVERY_STEPS === 0) {
        net.send({ t: 'state', time: performance.now(), s: carStateOf(curr) });
      }

    },
    (alpha, frameDt) => {
      const s = level.ground(lerpSnapshot(prev, curr, alpha));
      s.y += air.gap - fall.drop;
      carMesh.update(s);
      view.followCar(carMesh.root);
      remoteCars.render(performance.now());
      npcField?.render(alpha);
      if (race) {
        const pose = best ? ghostPoseAt(best.ghost, Math.max(0, race.time)) : null;
        const list = npcField ? standings() : null;
        const rank = list ? { list, index: list.findIndex((e) => e.isPlayer) } : null;
        ghostMesh.root.visible = pose !== null;
        if (pose) ghostMesh.update(ghostSnapshot(pose, 'best'));
        const rivalPose = rival && raceMode === 'timeAttack' ? ghostPoseAt(rival.ghost, Math.max(0, race.time)) : null;
        rivalMesh.root.visible = rivalPose !== null;
        if (rivalPose) rivalMesh.update(ghostSnapshot(rivalPose, 'rival'));
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
          battle: battleInfo(),
        });
        // ゴールした後も、まだ走っている NPC がゴールするたびに順位表を更新する（先行後追いは別の結果）
        if (rank && race.phase === 'finished' && !suddenDeath) raceHud.showStandings(rank.list, race.totalLaps, raceMode === 'battle');
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
      view.update(frameDt, cameraRig.camera);
      hud.update(s);
      sound.update(s.forwardSpeed, input.throttle, s.lateralSpeed, input.brake > 0 && s.forwardSpeed > 0);
      view.render(cameraRig.camera);
    },
  );

  // ?debug を付けるとブラウザの開発者ツールや自動テストから状態を触れる
  if (params.has('debug')) {
    Object.assign(window, {
      __game: { getLevel: () => level, getRace: () => race, getNpcs: () => npcField, getSuddenDeath: () => suddenDeath, menu, startTimeAttack: () => startRace('timeAttack'), startNpcRace: () => startRace('npc'), stopRace, openRanking, rankingPanel, net, remoteCars, touch, onlinePanel, cameraRig, sound },
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
