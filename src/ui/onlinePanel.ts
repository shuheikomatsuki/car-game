import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, isRoomCode, normalizeRoomCode, randomRoomCode } from '../net/protocol';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

const NAME_KEY = 'car-game:name';

/** みんなで走るときとランキングで使う名前（このブラウザに保存） */
export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 保存できない環境
  }
}

export interface OnlinePanelHandlers {
  onJoin: (name: string, room: string) => void;
  onLeave: () => void;
  onOpenChange: (open: boolean) => void;
}

/** 「みんなで走る」画面: 名前と部屋コードを入れて参加する */
export class OnlinePanel {
  private readonly root = el('online');
  private readonly name = el<HTMLInputElement>('online-name');
  private readonly room = el<HTMLInputElement>('online-room');
  private readonly link = el<HTMLInputElement>('online-link');
  private readonly status = el('online-status');
  private readonly join = el<HTMLButtonElement>('online-join');
  private readonly leave = el<HTMLButtonElement>('online-leave');
  private openValue = false;
  private connected = false;
  private lastHint: string | null = null;

  constructor(
    private readonly handlers: OnlinePanelHandlers,
    private readonly serverConfigured: boolean,
  ) {
    this.name.maxLength = MAX_NAME_LENGTH;
    this.room.maxLength = ROOM_CODE_LENGTH;
    this.name.value = loadPlayerName();
    this.room.value = randomRoomCode();
    this.room.addEventListener('input', () => {
      this.room.value = normalizeRoomCode(this.room.value).slice(0, ROOM_CODE_LENGTH);
      this.refresh();
    });
    el('online-new').addEventListener('click', () => {
      this.room.value = randomRoomCode();
      this.refresh();
    });
    el('online-copy').addEventListener('click', () => {
      this.link.select();
      void navigator.clipboard?.writeText(this.link.value).then(
        () => this.setStatus('招待リンクをコピーしました'),
        () => this.setStatus('コピーできませんでした。リンクを選択してコピーしてください'),
      );
    });
    this.join.addEventListener('click', () => this.submit());
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
    this.leave.addEventListener('click', () => this.handlers.onLeave());
    el('online-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.openValue && e.key === 'Escape') {
        // 同じ Esc でメニューが開かないように
        e.preventDefault();
        this.close();
      }
    });
    if (!serverConfigured) {
      this.setStatus('このサイトにはオンライン用のサーバーがまだ設定されていません');
    }
    this.refresh();
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  /** 招待リンク（?room=XXXX）から開いたとき */
  presetRoom(code: string): void {
    const c = normalizeRoomCode(code);
    if (isRoomCode(c)) this.room.value = c;
    this.refresh();
  }

  /** hint: 開いたときに下に出す案内（無ければ今の状態のまま） */
  open(hint?: string): void {
    this.openValue = true;
    if (!this.connected && this.serverConfigured) {
      if (hint) this.setStatus(hint);
      // 前に開いたときの案内は消す
      else if (this.status.textContent === this.lastHint) this.setStatus('');
      this.lastHint = hint ?? null;
    }
    // ランキングの画面で名前を変えているかもしれない
    this.name.value = loadPlayerName();
    this.root.classList.remove('hidden');
    this.refresh();
    this.handlers.onOpenChange(true);
    (this.name.value ? this.join : this.name).focus();
  }

  close(): void {
    this.openValue = false;
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    this.handlers.onOpenChange(false);
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.refresh();
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  private submit(): void {
    if (this.join.disabled) return;
    const name = this.name.value.trim();
    savePlayerName(name);
    this.handlers.onJoin(name, this.room.value);
  }

  private refresh(): void {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('room', this.room.value);
    this.link.value = url.toString();
    this.join.disabled = !this.serverConfigured || !isRoomCode(this.room.value);
    this.join.textContent = this.connected ? 'この部屋に移る' : '参加する';
    this.leave.classList.toggle('hidden', !this.connected);
  }
}
