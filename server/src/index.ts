import { DurableObject } from 'cloudflare:workers';
import type { PlayerInfo, ServerMessage } from '../../src/net/protocol';
import { isRoomCode } from '../../src/net/protocol';
import { type Connection, type RoomStore, handleClose, handleMessage } from './room';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
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
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;
    handleMessage(this.connection(ws), this.connections(), message, this.store);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    handleClose(this.connection(ws), this.connections());
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
  }

  webSocketError(ws: WebSocket): void {
    handleClose(this.connection(ws), this.connections());
  }

  private connections(): Connection[] {
    return this.ctx.getWebSockets().map((ws) => this.connection(ws));
  }

  /** 同じ WebSocket なら同じ Connection になるよう、WeakMap で使い回す */
  private readonly cache = new WeakMap<WebSocket, Connection>();

  private connection(ws: WebSocket): Connection {
    let c = this.cache.get(ws);
    if (!c) {
      c = {
        get info() {
          return (ws.deserializeAttachment() as PlayerInfo | null) ?? null;
        },
        set info(value: PlayerInfo | null) {
          ws.serializeAttachment(value);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/rooms\/([A-Za-z0-9]+)$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!isRoomCode(code)) return new Response('Bad room code', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }
    if (url.pathname === '/') return new Response('car-game server', { headers: { 'content-type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
