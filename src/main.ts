import { SoundSystem } from './audio/sound';
import { BGM_TRACKS, BgmPlayer } from './audio/bgm';
import { GamepadInput, KeyboardInput, PAD_BUTTON, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { Airborne } from './game/airborne';
import { TIMES_OF_DAY, type TimeOfDay, WEATHERS, type Weather, loadEnvironment, paramsForWeather, saveEnvironment } from './game/environment';
import { FallRecovery } from './game/fall';
import { Level } from './game/level';
import { clearPlayData } from './game/playData';
import { NpcField, npcEntries, rankEntrants, velocityOf } from './game/npcRace';
import { PLAYER_COLORS, RemoteCars, carStateOf, createLabel } from './game/remoteCars';
import { MAPS, TITLE_MAPS } from './map/maps';
import type { MapDefinition } from './map/tilemap';
import { NetClient } from './net/client';
import { type SubmitResult, mergeBoards } from './net/leaderboard';
import { LeaderboardClient, myEntryId, playerId, uploadedTotal } from './net/leaderboardClient';
import { type GhostData, type GhostPose, GhostRecorder, ghostPoseAt } from './race/ghost';
import { NPC_LEVELS } from './race/npcDriver';
import { RIVALS, type Rival, loadBeatenRivals, markRivalBeaten, rivalLevel } from './race/rivals';
import { type BattleContext, BattleDialogue, type BattleEvent, OvertakeWatcher, type RivalDialogue, dialogueApplies, sceneLines } from './race/dialogue';
import { CHARACTERS, RIVAL_DIALOGUES } from './race/dialogueScript';
import { CHASE_START_GAP, type Runner, SAFE_SECONDS, SuddenDeath } from './race/suddenDeath';
import { type RaceRecord, loadRecord, mergeRecord, saveRecord } from './race/records';
import { TimeAttack, formatTime } from './race/timeAttack';
import { type RaceSettings, type RaceState, isRoomCode, normalizeRoomCode } from './net/protocol';
import { EMOTES } from './game/emotes';
import { attachBubble } from './render/bubble';
import { lapsDone, rankOnline, standingsWindow } from './race/onlineRace';
import { OnlineRacePanel } from './ui/onlineRacePanel';
import { CameraRig } from './render/camera';
import { CarMesh, carStyle } from './render/carMesh';
import { createGhostMesh } from './render/raceMesh';
import { GameScene } from './render/scene';
import { nearestLit } from './game/headlights';
import { MIRROR_MODES, Mirrors, centeredRegion, loadMirrorMode, saveMirrorMode } from './render/mirrors';
import type { CarSnapshot, Spawn } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS, topSpeedOf } from './sim/vehicle';
import { Hud, hideLoading, showError } from './ui/hud';
import { OnlinePanel, loadPlayerName } from './ui/onlinePanel';
import { ALL_CARS, RankingPanel } from './ui/rankingPanel';
import { Minimap, type MinimapMarker } from './ui/minimap';
import { GameMenu, type MenuGroup, type MenuItem, type MenuMode, type MenuScreen } from './ui/menu';
import { carDetail, conditionsDetail, courseDetail, npcDetail, rivalDetail, textDetail } from './ui/menuDetails';
import { courseProfile } from './ui/courseInfo';
import { driveOf } from './ui/carStats';
import { CarPreview } from './render/carPreview';
import { RaceHud } from './ui/raceHud';
import { canRequestFullscreen, enterFullscreen, isFullscreen, isStandalone, needsHomeScreenForFullscreen } from './ui/fullscreen';
import { TouchControls, prefersTouch } from './ui/touchControls';
import { type Speaker, Subtitles } from './ui/subtitles';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;
/** セリフの 'crash'（壁に強くぶつかった）とみなす衝突の強さ [m/s] */
const CRASH_THRESHOLD = 7;
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

/** レースの種類（タイムアタック・NPC 対戦・ライバルとのバトル・部屋のみんなとのオンライン対戦） */
type RaceMode = 'timeAttack' | 'npc' | 'battle' | 'online';
/** ライバルとのバトルのルール: 横に並んでスタート・先行後追い（自分が先行から／後追いから） */
type BattleRule = 'side' | 'leadFirst' | 'chaseFirst';

const BATTLE_RULES: readonly { id: BattleRule; label: string; note: string }[] = [
  { id: 'side', label: '横に並んでスタート', note: '先にゴールしたほうの勝ち' },
  { id: 'leadFirst', label: '先行後追い（自分が先行）', note: 'サドンデス方式' },
  { id: 'chaseFirst', label: '先行後追い（自分が後追い）', note: 'サドンデス方式' },
];

/** 引き分けのあと、次の1本を始めるまでの時間 [ms] */
const NEXT_ROUND_DELAY = 3500;
/** クラクションの音が届く距離 [m]（遠い車ほど小さく聞こえる） */
const HORN_RANGE = 160;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** 他の人のクラクションの「止める」が届かなかったときに止めるまでの時間 [ms] */
const HORN_MAX_MS = 4000;
/** エモートを続けて送れる間隔 [ms] */
const EMOTE_COOLDOWN_MS = 1500;

