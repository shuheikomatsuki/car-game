import {
  type ClientMessage,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type PlayerInfo,
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
}

/** この時間、車が動かなければ部屋から外す [ms] */
export const IDLE_TIMEOUT_MS = 5 * 60_000;
/** つないだのにこの時間 hello を送ってこない接続は切る [ms] */
export const HELLO_TIMEOUT_MS = 15_000;
/** これ以上動いたら「操作している」とみなす距離 [m] */
const MOVE_THRESHOLD = 1;

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
      broadcast(all, from, { t: 'state', id: info.id, time: message.time, s: message.s });
      break;
    }
    case 'profile':
      from.info = { ...info, car: message.car };
      from.activity = { ...from.activity, lastActive: now };
      broadcast(all, from, { t: 'profile', player: from.info });
      break;
    case 'map':
      store.setMap(message.map);
      from.activity = { ...from.activity, lastActive: now };
      broadcast(all, from, { t: 'map', map: message.map, by: info.id });
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
  const info: PlayerInfo = { id, name: message.name, car: message.car, color };
  from.info = info;
  from.send({ t: 'welcome', id, color, players: others, map: store.getMap() });
  broadcast(all, from, { t: 'join', player: info });
}

export function handleClose(from: Connection, all: readonly Connection[]): void {
  const info = from.info;
  if (!info) return;
  from.info = null;
  broadcast(all, from, { t: 'leave', id: info.id });
}

/**
 * 放置された接続を切る。hello を送ってこない接続と、しばらく車が動いていない人が対象。
 * 切らずに残った接続の数を返す。
 */
export function closeIdle(all: readonly Connection[], now: number): number {
  let remaining = 0;
  for (const c of all) {
    const a = c.activity;
    if (!c.info) {
      if (now - a.connectedAt >= HELLO_TIMEOUT_MS) c.close(4003, 'noHello');
      else remaining++;
    } else if (now - a.lastActive >= IDLE_TIMEOUT_MS) {
      c.send({ t: 'error', reason: 'idle' });
      handleClose(c, all);
      c.close(4002, 'idle');
    } else {
      remaining++;
    }
  }
  return remaining;
}
