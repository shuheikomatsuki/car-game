import { DurableObject } from 'cloudflare:workers';
import type { PlayerInfo, ServerMessage } from '../../src/net/protocol';
import { isRoomCode } from '../../src/net/protocol';
import { type DenyReason, checkAccess } from './access';
import { type Activity, type Connection, type RoomStore, closeIdle, handleClose, handleMessage, newActivity } from './room';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  /** wrangler.jsonc の vars を参照 */
  ALLOWED_ORIGINS: string;
  ALLOWED_COUNTRIES: string;
}

/** 放置された接続を確かめる間隔 [ms] */
const IDLE_CHECK_INTERVAL_MS = 30_000;

/** WebSocket の attachment に保存する、接続ごとの情報（休止しても失われない） */
interface Attachment {
  info: PlayerInfo | null;
  activity: Activity;
}

/**
 * 1つの部屋 = 1つの Durable Object。WebSocket Hibernation を使い、
 * 誰も話していない間は休止してリソースを使わない（接続情報は WebSocket の attachment に保存）。
 */
export class Room extends DurableObject<Env> {
  private readonly store: RoomStore = {
    getMap: () => this.ctx.storage.kv.get<number>('map') ?? 0,
    setMap: (map) => this.ctx.storage.kv.put('map', map),
  };

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ info: null, activity: newActivity(Date.now()) } satisfies Attachment);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CHECK_INTERVAL_MS);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;
    handleMessage(this.connection(ws), this.connections(), message, this.store);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    handleClose(this.connection(ws), this.connections());
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
    await this.cleanUpIfEmpty(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    handleClose(this.connection(ws), this.connections());
    await this.cleanUpIfEmpty(ws);
  }

  /** 定期的に放置された接続を切る。誰もいなくなったら止める */
  async alarm(): Promise<void> {
    const remaining = closeIdle(this.connections(), Date.now());
    if (remaining > 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_CHECK_INTERVAL_MS);
    else await this.cleanUp();
  }

  /** 最後の1人が抜けたら、部屋に保存した値（マップ）とアラームを消す */
  private async cleanUpIfEmpty(closing: WebSocket): Promise<void> {
    if (this.ctx.getWebSockets().some((ws) => ws !== closing && ws.readyState === WebSocket.OPEN)) return;
    await this.cleanUp();
  }

  private async cleanUp(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private connections(): Connection[] {
    return this.ctx.getWebSockets().map((ws) => this.connection(ws));
  }

  /** 同じ WebSocket なら同じ Connection になるよう、WeakMap で使い回す */
  private readonly cache = new WeakMap<WebSocket, Connection>();

  private connection(ws: WebSocket): Connection {
    let c = this.cache.get(ws);
    if (!c) {
      const read = () => ws.deserializeAttachment() as Attachment;
      c = {
        get info() {
          return read().info;
        },
        set info(info: PlayerInfo | null) {
          ws.serializeAttachment({ ...read(), info } satisfies Attachment);
        },
        get activity() {
          return read().activity;
        },
        set activity(activity: Activity) {
          ws.serializeAttachment({ ...read(), activity } satisfies Attachment);
        },
        send(message: ServerMessage) {
          try {
            ws.send(JSON.stringify(message));
          } catch {
            // 切断済みの相手には送らない
          }
        },
        close(code: number, reason: string) {
          ws.close(code, reason);
        },
      };
      this.cache.set(ws, c);
    }
    return c;
  }
}

/**
 * 接続を断る。Durable Object は起こさず、この Worker の中だけで済ませる。
 * ブラウザの WebSocket は HTTP のエラーを読めないので、一度つないで理由を送ってから閉じる。
 */
function deny(request: Request, reason: DenyReason): Response {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Forbidden', { status: 403 });
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: 'error', reason } satisfies ServerMessage));
  pair[1].close(4004, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/rooms\/([A-Za-z0-9]+)$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!isRoomCode(code)) return new Response('Bad room code', { status: 400 });
      const denied = checkAccess(request.headers.get('Origin'), request.cf?.country as string | undefined, {
        allowedOrigins: env.ALLOWED_ORIGINS,
        allowedCountries: env.ALLOWED_COUNTRIES,
      });
      if (denied) return deny(request, denied);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }
    if (url.pathname === '/') return new Response('car-game server', { headers: { 'content-type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
