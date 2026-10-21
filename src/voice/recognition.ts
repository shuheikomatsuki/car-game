import { type Command, isEmergency, parseCommand } from '../ai/commands';

/** ブラウザの SpeechRecognition（型定義が標準に無いので必要な分だけ書く） */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceInputHandlers {
  /** 指示を認識した（緊急の指示は話し終わる前の途中結果でも届く） */
  onCommand(command: Command, transcript: string): void;
  /** 認識中・認識した文（指示でなくても届く） */
  onTranscript(text: string, final: boolean, command: Command | null): void;
  onError(message: string): void;
  onListeningChange(listening: boolean): void;
}

/**
 * マイクからの音声指示。Web Speech API（Chrome / Edge）を使う。
 * - 「止まって」「危ない」は認識の途中結果の時点で即座に実行する。
 * - それ以外は「右…いや左」のような言い直しに対応するため、確定してから実行する。
 */
export class VoiceInput {
  private recognition: SpeechRecognitionLike | null = null;
  private wanted = false;
  /** 発話ごとに実行済みの指示（途中結果と確定結果で二重に実行しないため） */
  private fired = new Map<number, Set<Command>>();

  constructor(private readonly handlers: VoiceInputHandlers) {}

  static get supported(): boolean {
    return getCtor() !== null;
  }

  get listening(): boolean {
    return this.wanted;
  }

  toggle(): void {
    if (this.wanted) this.stop();
    else this.start();
  }

  start(): void {
    const Ctor = getCtor();
    if (!Ctor) {
      this.handlers.onError('このブラウザは音声認識に対応していません（Chrome / Edge を使ってください）');
      return;
    }
    if (!this.recognition) {
      const r = new Ctor();
      r.lang = 'ja-JP';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => this.handleResult(e);
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.handlers.onError('マイクの使用が許可されていません');
          this.stop();
        } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
          this.handlers.onError(`音声認識エラー: ${e.error}`);
        }
      };
      // 無音が続くとブラウザが自動で止めるので、使用中なら再開する
      r.onend = () => {
        this.fired.clear();
        if (this.wanted) {
          try {
            r.start();
          } catch {
            // 再開に失敗したら止める
            this.stop();
          }
        }
      };
      this.recognition = r;
    }
    this.wanted = true;
    try {
      this.recognition.start();
    } catch {
      // すでに開始している
    }
    this.handlers.onListeningChange(true);
  }

  stop(): void {
    this.wanted = false;
    this.recognition?.stop();
    this.handlers.onListeningChange(false);
  }

  private handleResult(e: SpeechRecognitionEventLike): void {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const text = result[0].transcript;
      const command = parseCommand(text);
      this.handlers.onTranscript(text, result.isFinal, command);
      if (!command) continue;
      if (!result.isFinal && !isEmergency(command)) continue;
      const fired = this.fired.get(i) ?? new Set<Command>();
      // 緊急の指示を途中結果で実行済みなら、確定時に同じ指示を繰り返さない
      if (!fired.has(command)) {
        fired.add(command);
        this.fired.set(i, fired);
        this.handlers.onCommand(command, text);
      }
    }
  }
}
