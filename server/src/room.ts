import {
  type ClientMessage,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type PlayerInfo,
  type ServerMessage,
  parseClientMessage,
} from '../../src/net/protocol';

/** 部屋につながっている1人分の接続（Durable Object の WebSocket を包む） */
export interface Connection {
  /** hello を送るまでは null */
  info: PlayerInfo | null;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** 部屋の永続化する値（Durable Object が休止しても失われないように外に置く） */
export interface RoomStore {
  getMap(): number;
  setMap(map: number): void;
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
export function handleMessage(from: Connection, all: readonly Connection[], raw: string, store: RoomStore): void {
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
    return;
  }
  const info = from.info;
  if (!info) return;
  switch (message.t) {
    case 'state':
      broadcast(all, from, { t: 'state', id: info.id, time: message.time, s: message.s });
      break;
    case 'profile':
      from.info = { ...info, car: message.car };
      broadcast(all, from, { t: 'profile', player: from.info });
      break;
    case 'map':
      store.setMap(message.map);
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
