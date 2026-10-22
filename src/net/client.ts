import { type ClientMessage, PROTOCOL_VERSION, type ServerMessage } from './protocol';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface NetHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: NetStatus, detail?: string) => void;
}

export interface JoinOptions {
  name: string;
  car: string;
  map: number;
}

/** 切れたときに再接続を試す回数と間隔 [ms] */
const RETRY_DELAYS = [1000, 2000, 4000, 8000];

/** 再接続しても直らないエラーの説明（これを受け取ったらつなぎ直さない） */
const ERROR_DETAILS: Partial<Record<Extract<ServerMessage, { t: 'error' }>['reason'], string>> = {
  full: '部屋が満員です',
  version: 'ゲームのバージョンが違います。ページを再読み込みしてください',
  idle: 'しばらく車が動いていなかったので、部屋から外れました',
  origin: 'このページからはサーバーに接続できません',
  region: '日本国外からは接続できません',
};

/** サーバーの URL（https://…）から部屋の WebSocket の URL を作る */
export function roomSocketUrl(server: string, room: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms/${room}`;
  return url.toString();
}

/** 部屋への WebSocket 接続。切れたら少し待って自動でつなぎ直す */
export class NetClient {
  private socket: WebSocket | null = null;
  private target: { url: string; join: JoinOptions } | null = null;
  private retries = 0;
  private retryTimer: number | undefined;
  private statusValue: NetStatus = 'offline';
  private selfId: number | null = null;

  constructor(private readonly handlers: NetHandlers) {}

  get status(): NetStatus {
    return this.statusValue;
  }

  get id(): number | null {
    return this.selfId;
  }

  get isOnline(): boolean {
    return this.statusValue === 'online';
  }

  connect(server: string, room: string, join: JoinOptions): void {
    this.disconnect();
    this.target = { url: roomSocketUrl(server, room), join };
    this.retries = 0;
    this.open('connecting');
  }

  disconnect(): void {
    this.target = null;
    window.clearTimeout(this.retryTimer);
    const s = this.socket;
    this.socket = null;
    s?.close(1000, 'bye');
    this.selfId = null;
    this.setStatus('offline');
  }

  /** 再接続のときに使う情報（車やマップが変わったとき）を更新する */
  updateJoin(join: Partial<JoinOptions>): void {
    if (this.target) this.target.join = { ...this.target.join, ...join };
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.statusValue === 'online') {
      this.socket.send(JSON.stringify(message));
    }
  }

  private open(status: NetStatus): void {
    if (!this.target) return;
    this.setStatus(status);
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.target.url);
    } catch {
      this.setStatus('error', 'サーバーの URL が正しくありません');
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket || !this.target) return;
      socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, ...this.target.join } satisfies ClientMessage));
    });
    socket.addEventListener('message', (e) => {
      if (socket !== this.socket || typeof e.data !== 'string') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'welcome') {
        this.selfId = message.id;
        this.retries = 0;
        this.setStatus('online');
      } else if (message.t === 'error') {
        const detail = ERROR_DETAILS[message.reason];
        if (detail) {
          this.target = null;
          this.setStatus('error', detail);
        }
      }
      this.handlers.onMessage(message);
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.selfId = null;
      if (!this.target) return;
      if (this.retries >= RETRY_DELAYS.length) {
        this.target = null;
        this.setStatus('error', 'サーバーにつながりません');
        return;
      }
      const delay = RETRY_DELAYS[this.retries++];
      this.setStatus('reconnecting');
      this.retryTimer = window.setTimeout(() => this.open('reconnecting'), delay);
    });
  }

  private setStatus(status: NetStatus, detail?: string): void {
    this.statusValue = status;
    this.handlers.onStatus(status, detail);
  }
}