async function main() {
  const rapier = await loadRapier();
  const params = new URLSearchParams(location.search);
  // オンライン用のサーバー（みんなで走る・ランキング）
  const serverUrl: string = params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? '';

  const view = new GameScene(document.getElementById('app')!);
  const cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
  const hud = new Hud();
  const sound = new SoundSystem();
  const bgm = new BgmPlayer(BGM_TRACKS);
  window.addEventListener('resize', () => view.resize(cameraRig.camera));
  /** バックミラー・サイドミラー */
  const mirrors = new Mirrors(document.body, loadMirrorMode());
  /** ミラーを置ける範囲（画面のいちばん上の真ん中。毎フレーム測ると重いので時々） */
  let mirrorRegion = { left: 0, right: window.innerWidth, top: 8 };
  let mirrorRegionAge = 0;
  const measureMirrorRegion = () => {
    const w = window.innerWidth;
    // 縦向き: 横いっぱいに。上のボタン・周回・地図などはミラーの下へずらす（--top-shift）
    if (window.innerHeight > w) return { left: 8, right: w - 8, top: 8 };
    // 横向き: 左上のボタンと右上の地図を避けて、真ん中に左右対称に（操作説明・周回・速度はミラーの下や別の場所へずらす）
    let left = 8;
    let right = w - 8;
    for (const id of ['touch-top', 'minimap']) {
      const r = document.getElementById(id)?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0 || r.top > 80) continue;
      if ((r.left + r.right) / 2 < w / 2) left = Math.max(left, r.right + 10);
      else right = Math.min(right, r.left - 10);
    }
    return centeredRegion(w, left, right, 8);
  };
  // ?map=1 のように開始マップを指定できる
  const requested = Number(params.get('map'));
  // 指定がなければ、タイトル画面の後ろに映す峠・首都高のどれかから始める（毎回変わる）
  const titleMap = TITLE_MAPS[Math.floor(Math.random() * TITLE_MAPS.length)];
  let mapIndex = params.has('map') && Number.isInteger(requested) && requested >= 0 && requested < MAPS.length ? requested : MAPS.indexOf(titleMap);
  // ?car=fd3s のように開始時の車を指定できる
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
  cameraRig.setCarScale(carStyle(vehicle().id).scale ?? 1);
  /** 車を替えたら、その車の形の車体に作り直す */
  const rebuildCarMesh = () => {
    carMesh.dispose();
    carMesh = new CarMesh(assignedColor ?? undefined, carStyle(vehicle().id));
    carMesh.setLights(lightsOn);
    view.scene.add(carMesh.root);
    cameraRig.setCarScale(carStyle(vehicle().id).scale ?? 1);
  };
  /** ヘッドライト（暗い時間帯・天気では最初からつける。F キー・ボタンで切り替え） */
  let lightsOn = GameScene.needsHeadlights(env);
  /** 夜に NPC・ライバルがライトをつけて走るか（時間帯・天気の画面で選ぶ） */
  let opponentLights = true;
  /** NPC・ライバルのライト: 夜は選んだとおり。朝や天気の悪いときは自分と同じく自動でつける */
  const npcLightsOn = () => GameScene.needsHeadlights(env) && (env.time !== 'night' || opponentLights);
  const applyLights = () => {
    carMesh.setLights(lightsOn);
    view.setHeadlights(lightsOn);
  };
  applyLights();
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

  // --- バトルのセリフ ---
  const speakerOf = (who: string): Speaker => {
    if (who === 'player') return { name: loadPlayerName().trim() || 'あなた', isPlayer: true };
    if (who === 'sfx') return { name: '', isEffect: true };
    const r = RIVALS.find((x) => x.id === who);
    if (r) return { name: r.name, photo: r.photo };
    return CHARACTERS[who] ?? { name: who };
  };
  const subtitles = new Subtitles(speakerOf, (name) => sound.effect(name));
  /** いまのバトルのセリフ（セリフの無いライバルや、得意なコース以外では null） */
  let talk: { script: RivalDialogue; ctx: BattleContext; lines: BattleDialogue; overtakes: OvertakeWatcher } | null = null;
  let lastImpact = 0;
  const debugWhere = params.has('debug') ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'debug-where' })) : null;
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
  const minimap = new Minimap(document.getElementById('minimap')!, (h) => document.body.style.setProperty('--minimap-h', `${h}px`));
  /** 俯瞰の地図はどのモードでも出す（レースでなくても、いまのマップの道を描く） */
  const showMinimap = () => minimap.setMap(level.def, level.course);
  const raceHud = new RaceHud({
    onRetry: () => race && startRace(raceMode),
    onQuit: () => stopRace(),
    onRanking: () => openRanking(),
    onChange: () => openChangeFlow(),
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
    // オンライン対戦では、いまいる所のコースの真ん中に戻す（みんなと走っているのでやり直せない）
    if (race && raceMode === 'online') recoverOnCourse();
    // レース中のリセットは、スタートからやり直し
    else if (race) startRace(raceMode);
    else placeCar(level.spawn);
  };
  function recoverOnCourse() {
    const course = level.course;
    if (!course || !race) return;
    if (race.phase === 'ready' || race.phase === 'countdown') {
      placeCar(onlineGridSpot());
      return;
    }
    const s = course.project(curr.x, curr.z).s;
    const p = course.pointAt(Math.max(0, s));
    placeCar({ x: p.x, z: p.z, yaw: p.yaw, s: Math.max(0, s) });
  }

  const raceLabel = () =>
    raceMode === 'online'
      ? 'オンライン対戦'
      : raceMode === 'npc'
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
    if (mode === 'online') return;
    if (race && raceMode === 'online') leaveOnlineRace();
    raceMode = mode;
    window.clearTimeout(nextRoundTimer);
    // 先行後追いは、引き分けで次の1本へ進むときだけ続きから。それ以外は1本目から
    suddenDeath = mode === 'battle' && battleRule !== 'side' ? (nextRound && suddenDeath ? suddenDeath : new SuddenDeath(battleRule === 'leadFirst')) : null;
    if (mode !== 'timeAttack') setRival(null);
    let target = mode === 'battle' && toHome ? MAPS.findIndex((m) => m.id === battleRival().course) : level.course ? mapIndex : raceMapIndex;
    // オンライン対戦のエントリー中は、部屋のコースのまま
    if (target !== mapIndex && roomRace && level.course) target = mapIndex;
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
    npcField?.setLights(npcLightsOn());
    raceHud.show(true);
    const go = touch.isShown ? 'アクセルを押すとスタート' : 'アクセル（W / ↑）でスタート';
    raceHud.showReady(suddenDeath ? `${suddenDeath.round}本目・あなたが${suddenDeath.playerLeads ? '先行' : '後追い'}　${go}` : go);
    showMinimap();
    raceHud.hideResult();
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    hud.setMode(raceLabel());
    touch.refresh();
    menu.refresh();
    startTalk(mode, nextRound);
  }

  /** バトルのセリフを用意し、スタート前の場面を出す（先行後追いの2本目からは、round を書いた場面だけ） */
  function startTalk(mode: RaceMode, nextRound: boolean) {
    subtitles.clear();
    talk = null;
    if (mode !== 'battle') return;
    const r = battleRival();
    const script = RIVAL_DIALOGUES[r.id];
    const ctx: BattleContext = {
      course: level.def.id,
      homeCourse: r.course,
      playerCar: vehicle().id,
      rule: suddenDeath ? 'suddenDeath' : 'side',
      playerLeads: suddenDeath?.playerLeads ?? false,
      round: suddenDeath?.round ?? 1,
      weather: env.weather,
      time: env.time,
    };
    if (!dialogueApplies(script, ctx)) return;
    talk = { script, ctx, lines: new BattleDialogue(script.race ?? [], ctx), overtakes: new OvertakeWatcher() };
    const intro = nextRound ? (script.intro ?? []).filter((sc) => sc.when?.round !== undefined) : script.intro;
    subtitles.playScene(sceneLines(intro, ctx), () => {});
  }

  /** 勝負のあとの場面（セリフが無ければすぐ）を出してから then を呼ぶ */
  function outcomeScene(kind: 'win' | 'lose' | 'draw', then: () => void) {
    const t = talk;
    if (!t) return then();
    subtitles.playScene(sceneLines(t.script[kind], t.ctx), then);
  }

  /** 走っている間のセリフ（毎ステップ） */
  function updateTalk() {
    const t = talk;
    const npc = npcField?.npcs[0];
    if (!t || !race || !npc || race.phase !== 'racing') return;
    const mine = race.distance(curr.x, curr.z);
    const signedGap = mine - npc.timer.distance(npc.curr.x, npc.curr.z);
    const events: BattleEvent[] = [];
    const pass = t.overtakes.update(signedGap);
    if (pass) events.push(pass);
    if (lastImpact > CRASH_THRESHOLD) events.push('crash');
    const course = race.course;
    const lapDistance = course.closed ? mine - (race.lap - 1) * course.length : mine;
    const progress = Math.min(1, Math.max(0, mine / (course.length * (course.closed ? race.totalLaps : 1))));
    subtitles.say(
      t.lines.update({
        elapsed: race.time,
        lap: race.lap,
        lapDistance,
        ahead: signedGap > 0,
        gap: Math.abs(signedGap),
        speedKmh: Math.abs(curr.forwardSpeed) * 3.6,
        progress,
        events,
      }),
    );
  }

  /** スタートの合図: カウントダウンを始める */
  function beginRace() {
    if (!race || race.phase !== 'ready' || subtitles.sceneActive) return;
    race.begin();
    npcField?.begin();
  }

  /** レースの表示と NPC を片付ける（車の位置はそのまま） */
  function clearRace() {
    race = null;
    subtitles.clear();
    talk = null;
    suddenDeath = null;
    window.clearTimeout(nextRoundTimer);
    npcField?.dispose();
    npcField = null;
    raceHud.show(false);
    showMinimap();
    ghostMesh.root.visible = false;
    rivalMesh.root.visible = false;
  }

  function stopRace() {
    if (!race) return;
    if (raceMode === 'online') leaveOnlineRace();
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
          if (raceMode === 'online') {
            if (onlineSeq !== null) net.send({ t: 'raceFinish', seq: onlineSeq, time: e.total });
            raceHud.setWarning({ wrongWay: false, offCourse: false });
            raceHud.showRankingButton(false);
            sound.beep(true);
            break;
          }
          if (raceMode !== 'timeAttack') {
            const list = standings();
            const won = list[0]?.isPlayer ?? false;
            if (raceMode === 'battle' && won) markRivalBeaten(battleRival().id);
            raceHud.setWarning({ wrongWay: false, offCourse: false });
            sound.beep(true);
            const show = () => {
              raceHud.showStandings(standings(), r.totalLaps, raceMode === 'battle');
              raceHud.showRankingButton(false);
            };
            if (raceMode === 'battle') outcomeScene(won ? 'win' : 'lose', show);
            else show();
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
      outcomeScene('draw', () => {
        if (suddenDeath !== sd) return;
        raceHud.showBattleResult(
          `${sd.round}本目は引き分け`,
          `${chase}（後追い）が ${SAFE_SECONDS}秒以内に続いてゴールし、抜くこともできませんでした。先行と後追いを入れ替えて、${sd.round + 1}本目へ…`,
        );
        nextRoundTimer = window.setTimeout(() => {
          if (suddenDeath !== sd) return;
          sd.nextRound();
          startRace('battle', false, true);
        }, NEXT_ROUND_DELAY);
      });
      return;
    }
    const why = outcome === 'leadWins' ? `${lead}（先行）が ${SAFE_SECONDS}秒より大きな差をつけてゴールした` : `${chase}（後追い）が抜いて先にゴールした`;
    const won = sd.winner === 'player';
    if (won) markRivalBeaten(battleRival().id);
    outcomeScene(won ? 'win' : 'lose', () => {
      if (suddenDeath !== sd) return;
      raceHud.showBattleResult(won ? `勝利！ ${name} に勝った` : `敗北… ${name} の勝ち`, `${sd.round}本目で決着：${why}`);
    });
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
    showMinimap();
    hud.setMapName(level.def.name);
    hud.toast(message);
    menu.refresh();
    net.updateJoin({ map: mapIndex });
  };
  /** オンライン対戦の間は、部屋のみんなと同じコースのまま（変えられない） */
  const mapLocked = () => {
    if (!roomRace) return false;
    hud.toast('オンライン対戦の間はコースを変えられません');
    return true;
  };
  const nextMap = () => {
    if (mapLocked()) return;
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
  function setLights(on: boolean, announce = false) {
    lightsOn = on;
    applyLights();
    net.send({ t: 'profile', lights: on });
    net.updateJoin({ lights: on });
    if (announce) hud.toast(on ? 'ヘッドライト ON' : 'ヘッドライト OFF');
    touch.refresh();
  }
  const toggleLights = () => setLights(!lightsOn, true);

  // --- クラクション: 押している間だけ鳴らす（部屋の人にも聞こえる） ---
  const hornInput = { key: false, touch: false };
  let hornOn = false;
  const remoteHornTimers = new Map<number, number>();
  const updateHorn = () => {
    const on = hornInput.key || hornInput.touch;
    if (on === hornOn) return;
    hornOn = on;
    sound.horn('me', on);
    net.send({ t: 'horn', on });
  };
  const remoteHorn = (id: number, on: boolean) => {
    window.clearTimeout(remoteHornTimers.get(id));
    if (!on) {
      sound.horn(id, false);
      return;
    }
    sound.horn(id, true, remoteHornVolume(id));
    remoteHornTimers.set(id, window.setTimeout(() => sound.horn(id, false), HORN_MAX_MS));
  };
  /** 他の人のクラクションの大きさ: 遠いほど小さく、HORN_RANGE 以上離れると聞こえない */
  const remoteHornVolume = (id: number) => {
    const p = remoteCars.positionOf(id, performance.now());
    const d = p ? Math.hypot(p.x - curr.x, p.z - curr.z) : HORN_RANGE;
    return Math.max(0, 1 - d / HORN_RANGE);
  };
  /** 鳴らしている間に近づいたり離れたりしたら、大きさを変える */
  const updateRemoteHornVolumes = () => {
    for (const id of remoteHornTimers.keys()) sound.setHornVolume(id, remoteHornVolume(id));
  };

  // --- エモート（短いセリフ）: 自分と部屋のみんなの車の上に吹き出しを出す ---
  const emotePanel = document.getElementById('emotes')!;
  const emoteFeed = document.getElementById('emote-feed')!;
  emotePanel.innerHTML = EMOTES.map((text, i) => `<button type="button" data-emote="${i}"><kbd>${i + 1}</kbd>${escapeHtml(text)}</button>`).join('');
  let lastEmoteAt = -Infinity;
  const toggleEmotes = (open = emotePanel.classList.contains('hidden')) => emotePanel.classList.toggle('hidden', !open);
  const showEmote = (id: number | null, e: number) => {
    const text = EMOTES[e];
    if (text === undefined) return;
    const self = id === null || id === net.id;
    if (self) attachBubble(carMesh.root, text);
    else remoteCars.showBubble(id, text);
    const info = self ? null : remoteCars.list.find((p) => p.id === id);
    const name = self ? loadPlayerName().trim() || 'あなた' : (info?.name ?? '誰か');
    const color = self ? carMesh.color : PLAYER_COLORS[(info?.color ?? 0) % PLAYER_COLORS.length];
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:#${color.toString(16).padStart(6, '0')}"></span><b>${escapeHtml(name)}</b>${escapeHtml(text)}`;
    emoteFeed.appendChild(li);
    while (emoteFeed.children.length > 4) emoteFeed.firstElementChild?.remove();
    window.setTimeout(() => li.classList.add('fade'), 5000);
    window.setTimeout(() => li.remove(), 5500);
  };
  const sendEmote = (e: number) => {
    toggleEmotes(false);
    const now = performance.now();
    if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    lastEmoteAt = now;
    // 部屋にいるときはサーバーから返ってきたときに出す（みんなと同時に）
    if (net.isOnline) net.send({ t: 'emote', e });
    else showEmote(null, e);
  };
  emotePanel.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-emote]');
    if (b) sendEmote(Number(b.dataset.emote));
  });

  // --- オンライン対戦: 言い出した人がコース・時間帯・天気を決め、各自が車を選んで一斉にスタート ---
  /** 部屋の対戦の様子（サーバーから届いたもの） */
  let roomRace: RaceState | null = null;
  /** 自分が走っているオンライン対戦の番号と、その最後の様子（全員ゴールして終わった後も結果に使う） */
  let onlineSeq: number | null = null;
  let onlineResult: RaceState | null = null;
  /** 対戦の条件に合わせる（コース・時間帯・天気） */
  const applyRaceSettings = (st: RaceSettings) => {
    if (st.map !== mapIndex && st.map >= 0 && st.map < MAPS.length) loadMap(st.map, `対戦のコース「${MAPS[st.map].name}」に移動しました`);
    const time = TIMES_OF_DAY.find((t) => t.id === st.time)?.id ?? env.time;
    const weather = WEATHERS.find((w) => w.id === st.weather)?.id ?? env.weather;
    if (time !== env.time || weather !== env.weather) setEnvironment(time, weather, false);
  };
  /** スタートの並び（準備 OK にした順に、2列に互い違い） */
  function onlineGridSpot(): Spawn {
    const course = level.course!;
    const i = Math.max(0, onlineResult?.entrants.indexOf(net.id ?? -1) ?? 0);
    const side = Math.min(3, course.widthAt(0) / 4);
    return course.gridSpot(6 + 6 * Math.floor(i / 2) + (i % 2) * 3, i % 2 === 0 ? side : -side);
  }
  function startOnlineRace(r: RaceState) {
    if (race) clearRace();
    applyRaceSettings(r.settings);
    if (!level.course) return;
    const car = VEHICLE_PRESETS.findIndex((v) => v.id === onlineRacePanel.selectedCar);
    if (car >= 0 && car !== carIndex) selectCar(car);
    raceMode = 'online';
    onlineSeq = r.seq;
    onlineResult = r;
    setRival(null);
    const course = level.course;
    race = new TimeAttack(course, level.def.race!.laps, true);
    ghostRecorder = new GhostRecorder();
    best = null;
    placeCar(onlineGridSpot());
    // カウントダウンの間は並んだ車どうしがぶつからないように
    remoteCars.ghost(performance.now(), 6000);
    race.begin();
    raceHud.show(true);
    raceHud.hideResult();
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    showMinimap();
    hud.setMode(raceLabel());
    document.body.classList.add('online-race');
    touch.refresh();
    menu.refresh();
  }
  /** オンラインの部屋から退出する（対戦中なら対戦もやめる） */
  function leaveRoom() {
    if (race && raceMode === 'online') stopRace();
    net.disconnect();
    hud.toast('部屋から退出しました');
  }
  /** 自分だけオンライン対戦から抜ける（まだゴールしていなければサーバーに知らせる） */
  function leaveOnlineRace() {
    if (onlineSeq !== null && roomRace?.seq === onlineSeq && race?.phase !== 'finished') net.send({ t: 'raceCancel' });
    onlineSeq = null;
    onlineResult = null;
    document.body.classList.remove('online-race');
  }
  /** オンライン対戦の順位（自分は自分の計測、他の人は受け取った距離とゴールのタイム） */
  const onlineStandings = () => {
    const r = onlineResult;
    const course = level.course;
    if (!race || !r || !course) return [];
    return rankOnline(
      r.entrants.map((id) => {
        const fin = r.finished.find((f) => f.id === id);
        if (id === net.id) {
          return { name: loadPlayerName().trim() || 'あなた', color: carMesh.color, isPlayer: true, distance: race!.distance(curr.x, curr.z), total: race!.phase === 'finished' ? race!.time : (fin?.time ?? null), laps: race!.laps.length };
        }
        const info = remoteCars.list.find((p) => p.id === id);
        const distance = remoteCars.progressOf(id) ?? -Infinity;
        return {
          name: info?.name ?? '誰か',
          color: PLAYER_COLORS[(info?.color ?? 0) % PLAYER_COLORS.length],
          isPlayer: false,
          distance,
          total: fin?.time ?? null,
          laps: fin ? race!.totalLaps : lapsDone(distance, course.length, course.closed, race!.totalLaps),
        };
      }),
    );
  };
  const onlineRaceView = () =>
    roomRace && net.id !== null
      ? {
          race: roomRace,
          selfId: net.id,
          members: [
            { id: net.id, name: loadPlayerName().trim() || 'あなた', car: vehicle().id, color: carMesh.color },
            ...remoteCars.list.map((p) => ({ id: p.id, name: p.name, car: p.car, color: PLAYER_COLORS[p.color % PLAYER_COLORS.length] })),
          ],
          conditions: `${MAPS[roomRace.settings.map]?.name ?? ''} ／ ${TIMES_OF_DAY.find((t) => t.id === roomRace!.settings.time)?.label ?? ''}・${WEATHERS.find((w) => w.id === roomRace!.settings.weather)?.label ?? ''}`,
        }
      : null;
  /** 部屋の対戦の様子が変わったとき */
  function onRoomRace(r: RaceState | null, by: number, start = false) {
    const prev = roomRace;
    roomRace = r;
    if (r && r.seq === onlineSeq) onlineResult = r;
    if (!r) {
      onlineRacePanel.update(null);
      // まだ走っている途中で対戦が終わった（言い出した人がやめた・打ち切り）
      if (race && raceMode === 'online' && race.phase !== 'finished') {
        hud.toast(by === net.id ? 'オンライン対戦をやめました' : 'オンライン対戦が終わりました');
        onlineSeq = null;
        stopRace();
      }
    } else if (r.phase === 'entry') {
      const isNew = !prev || prev.seq !== r.seq;
      if (isNew && race) {
        // 自分のレース（タイムアタックなど）はやめて、対戦のコースへ
        if (raceMode === 'online') leaveOnlineRace();
        clearRace();
        hud.setMode('自分で運転');
      }
      applyRaceSettings(r.settings);
      onlineRacePanel.update(onlineRaceView());
      if (isNew) {
        if (by !== net.id) hud.toast(`${nameOf(by)} がオンライン対戦を始めました。車を選んで準備OKにしてください`);
        menu.close();
        rankingPanel.close();
        onlinePanel.close();
        onlineRacePanel.open(vehicle().id);
      }
    } else {
      onlineRacePanel.update(onlineRaceView());
      if (start) {
        if (net.id !== null && r.entrants.includes(net.id)) {
          menu.close();
          startOnlineRace(r);
        } else {
          hud.toast('オンライン対戦が始まりました（今回は見ているだけ）');
        }
      }
    }
    touch.refresh();
    menu.refresh();
    refreshNetStatus();
  }
  /** 時間帯・天気を変える。天気で車の性能が変わるので、レース中ならやり直す */
  const setEnvironment = (time: TimeOfDay, weather: Weather, restart = true) => {
    const weatherChanged = weather !== env.weather;
    const changed = weatherChanged || time !== env.time;
    env.time = time;
    env.weather = weather;
    saveEnvironment(env);
    view.setEnvironment(env);
    // 時間帯・天気が変わったら、ライトもそれに合わせる（後から切り替えられる）
    if (changed) setLights(GameScene.needsHeadlights(env));
    npcField?.setLights(npcLightsOn());
    if (!weatherChanged) return;
    level.car.params = carParams();
    if (race && restart) startRace(raceMode);
  };
  const cycleCar = () => {
    selectCar((carIndex + 1) % VEHICLE_PRESETS.length);
    resetCar();
    hud.toast(`車: ${vehicle().label}（最高 ${Math.round(topSpeedOf(vehicle().params) * 3.6)}km/h）`);
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
    raceMaps.map((m) => {
      const p = courseProfile(m);
      return { id: m.id, label: m.name, note: p.kind === 'free' ? undefined : `${(p.length / 1000).toFixed(1)}km・${p.kind === 'loop' ? `${p.laps}周` : p.kind === 'roundtrip' ? '往復' : '一本道'}` };
    }),
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
    const raceNote = roomRace ? `<br>${roomRace.phase === 'entry' ? '対戦のエントリー中' : '対戦中'}` : '';
    netStatus.innerHTML = `<span class="ns-label">ROOM</span> <span class="code">${roomCode}</span>${state}<br>${
      names ? `一緒に走っている人: ${escapeHtml(names)}` : '他の人を待っています'
    }${raceNote}`;
  };
  /** トップメニューの「みんなで走る」「オンライン対戦」から部屋に入ろうとしている（入ったらそのコース選びへ進む） */
  let afterJoin: 'free' | 'race' | null = null;
  const net: NetClient = new NetClient({
    onStatus: (status, detail) => {
      if (status === 'offline' || status === 'error' || status === 'reconnecting') {
        if (roomRace || onlineSeq !== null) {
          if (race && raceMode === 'online') stopRace();
          onlineSeq = null;
          roomRace = null;
          onlineRacePanel.update(null);
        }
        for (const id of remoteHornTimers.keys()) remoteHorn(id, false);
      }
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
          {
            const next = afterJoin;
            afterJoin = null;
            onlinePanel.close();
            if (m.race) onRoomRace(m.race, m.race.host);
            // トップメニューから参加した: 部屋で対戦していなければ、コース選びへ（いまの部屋のコースを選んだ状態で）
            else if (next === 'race') menu.openFlow(onlineRaceMode);
            else if (next === 'free') menu.openFlow(onlineFreeMode);
          }
          if (m.race?.phase === 'racing') hud.toast('部屋ではオンライン対戦の最中です（終わったら参加できます）');
          break;
        case 'join':
          remoteCars.add(m.player);
          hud.toast(`${m.player.name} が来ました`);
          // エントリー中なら、来た人の準備OKも待つ
          if (roomRace?.phase === 'entry') onlineRacePanel.update(onlineRaceView());
          break;
        case 'leave':
          hud.toast(`${nameOf(m.id)} が抜けました`);
          remoteHorn(m.id, false);
          remoteCars.remove(m.id);
          if (roomRace?.phase === 'entry') onlineRacePanel.update(onlineRaceView());
          break;
        case 'horn':
          remoteHorn(m.id, m.on);
          break;
        case 'emote':
          showEmote(m.id, m.e);
          break;
        case 'race':
          onRoomRace(m.race, m.by, m.start);
          break;
        case 'profile':
          remoteCars.update(m.player);
          if (roomRace?.phase === 'entry') onlineRacePanel.update(onlineRaceView());
          break;
        case 'state':
          remoteCars.pushState(m.id, m.time, m.s, now, m.p);
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
        net.connect(serverUrl, room, { name, car: vehicle().id, map: mapIndex, lights: lightsOn });
      },
      onLeave: () => leaveRoom(),
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
        // 参加せずに閉じたら、コース選びに進むのはやめる
        if (!open && (net.status === 'offline' || net.status === 'error')) afterJoin = null;
      },
    },
    serverUrl !== '',
  );
  const onlineRacePanel = new OnlineRacePanel(
    VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, note: `${driveOf(v) ?? ''}${driveOf(v) ? '・' : ''}最高 ${Math.round(topSpeedOf(v.params) * 3.6)}km/h` })),
    vehicle().id,
    (id) => VEHICLE_PRESETS.find((v) => v.id === id)?.label ?? id,
    {
      onReady: (ready, car) => {
        const index = VEHICLE_PRESETS.findIndex((v) => v.id === car);
        if (index >= 0 && index !== carIndex) {
          selectCar(index);
          resetCar();
        }
        net.send({ t: 'raceReady', ready, car });
      },
      onStart: () => net.send({ t: 'raceStart' }),
      onLeave: () => {
        net.send({ t: 'raceCancel' });
        onlineRacePanel.close();
      },
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
      },
    },
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
  keyboard.onAction('KeyF', toggleLights);
  keyboard.onAction('KeyE', () => toggleEmotes());
  EMOTES.forEach((_, i) => keyboard.onAction(`Digit${i + 1}`, () => sendEmote(i)));

  const gamepad = new GamepadInput();
  gamepad.onButton(PAD_BUTTON.north, cycleCamera);
  gamepad.onButton(PAD_BUTTON.start, resetCar);
  gamepad.onButton(PAD_BUTTON.select, nextMap);
  // セリフの場面は A ボタンでも進める
  gamepad.onButton(PAD_BUTTON.south, () => subtitles.advance());

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
      { label: () => (race && raceMode !== 'online' ? 'やり直す' : 'リセット'), run: resetCar },
      { label: () => (lightsOn ? 'ライト ON' : 'ライト OFF'), run: toggleLights, place: 'side' },
      { label: () => 'ホーン', run: () => {}, hold: (down) => (hornInput.touch = down), place: 'side' },
      { label: () => 'セリフ', run: () => toggleEmotes(), place: 'side' },
      { label: () => 'エントリー', run: () => onlineRacePanel.open(), visible: () => roomRace?.phase === 'entry' && !onlineRacePanel.isOpen },
    ],
    // ☰ は押すたびにポーズ画面を開く・閉じる
    () => (menu.isOpen ? menu.close() : menu.openPause()),
  );

  // --- メニュー: タイトル → トップ画面でプレイモードを選び、コース・対戦相手・車などを順に選ぶ（走っている間は Esc / ☰ でポーズ） ---
  /** メニューで選んでいる途中の内容（最後に「スタート」を押したときに反映する） */
  const draft = {
    map: level.def.id,
    car: vehicle().id,
    npc: NPC_LEVELS[npcLevelIndex].id,
    rival: battleRival().id,
    rule: battleRule as BattleRule,
    time: env.time,
    weather: env.weather,
    opponentLights,
  };
  const draftMap = () => MAPS.find((m) => m.id === draft.map) ?? MAPS[0];
  const draftCar = () => VEHICLE_PRESETS.find((v) => v.id === draft.car) ?? VEHICLE_PRESETS[0];
  const draftRival = () => RIVALS.find((r) => r.id === draft.rival) ?? RIVALS[0];
  const draftNpc = () => NPC_LEVELS.find((l) => l.id === draft.npc) ?? NPC_LEVELS[0];
  const carLabel = (id: string) => VEHICLE_PRESETS.find((v) => v.id === id)?.label ?? id;
  const mapLabel = (id: string) => MAPS.find((m) => m.id === id)?.name ?? id;
  /** 車の見た目（メニューの右側で回して見せる） */
  const carPreview = new CarPreview();
  /** 選び始めたときの時間帯・天気（得意な条件のないライバルに選び直したら、これに戻す） */
  let draftBaseEnv = { time: env.time, weather: env.weather };
  /** 選び始めるときに、下書きを今の状態にする（レースならレース用のコースから選ぶ） */
  const beginDraft = (raceOnly: boolean) => {
    draft.map = raceOnly && !level.def.race ? raceMaps[0].id : level.def.id;
    draft.car = vehicle().id;
    draft.npc = NPC_LEVELS[npcLevelIndex].id;
    draft.rival = battleRival().id;
    draft.rule = battleRule;
    draft.time = env.time;
    draft.weather = env.weather;
    draft.opponentLights = opponentLights;
    draftBaseEnv = { time: env.time, weather: env.weather };
  };
  /** 対戦相手を選んだとき: コースと時間帯・天気を、まずライバルの得意なものにしておく（後の画面で変えられる） */
  const draftRivalDefaults = () => {
    const r = draftRival();
    draft.map = r.course;
    const c = r.conditions ?? draftBaseEnv;
    draft.time = c.time;
    draft.weather = c.weather;
  };
  /** ライバルの得意な時間帯・天気の書き方（「夜・雨」。なければ空） */
  const rivalConditionsLabel = (r: Rival) =>
    r.conditions ? `${TIMES_OF_DAY.find((t) => t.id === r.conditions!.time)!.label}・${WEATHERS.find((w) => w.id === r.conditions!.weather)!.label}` : '';
  /** 選んだ内容を反映して、そのモードで始める */
  const applyDraft = (mode: RaceMode | 'free') => {
    setEnvironment(draft.time, draft.weather, false);
    const car = VEHICLE_PRESETS.findIndex((v) => v.id === draft.car);
    if (car >= 0 && car !== carIndex) selectCar(car);
    npcLevelIndex = Math.max(0, NPC_LEVELS.findIndex((l) => l.id === draft.npc));
    battleIndex = Math.max(0, RIVALS.findIndex((r) => r.id === draft.rival));
    battleRule = draft.rule;
    opponentLights = draft.opponentLights;
    if (mode === 'free') stopRace();
    const map = MAPS.findIndex((m) => m.id === draft.map);
    if (map >= 0 && map !== mapIndex && !mapLocked()) {
      loadMap(map);
      // 同じ部屋の全員のマップも切り替える
      net.send({ t: 'map', map: mapIndex });
    }
    if (mode !== 'free') startRace(mode);
    else resetCar();
  };

  /** note: 説明の下に添える一言（部屋の全員が移動する、など） */
  const courseScreen = (raceOnly: boolean, home?: string, note?: string): MenuScreen => ({
    title: 'コース',
    en: 'COURSE',
    groups: [
      {
        choices: () => {
          const maps = MAPS.filter((m) => !raceOnly || m.race);
          // ライバルの得意なコースを先頭に
          if (home) maps.sort((a, b) => Number(b.id === home) - Number(a.id === home));
          return maps.map((m) => {
            const p = courseProfile(m);
            return {
              id: m.id,
              label: m.name,
              badge: m.id === home ? '得意' : undefined,
              note: p.kind === 'free' ? '自由に走る' : `${(p.length / 1000).toFixed(1)}km・${p.kind === 'loop' ? `周回 ${p.laps}周` : p.kind === 'roundtrip' ? '往復' : '一本道'}`,
            };
          });
        },
        selected: () => draft.map,
        select: (id) => (draft.map = id),
      },
    ],
    detail: () => {
      if (!home) return courseDetail(draftMap(), carLabel, note ? { note } : undefined);
      const r = draftRival();
      const script = RIVAL_DIALOGUES[r.id];
      // セリフが得意なコースだけのライバルなら、ほかのコースを選んだときに知らせる
      const silent = draftMap().id !== home && script && (script.onlyHomeCourse ?? true);
      return courseDetail(draftMap(), carLabel, {
        badge: draftMap().id === home ? `${r.name}の得意コース` : undefined,
        note: `${silent ? `${r.name}のセリフは、得意コースの「${mapLabel(home)}」でのバトルだけ出ます。` : ''}先行後追いは、周回コースでも1周で1本です`,
      });
    },
  });
  const carScreen: MenuScreen = {
    title: '自分の車',
    en: 'MACHINE',
    groups: [
      {
        choices: () => VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, note: `${driveOf(v) ?? ''}${driveOf(v) ? '・' : ''}最高 ${Math.round(topSpeedOf(v.params) * 3.6)}km/h` })),
        selected: () => draft.car,
        select: (id) => (draft.car = id),
      },
    ],
    detail: () => carDetail(draftCar(), carPreview),
  };
  const npcScreen: MenuScreen = {
    title: 'NPCの強さ',
    en: 'OPPONENTS',
    groups: [
      {
        choices: () => NPC_LEVELS.map((l) => ({ id: l.id, label: l.label })),
        selected: () => draft.npc,
        select: (id) => (draft.npc = id),
      },
    ],
    detail: () => npcDetail(draftNpc(), NPC_COUNT),
  };
  const rivalScreen: MenuScreen = {
    title: '対戦相手',
    en: 'RIVAL',
    groups: [
      {
        choices: () => {
          const beaten = loadBeatenRivals();
          return RIVALS.map((r) => ({
            id: r.id,
            label: r.name,
            badge: beaten.has(r.id) ? 'WIN' : undefined,
            note: `${carLabel(r.car)}・${rivalLevel(r).label}`,
          }));
        },
        selected: () => draft.rival,
        select: (id) => {
          draft.rival = id;
          draftRivalDefaults();
        },
      },
    ],
    detail: () => {
      const r = draftRival();
      return rivalDetail(r, rivalLevel(r), { car: carLabel(r.car), course: [mapLabel(r.course), rivalConditionsLabel(r)].filter(Boolean).join('・'), beaten: loadBeatenRivals().has(r.id) }, carPreview);
    },
  };
  const ruleScreen: MenuScreen = {
    title: 'ルール',
    en: 'RULE',
    groups: [
      {
        choices: () => BATTLE_RULES,
        selected: () => draft.rule,
        select: (id) => (draft.rule = id as BattleRule),
      },
    ],
    detail: () => {
      const rule = BATTLE_RULES.find((r) => r.id === draft.rule)!;
      return textDetail({
        kicker: `VS ${draftRival().name}`,
        title: rule.label,
        big: draft.rule === 'side' ? '1:1' : 'SD',
        lines:
          draft.rule === 'side'
            ? ['2台が横に並んでスタートし、先にゴールしたほうの勝ち。']
            : [
                `先行と後追いに分かれて1本ずつ走り、ゴールの時点で判定する（サドンデス）。`,
                `後追いが抜いて先にゴールすれば後追いの勝ち。後追いが先行から ${SAFE_SECONDS}秒より遅れてゴールすれば先行の勝ち。`,
                `${SAFE_SECONDS}秒以内に続いてゴールすれば引き分けで、先行と後追いを入れ替えて次の1本へ。`,
              ],
      });
    },
  };
  const timeGroup: MenuGroup = {
    title: '時間帯',
    choices: () => TIMES_OF_DAY,
    selected: () => draft.time,
    select: (id) => (draft.time = id as TimeOfDay),
  };
  const weatherGroup: MenuGroup = {
    title: '天気',
    choices: () => WEATHERS,
    selected: () => draft.weather,
    select: (id) => (draft.weather = id as Weather),
  };
  /** 夜だけ: 相手（NPC・ライバル）がライトをつけて走るか */
  const opponentLightsGroup: MenuGroup = {
    title: '相手のライト',
    choices: () => [
      { id: 'on', label: 'つける' },
      { id: 'off', label: '消す', note: '暗い中で見えにくい' },
    ],
    selected: () => (draft.opponentLights ? 'on' : 'off'),
    select: (id) => (draft.opponentLights = id === 'on'),
  };
  /** 時間帯・天気の画面。withOpponents なら、夜を選んだときに相手のライトも選べる */
  const conditionsScreen = (withOpponents: boolean): MenuScreen => ({
    title: '時間帯・天気',
    en: 'CONDITIONS',
    get groups() {
      return withOpponents && draft.time === 'night' ? [timeGroup, weatherGroup, opponentLightsGroup] : [timeGroup, weatherGroup];
    },
    detail: () =>
      conditionsDetail(TIMES_OF_DAY.find((t) => t.id === draft.time)!, WEATHERS.find((w) => w.id === draft.weather)!, [
        ['コース', draftMap().name],
        ['車', draftCar().label],
        ...(withOpponents && draft.time === 'night' ? [['相手のライト', draft.opponentLights ? 'つける' : '消す'] as [string, string]] : []),
      ]),
  });
  const envScreen = conditionsScreen(false);
  const opponentEnvScreen = conditionsScreen(true);
  const envSummary = () => `${TIMES_OF_DAY.find((t) => t.id === draft.time)!.label}・${WEATHERS.find((w) => w.id === draft.weather)!.label}`;
  const modeDetail = (title: string, en: string, lines: string[]) => () =>
    textDetail({
      kicker: en,
      title,
      big: en.split(' ')[0],
      // コース・車・時間帯はこの後の画面で選ぶので、ここには出さない
      lines,
    });
  const menuModes: MenuMode[] = [
    {
      id: 'free',
      label: '自由に走る',
      en: 'FREE RUN',
      note: '好きなマップを自由にドライブ',
      detail: modeDetail('自由に走る', 'FREE RUN', ['街・峠・サーキット・首都高を、時間を気にせず走る。', 'オンラインの部屋に入れば、友だちと同じマップを走れます。']),
      begin: () => beginDraft(false),
      screens: () => [courseScreen(false), carScreen, envScreen],
      summary: () => `${draftMap().name} ／ ${draftCar().label} ／ ${envSummary()}`,
      finish: () => applyDraft('free'),
    },
    {
      id: 'timeAttack',
      label: 'タイムアタック',
      en: 'TIME ATTACK',
      note: '自己ベストとゴーストに挑戦',
      detail: modeDetail('タイムアタック', 'TIME ATTACK', ['アクセルを踏むとカウントダウン。自己ベストの走りがゴーストになって一緒に走る。', 'ゴールすると記録はランキングにも送られます。']),
      begin: () => beginDraft(true),
      screens: () => [courseScreen(true), carScreen, envScreen],
      summary: () => `${draftMap().name} ／ ${draftCar().label} ／ ${envSummary()}`,
      finish: () => applyDraft('timeAttack'),
    },
    {
      id: 'npc',
      label: 'NPCと対戦',
      en: 'RACE',
      note: `${NPC_COUNT}台のNPCとレース`,
      detail: modeDetail('NPCと対戦', 'RACE', [`${NPC_COUNT}台のNPCが前に並び、最後尾からスタートして順位を競う。`, '強さは5段階から選べます。']),
      begin: () => beginDraft(true),
      screens: () => [courseScreen(true), npcScreen, carScreen, opponentEnvScreen],
      summary: () => `${draftMap().name} ／ NPC ${draftNpc().label} ／ ${draftCar().label} ／ ${envSummary()}`,
      finish: () => applyDraft('npc'),
    },
    {
      id: 'battle',
      label: 'ライバルとバトル',
      en: 'BATTLE',
      note: '1対1。先行後追いも選べる',
      detail: modeDetail('ライバルとバトル', 'BATTLE', [`${RIVALS.length}人のライバルと1対1。横に並んでのスタートか、先行後追いのサドンデスで勝負する。`, `勝った相手: ${loadBeatenRivals().size} / ${RIVALS.length}`]),
      begin: () => {
        beginDraft(true);
        draftRivalDefaults();
      },
      screens: () => [rivalScreen, ruleScreen, courseScreen(true, draftRival().course), carScreen, opponentEnvScreen],
      summary: () => `VS ${draftRival().name} ／ ${BATTLE_RULES.find((r) => r.id === draft.rule)!.label} ／ ${draftMap().name} ／ ${draftCar().label}`,
      finish: () => applyDraft('battle'),
    },
  ];
  /** いまのレースのモードのまま、コースと車だけを選び直す（ポーズ画面・ゴールの画面から） */
  function openChangeFlow() {
    const base = menuModes.find((m) => m.id === raceMode);
    if (!base) return;
    menu.openFlow({
      ...base,
      begin: () => beginDraft(true),
      screens: () => [raceMode === 'battle' ? courseScreen(true, draftRival().course) : courseScreen(true), carScreen],
    });
  }
  const settingDetail = (title: string, lines: string[]) => () => textDetail({ kicker: 'OPTIONS', title, lines });
  /** プレイデータを消すボタンを1回押してから、この時刻 [ms] までにもう一度押すと消す */
  let clearArmedUntil = 0;
  const settingItems: MenuItem[] = [
    { label: () => 'カメラ', value: () => cameraRig.modeName, run: () => cycleCamera(), detail: settingDetail('カメラ', ['走っているときの視点。走行中は C キーでも切り替えられます。']) },
    {
      label: () => 'ミラー',
      value: () => MIRROR_MODES.find((m) => m.id === mirrors.mode)!.label,
      run: () => {
        const i = MIRROR_MODES.findIndex((m) => m.id === mirrors.mode);
        mirrors.mode = MIRROR_MODES[(i + 1) % MIRROR_MODES.length].id;
        saveMirrorMode(mirrors.mode);
      },
      detail: settingDetail('ミラー', ['走っているときに出すミラー。押すたびに「なし → バックミラー → サイドのみ → バック＋サイド」と切り替わります。', '古いスマホで重いときは「なし」にしてください。']),
    },
    { label: () => '効果音', value: () => (sound.isMuted ? 'OFF' : 'ON'), run: toggleMute, detail: settingDetail('効果音', ['エンジン音・タイヤの音・ぶつかった音。M キーでも切り替えられます。']) },
    {
      label: () => 'BGM',
      value: () => bgm.choiceLabel,
      run: () => {
        sound.start();
        bgm.start(sound.context);
        bgm.cycle();
      },
      visible: () => bgm.tracks.length > 0,
      detail: settingDetail('BGM', ['ゲーム中に流す曲。押すたびに「なし → 曲 → シャッフル」と切り替わります。', `曲: ${bgm.tracks.map((t) => t.title).join('／')}`]),
    },
    {
      label: () => 'BGMの音量',
      value: () => bgm.volumeLabel,
      run: () => bgm.cycleVolume(),
      visible: () => bgm.isOn,
      detail: settingDetail('BGMの音量', ['小・中・大の3段階。']),
    },
    {
      label: () => 'ハンドル',
      value: () => (touch.steerMode === 'tilt' ? '傾ける' : 'なぞる'),
      run: () => void toggleSteerMode(),
      visible: () => touch.isShown,
      detail: settingDetail('ハンドル（スマホ）', ['画面を左右になぞるか、スマホを傾けてハンドルを切る。']),
    },
    {
      label: () => '全画面',
      value: () => (isFullscreen() ? 'ON' : 'OFF'),
      run: () => void enterFullscreen(),
      visible: () => canRequestFullscreen() && !isStandalone(),
      detail: settingDetail('全画面', ['ブラウザのアドレスバーなどを隠して、画面いっぱいで遊ぶ。']),
    },
    {
      label: () => 'ホーム画面に追加',
      value: () => '案内',
      run: () => hud.toast('共有ボタン（□に↑）から「ホーム画面に追加」'),
      visible: () => needsHomeScreenForFullscreen(),
      detail: settingDetail('ホーム画面に追加（iPhone）', [
        'アドレスバーを消して遊ぶには、Safari の共有ボタン（□に↑）から「ホーム画面に追加」を選び、追加したアイコンから開いてください。',
      ]),
    },
    {
      label: () => 'プレイデータを消す',
      // まちがって消さないよう、続けてもう一度押したときだけ消す
      value: () => (clearArmedUntil > performance.now() ? 'もう一度押すと消す' : '消す'),
      run: () => {
        if (clearArmedUntil <= performance.now()) {
          clearArmedUntil = performance.now() + 4000;
          menu.refresh();
          window.setTimeout(() => menu.refresh(), 4100);
          return;
        }
        clearArmedUntil = 0;
        clearPlayData();
        best = null;
        hud.toast('プレイデータを消しました');
        menu.refresh();
      },
      detail: settingDetail('プレイデータを消す', [
        'このブラウザに残っている、タイムアタックの自己ベストとゴースト・勝ったライバルの記録を消します。',
        '名前・サウンド・ハンドルなどの設定は残ります。ランキングに送った記録は消えません。',
        '押したあと、もう一度押すと消します。元には戻せません。',
      ]),
    },
  ];
  const openSettings = { label: () => '設定', en: 'OPTIONS', run: () => menu.openSettings(), detail: settingDetail('設定', ['カメラ・サウンド・ハンドルなど。']) };
  const onlineItem: MenuItem = {
    label: () => 'みんなで走る',
    en: 'ONLINE',
    note: () => (net.isOnline ? `部屋 ${roomCode} に参加中` : '部屋のみんなと自由に走る（対戦もできます）'),
    major: true,
    run: () => {
      // 部屋に入っていればコース・車選びへ。まだなら部屋に入ってから進む
      if (net.isOnline) return menu.openFlow(onlineFreeMode);
      menu.close();
      onlinePanel.open('友だちと同じ部屋コードを入れて「参加する」を押すと、コース・車選びに進みます。');
      afterJoin = 'free';
    },
    detail: settingDetail('みんなで走る（オンライン）', [
      '同じ部屋コードを入れた人と、同じコースを一緒に自由に走れます（最大8人）。',
      '部屋に入るとコースを選べます。コースを変えると、部屋の全員が同じコースに移動します。',
      '部屋に入ったまま、トップメニューの「オンライン対戦」で部屋のみんなとレースもできます。',
    ]),
  };
  /** 部屋のみんなと自由に走る: コースを選ぶと部屋の全員がそのコースへ（車は各自） */
  const onlineFreeMode: MenuMode = {
    id: 'onlineFree',
    label: 'みんなで走る',
    en: 'ONLINE',
    note: '部屋のみんなと自由に走る',
    detail: onlineItem.detail!,
    begin: () => beginDraft(false),
    screens: () => [courseScreen(false, undefined, '選んだコースに、部屋の全員が一緒に移動します。'), carScreen],
    summary: () => `部屋 ${roomCode} ／ ${draftMap().name} ／ ${draftCar().label}`,
    finish: () => applyDraft('free'),
    finishLabel: '走る',
  };
  /** 自由に走っている間に、コースと車を選び直す（ポーズ画面から。部屋にいれば全員が移動する） */
  const freeChangeMode: MenuMode = {
    ...onlineFreeMode,
    id: 'freeChange',
    label: 'コース・車を変える',
    en: 'CHANGE',
    screens: () => [courseScreen(false, undefined, net.isOnline ? '選んだコースに、部屋の全員が一緒に移動します。' : undefined), carScreen],
    summary: () => `${draftMap().name} ／ ${draftCar().label}`,
  };
  /** オンライン対戦を言い出す: コースと時間帯・天気を決める（車は各自がエントリー画面で選ぶ） */
  const onlineRaceMode: MenuMode = {
    id: 'onlineRace',
    label: 'オンライン対戦',
    en: 'ONLINE RACE',
    note: '部屋のみんなとレース',
    detail: modeDetail('オンライン対戦', 'ONLINE RACE', ['コースと時間帯・天気を決めると、部屋の全員にエントリー画面が開きます。', '各自が車を選んで準備OKにしたら、スタートで一斉にカウントダウン。']),
    begin: () => beginDraft(true),
    screens: () => [courseScreen(true), envScreen],
    summary: () => `${draftMap().name} ／ ${envSummary()}`,
    finish: () => {
      const map = MAPS.findIndex((m) => m.id === draft.map);
      net.send({ t: 'raceOpen', settings: { map, time: draft.time, weather: draft.weather } });
    },
    finishLabel: 'エントリー開始',
  };
  const onlineRaceItem: MenuItem = {
    label: () => (roomRace ? 'エントリー画面' : 'オンライン対戦'),
    en: 'ONLINE RACE',
    run: () => {
      if (!net.isOnline) {
        // 部屋に入ってから、そのままコース選びへ進む（部屋でエントリー中なら、そのエントリー画面へ）
        menu.close();
        onlinePanel.open('対戦する部屋に参加します。友だちと同じ部屋コードを入れて「参加する」を押すと、コース選びに進みます。');
        afterJoin = 'race';
      } else if (roomRace?.phase === 'entry') {
        menu.close();
        onlineRacePanel.open();
      } else if (!roomRace) {
        menu.openFlow(onlineRaceMode);
      } else {
        hud.toast('いまは対戦の最中です。終わったら始められます');
      }
    },
    note: () => (net.isOnline ? '部屋のみんなとレース' : '部屋に参加してレース'),
    major: true,
    visible: () => !(race && raceMode === 'online'),
    detail: settingDetail('オンライン対戦', [
      '部屋のみんなと同じコース・同じ条件でレースする。',
      'まだ部屋に入っていなければ、部屋コードを入れて参加してからコース選びに進みます。',
      'コースと時間帯・天気を決めた人が主催になり、全員が車を選んで準備OKにしたらスタートします。',
    ]),
  };
  const rankingItem: MenuItem = {
    label: () => 'ランキング',
    en: 'RANKING',
    run: () => {
      menu.close();
      openRanking();
    },
    visible: () => board !== null,
    detail: settingDetail('ランキング', ['タイムアタックの記録の一覧。上位の人のゴーストと対戦できます。']),
  };
  const nowInfo = () =>
    `${level.def.name} ／ ${race ? raceLabel() : '自分で運転'} ／ ${vehicle().label} ／ ${TIMES_OF_DAY.find((t) => t.id === env.time)!.label}・${WEATHERS.find((w) => w.id === env.weather)!.label}`;
  /** ポーズ画面の右側: いま走っているコースの地図 */
  const pauseDetail = () => courseDetail(level.def, carLabel, { badge: race ? raceLabel() : '自由に走る' });
  const menu = new GameMenu(
    menuModes,
    {
      home: [onlineItem, onlineRaceItem, rankingItem, openSettings],
      pause: [
        {
          label: () => (race && raceMode === 'online' ? 'コースに戻る' : 'やり直す'),
          en: 'RETRY',
          run: () => (menu.close(), race && raceMode !== 'online' ? startRace(raceMode) : resetCar()),
          detail: pauseDetail,
        },
        {
          label: () => 'コース・車を変える',
          en: 'CHANGE',
          run: () => (race ? openChangeFlow() : menu.openFlow(freeChangeMode)),
          // オンライン対戦（エントリー中を含む）の間は、部屋のコースのまま
          visible: () => (race ? raceMode !== 'online' : !roomRace),
          detail: () =>
            settingDetail('コース・車を変える', [
              race ? '同じモードのまま、コースと車を選び直してスタートからやり直す。' : 'いまのまま自由に走りながら、コースと車を選び直す。',
              ...(!race && net.isOnline ? ['部屋に入っているので、コースを変えると部屋の全員が同じコースに移動します。'] : []),
            ])(),
        },
        { label: () => (raceMode === 'online' ? '対戦から抜ける' : 'レースをやめる'), en: 'QUIT RACE', run: () => (menu.close(), stopRace()), visible: () => race !== null, detail: pauseDetail },
        {
          label: () => '部屋から抜ける',
          en: 'LEAVE ROOM',
          run: () => {
            menu.close();
            leaveRoom();
          },
          visible: () => net.isOnline,
          detail: () => settingDetail('部屋から抜ける', [`部屋 ${roomCode} から退出して、ひとりで走る。`, race && raceMode === 'online' ? '走っている対戦も途中でやめます。' : 'また「みんなで走る」から参加できます。'])(),
        },
        { label: () => 'タイトルに戻る', en: 'TITLE', run: () => menu.openTitle(), detail: settingDetail('タイトルに戻る', ['最初のタイトル画面に戻る。何か押すと、プレイモード・コースを選び直せます。オンラインの部屋もそこから。']) },
        { ...rankingItem, visible: () => board !== null && race !== null && raceMode === 'timeAttack' },
        openSettings,
      ],
      settings: settingItems,
    },
    {
      info: nowInfo,
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
        document.body.classList.toggle('menu-open', open);
        if (!open) cameraRig.snap();
      },
      canOpen: () => !onlinePanel.isOpen && !rankingPanel.isOpen && !onlineRacePanel.isOpen,
    },
  );
  touch.refresh();

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
    if (e.pointerType !== 'touch' || touch.isShown) return;
    touch.show();
    // スマホの操作画面では地図が小さくなるので描き直す
    showMinimap();
  });
  showMinimap();
  window.addEventListener('resize', showMinimap);

  // ブラウザの制約で、音はユーザー操作の後でないと鳴らせない（タッチは指を離したときが操作とみなされる）
  const unlockAudio = () => {
    sound.start();
    bgm.start(sound.context);
  };
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
      hornInput.key = keyboard.isDown('KeyG');
      updateHorn();
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
      lastImpact = impact;
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
        updateTalk();
        if (debugWhere) {
          const d = r.distance(curr.x, curr.z);
          debugWhere.textContent = `${r.lap}周目 ${Math.round(level.course?.closed ? d - (r.lap - 1) * level.course.length : d)}m`;
        }
      }
      // タブが裏に回っている間は送らない（他の人からは止まって見え、やがて放置として部屋から外れる）
      if (net.isOnline && !document.hidden && ++stepCount % SEND_EVERY_STEPS === 0) {
        const progress = race && raceMode === 'online' && onlineSeq !== null ? race.distance(curr.x, curr.z) : undefined;
        net.send({ t: 'state', time: performance.now(), s: carStateOf(curr), ...(progress !== undefined ? { p: Math.round(progress * 10) / 10 } : {}) });
      }

    },
    (alpha, frameDt) => {
      subtitles.update(frameDt);
      const s = level.ground(lerpSnapshot(prev, curr, alpha));
      s.y += air.gap - fall.drop;
      carMesh.update(s);
      view.followCar(carMesh.root);
      remoteCars.render(performance.now());
      updateRemoteHornVolumes();
      npcField?.render(alpha);
      // 他の人や NPC のヘッドライトで、自分の画面の道も照らす（近い車だけ）
      const litCars = [...remoteCars.litCars(), ...(npcField?.litCars() ?? [])];
      view.setRemoteHeadlights(nearestLit(litCars, s.x, s.z).map((c) => c.root));
      let minimapRace: MinimapMarker[] = [];
      if (race) {
        const pose = best ? ghostPoseAt(best.ghost, Math.max(0, race.time)) : null;
        const list = npcField ? standings() : raceMode === 'online' ? onlineStandings() : null;
        const rank = list && list.length > 0 ? { list, index: list.findIndex((e) => e.isPlayer) } : null;
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
          // オンライン対戦は最大8人なので、上位3人と自分だけ
          field: rank && raceMode === 'online' ? standingsWindow(rank.list).map(({ rank: n, entry }) => ({ ...entry, rank: n })) : rank?.list,
          rival: rival && raceMode === 'timeAttack' ? { name: rival.name, total: rival.total } : undefined,
          battle: battleInfo(),
        });
        // ゴールした後も、まだ走っている NPC がゴールするたびに順位表を更新する（先行後追いは別の結果）
        if (rank && race.phase === 'finished' && !suddenDeath) raceHud.showStandings(rank.list, race.totalLaps, raceMode === 'battle');
        minimapRace = [
          ...(pose ? [{ x: pose.x, z: pose.z, color: '#7fd4ff' }] : []),
          ...(rivalPose ? [{ x: rivalPose.x, z: rivalPose.z, color: '#ffa040' }] : []),
          ...(npcField?.npcs.map((n) => ({ x: n.curr.x, z: n.curr.z, color: hex(n.color) })) ?? []),
        ];
      }
      // 地図: ゴースト・NPC と、部屋の他の人（オンライン対戦中はエントリーした人だけ）と自分
      const others = race && raceMode === 'online' ? (onlineResult?.entrants ?? []) : race ? [] : remoteCars.list.map((p) => p.id);
      minimap.draw([
        ...minimapRace,
        ...others.flatMap((id) => {
          const p = id === net.id ? null : remoteCars.positionOf(id, performance.now());
          const info = remoteCars.list.find((x) => x.id === id);
          return p && info ? [{ x: p.x, z: p.z, color: hex(PLAYER_COLORS[info.color % PLAYER_COLORS.length]) }] : [];
        }),
        { x: s.x, z: s.z, yaw: s.yaw, color: '#ff5a4f', size: 5 },
      ]);
      level.syncProps();
      // タイトル・メニューの間は、止まっている車の周りをカメラが回る
      if (menu.showcase) cameraRig.orbit(s, frameDt);
      else cameraRig.update(s, frameDt);
      view.followTarget(s.x, s.z, s.y);
      view.update(frameDt, cameraRig.camera);
      hud.update(s);
      sound.update(s.forwardSpeed, input.throttle, s.lateralSpeed, input.brake > 0 && s.forwardSpeed > 0);
      view.render(cameraRig.camera);
      const showMirrors = mirrors.mode !== 'off' && !menu.showcase && !document.body.classList.contains('menu-open');
      if (showMirrors && mirrorRegionAge-- <= 0) {
        mirrorRegion = measureMirrorRegion();
        mirrorRegionAge = 10;
        // ミラーの下に、周回・タイムや操作説明などをずらす
        document.body.style.setProperty('--mirror-bottom', `${mirrors.bottom(mirrorRegion) + 8}px`);
      }
      // スマホの縦向きでは、上の表示をまとめてミラーの下へ（ポーズ中は ☰ が動かないよう、そのまま）
      if (!menu.isOpen) {
        const shift = showMirrors && touch.isShown && window.innerHeight > window.innerWidth ? mirrors.bottom(mirrorRegion) : 0;
        document.body.style.setProperty('--top-shift', `${shift}px`);
      }
      document.body.classList.toggle('mirrors-on', showMirrors);
      document.body.classList.toggle('menu-driving', menu.isOpen && !menu.showcase);
      mirrors.render(view.renderer, view.scene, carMesh.root, showMirrors, mirrorRegion);
    },
  );

  // ?debug を付けるとブラウザの開発者ツールや自動テストから状態を触れる
  if (params.has('debug')) {
    Object.assign(window, {
      __game: { getLevel: () => level, getRace: () => race, getNpcs: () => npcField, getSuddenDeath: () => suddenDeath, menu, startTimeAttack: () => startRace('timeAttack'), startNpcRace: () => startRace('npc'), startBattle: (index = battleIndex) => { battleIndex = index; startRace('battle', true); }, subtitles, stopRace, openRanking, rankingPanel, net, remoteCars, touch, onlinePanel, cameraRig, sound },
    });
  }

  hideLoading();
  loop.start();
  // タイトル画面から始める（?map= でマップを指定して開いたときは、すぐに走れるようにする）
  if (!params.has('map') && !params.has('room')) menu.openTitle();

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
