import {
  type ClientMessage,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type PlayerInfo,
  type RaceState,
  type ServerMessage,
  parseClientMessage,
} from '../../src/net/protocol';

/** 放置の判定に使う、接続ごとの記録 */
export interface Activity {
  /** つないだ時刻 [ms] */
  connectedAt: number;
  /** 最後に動いた（車を動かした・車やマップを替えた）時刻 [ms] */
  lastActive: number;
  /** lastActive の時点の車の位置（まだ位置を受け取っていなければ null） */
  x: number | null;
  z: number | null;
  /** 最後にクラクション・エモートを送った時刻 [ms]（連打で他の人の画面を埋めないため） */
  lastHorn?: number;
  lastEmote?: number;
}

/** 部屋につながっている1人分の接続（Durable Object の WebSocket を包む） */
export interface Connection {
  /** hello を送るまでは null */
  info: PlayerInfo | null;
  activity: Activity;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** 部屋の永続化する値（Durable Object が休止しても失われないように外に置く） */
export interface RoomStore {
  getMap(): number;
  setMap(map: number): void;
  getRace(): RaceState | null;
  setRace(race: RaceState | null): void;
}

/** この時間、車が動かなければ部屋から外す [ms] */
export const IDLE_TIMEOUT_MS = 5 * 60_000;
/** つないだのにこの時間 hello を送ってこない接続は切る [ms] */
export const HELLO_TIMEOUT_MS = 15_000;
/** これ以上動いたら「操作している」とみなす距離 [m] */
const MOVE_THRESHOLD = 1;
/** クラクション・エモートを続けて送れる間隔 [ms] */
const HORN_INTERVAL_MS = 150;
const EMOTE_INTERVAL_MS = 1500;
/** スタートからこれだけ経っても終わらない対戦は打ち切る [ms] */
export const RACE_TIMEOUT_MS = 20 * 60_000;

export function newActivity(now: number): Activity {
  return { connectedAt: now, lastActive: now, x: null, z: null };
}

/** 車体の色の数（クライアントの REMOTE_COLORS と合わせる） */
export const COLOR_COUNT = 8;

function broadcast(all: readonly Connection[], except: Connection | null, message: ServerMessage): void {
  for (const c of all) {
    if (c !== except && c.info) c.send(message);
  }
}

/** 対戦の様子を変えて全員に知らせる。走っている全員がゴールしたら（またはいなくなったら）対戦を終える */
function updateRace(all: readonly Connection[], store: RoomStore, race: RaceState | null, by: number, start = false): void {
  if (race?.phase === 'racing') {
    const { finished } = race;
    const running = race.entrants.filter((id) => !finished.some((f) => f.id === id));
    if (running.length === 0) {
      // 最後の結果を知らせてから終える
      broadcast(all, null, { t: 'race', race, by });
      race = null;
    }
  }
  store.setRace(race);
  broadcast(all, null, { t: 'race', race, by, ...(start ? { start } : {}) });
}

/** その人を対戦から外す（言い出した人がエントリー中に抜けたら対戦ごとやめる） */
function leaveRace(all: readonly Connection[], store: RoomStore, id: number): void {
  const race = store.getRace();
  if (!race) return;
  if (race.phase === 'entry' && race.host === id) {
    updateRace(all, store, null, id);
    return;
  }
  if (!race.entrants.includes(id)) return;
  const finishedAlready = race.finished.some((f) => f.id === id);
  // ゴールした人の記録は残す
  if (race.phase === 'racing' && finishedAlready) return;
  updateRace(all, store, { ...race, entrants: race.entrants.filter((e) => e !== id) }, id);
}

/** 部屋にいる全員が準備 OK か */
export function allReady(all: readonly Connection[], race: RaceState): boolean {
  const ids = all.flatMap((c) => (c.info ? [c.info.id] : []));
  return ids.length > 0 && ids.every((id) => race.entrants.includes(id));
}

function handleRace(from: Connection, all: readonly Connection[], message: ClientMessage, store: RoomStore, now: number): void {
  const info = from.info!;
  const race = store.getRace();
  switch (message.t) {
    case 'raceOpen':
      // 対戦中は言い出せない。エントリー中は言い出した人だけが条件を変えられる
      if (race && (race.phase === 'racing' || race.host !== info.id)) return;
      store.setMap(message.settings.map);
      updateRace(all, store, { phase: 'entry', settings: message.settings, host: info.id, entrants: [], finished: [], seq: (race?.seq ?? 0) + 1 }, info.id);
      break;
    case 'raceReady': {
      if (race?.phase !== 'entry') return;
      if (message.car !== info.car) {
        from.info = { ...info, car: message.car };
        broadcast(all, from, { t: 'profile', player: from.info });
      }
      const others = race.entrants.filter((id) => id !== info.id);
      updateRace(all, store, { ...race, entrants: message.ready ? [...others, info.id] : others }, info.id);
      break;
    }
    case 'raceStart':
      if (race?.phase !== 'entry' || race.host !== info.id || !allReady(all, race)) return;
      updateRace(all, store, { ...race, phase: 'racing', startedAt: now }, info.id, true);
      break;
    case 'raceFinish':
      if (race?.phase !== 'racing' || race.seq !== message.seq || !race.entrants.includes(info.id)) return;
      if (race.finished.some((f) => f.id === info.id)) return;
      updateRace(all, store, { ...race, finished: [...race.finished, { id: info.id, time: message.time }] }, info.id);
      break;
    case 'raceCancel':
      if (!race) return;
      if (race.host === info.id) updateRace(all, store, null, info.id);
      else leaveRace(all, store, info.id);
      break;
  }
}

/**
 * 部屋の中継ロジック（描画にも Cloudflare にも依存しない部分）。
 * all には from 自身も含めた、いまつながっている接続を渡す。
 */
export function handleMessage(
  from: Connection,
  all: readonly Connection[],
  raw: string,
  store: RoomStore,
  now = Date.now(),
): void {
  const message = parseClientMessage(raw);
  if (!message) {
    from.send({ t: 'error', reason: 'badRequest' });
    return;
  }
  if (message.t === 'ping') {
    from.send({ t: 'pong', time: message.time });
    return;
  }
  if (message.t === 'hello') {
    hello(from, all, message, store);
    if (from.info) from.activity = { ...from.activity, lastActive: now };
    return;
  }
  const info = from.info;
  if (!info) return;
  switch (message.t) {
    case 'state': {
      const [x, z] = message.s;
      const a = from.activity;
      // 同じ場所に止まったまま位置を送り続けても「操作している」ことにはしない
      if (a.x === null || a.z === null || Math.hypot(x - a.x, z - a.z) >= MOVE_THRESHOLD) {
        from.activity = { ...a, lastActive: now, x, z };
      }
      broadcast(all, from, { t: 'state', id: info.id, time: message.time, s: message.s, ...(message.p !== undefined ? { p: message.p } : {}) });
      break;
    }
    case 'profile':
      from.info = { ...info, ...(message.car !== undefined ? { car: message.car } : {}), ...(message.lights !== undefined ? { lights: message.lights } : {}) };
      from.activity = { ...from.activity, lastActive: now };
      broadcast(all, from, { t: 'profile', player: from.info });
      break;
    case 'map':
      // 対戦の間はコースを変えられない
      if (store.getRace()) return;
      store.setMap(message.map);
      from.activity = { ...from.activity, lastActive: now };
      broadcast(all, from, { t: 'map', map: message.map, by: info.id });
      break;
    case 'horn': {
      const a = from.activity;
      if (message.on && a.lastHorn !== undefined && now - a.lastHorn < HORN_INTERVAL_MS) return;
      if (message.on) from.activity = { ...a, lastHorn: now };
      broadcast(all, from, { t: 'horn', id: info.id, on: message.on });
      break;
    }
    case 'emote': {
      const a = from.activity;
      if (a.lastEmote !== undefined && now - a.lastEmote < EMOTE_INTERVAL_MS) return;
      from.activity = { ...a, lastEmote: now, lastActive: now };
      // 自分にも返す（自分の車の上にも出す）
      broadcast(all, null, { t: 'emote', id: info.id, e: message.e });
      break;
    }
    case 'raceOpen':
    case 'raceReady':
    case 'raceStart':
    case 'raceFinish':
    case 'raceCancel':
      from.activity = { ...from.activity, lastActive: now };
      handleRace(from, all, message, store, now);
      break;
  }
}

function hello(
  from: Connection,
  all: readonly Connection[],
  message: Extract<ClientMessage, { t: 'hello' }>,
  store: RoomStore,
): void {
  if (from.info) return;
  if (message.v !== PROTOCOL_VERSION) {
    from.send({ t: 'error', reason: 'version' });
    from.close(4000, 'version');
    return;
  }
  const others = all.filter((c) => c !== from && c.info).map((c) => c.info!);
  if (others.length >= MAX_PLAYERS) {
    from.send({ t: 'error', reason: 'full' });
    from.close(4001, 'full');
    return;
  }
  // 最初に入った人のマップが部屋のマップになる
  if (others.length === 0) store.setMap(message.map);
  const id = Math.max(0, ...others.map((p) => p.id)) + 1;
  const usedColors = new Set(others.map((p) => p.color));
  let color = 0;
  while (usedColors.has(color) && color < COLOR_COUNT - 1) color++;
  const info: PlayerInfo = { id, name: message.name, car: message.car, color, lights: message.lights ?? false };
  from.info = info;
  from.send({ t: 'welcome', id, color, players: others, map: store.getMap(), race: store.getRace() });
  broadcast(all, from, { t: 'join', player: info });
}

export function handleClose(from: Connection, all: readonly Connection[], store?: RoomStore): void {
  const info = from.info;
  if (!info) return;
  from.info = null;
  broadcast(all, from, { t: 'leave', id: info.id });
  if (store) leaveRace(all.filter((c) => c !== from), store, info.id);
}

/**
 * 放置された接続を切る。hello を送ってこない接続と、しばらく車が動いていない人が対象。
 * 切らずに残った接続の数を返す。
 */
export function closeIdle(all: readonly Connection[], now: number, store?: RoomStore): number {
  // 長すぎる対戦は打ち切る（ゴールしないまま放っておかれたとき）
  const race = store?.getRace();
  if (store && race?.phase === 'racing' && race.startedAt !== undefined && now - race.startedAt >= RACE_TIMEOUT_MS) {
    store.setRace(null);
    broadcast(all, null, { t: 'race', race: null, by: 0 });
  }
  let remaining = 0;
  for (const c of all) {
    const a = c.activity;
    if (!c.info) {
      if (now - a.connectedAt >= HELLO_TIMEOUT_MS) c.close(4003, 'noHello');
      else remaining++;
    } else if (now - a.lastActive >= IDLE_TIMEOUT_MS) {
      c.send({ t: 'error', reason: 'idle' });
      handleClose(c, all, store);
      c.close(4002, 'idle');
    } else {
      remaining++;
    }
  }
  return remaining;
}
