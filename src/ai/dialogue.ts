import type { DriverEvent } from './driver';

/** キャラクターの名前（仮）。設定が決まったらここを変える */
export const CHARACTER_NAME = 'アッティー';

export type Mood = 'neutral' | 'happy' | 'nervous' | 'panic' | 'sad';

export interface Line {
  text: string;
  mood: Mood;
}

/** DriverEvent に加えて、会話のきっかけになる出来事 */
export type DialogueTrigger =
  | DriverEvent
  | { type: 'greeting' }
  | { type: 'idle' }
  | { type: 'notUnderstood' };

type Table = { lines: string[]; mood: Mood; priority: number };

/**
 * セリフ表。priority が高いものは直前のセリフを遮って話す。
 * 注意: 音声認識が自分のセリフを拾っても指示と誤解しないよう、
 * 「止まって」「ブレーキ」「右に」などの指示の言葉はなるべく使わない。
 */
const ACK: Record<string, Table> = {
  start: { lines: ['しゅっぱーつ！', 'じゃあ、行くね！', 'オッケー、出るよ！'], mood: 'happy', priority: 2 },
  faster: { lines: ['スピード上げるね！', 'いっくよー！', 'ぐんぐん行くよ！'], mood: 'happy', priority: 2 },
  slower: { lines: ['うん、そっとね', 'のんびり行こっか', 'このくらい？'], mood: 'neutral', priority: 2 },
  stop: { lines: ['は、はいっ！', '了解っ！', 'いま止めるね！'], mood: 'nervous', priority: 3 },
  danger: { lines: ['きゃっ！', 'わわっ！？', 'ひゃあっ！'], mood: 'panic', priority: 5 },
  turnLeft: { lines: ['次はひだりね！', 'ひだり、ひだり…', 'ひだりだね、わかった！'], mood: 'neutral', priority: 2 },
  turnRight: { lines: ['次はみぎね！', 'みぎ、みぎ…', 'みぎだね、まかせて！'], mood: 'neutral', priority: 2 },
  straight: { lines: ['まっすぐね！', 'このまま行くね'], mood: 'neutral', priority: 2 },
  correctLeft: { lines: ['えっ、ここじゃないの！？', 'あ、その次ね！'], mood: 'nervous', priority: 3 },
  correctRight: { lines: ['えっ、ここじゃないの！？', 'あ、その次ね！'], mood: 'nervous', priority: 3 },
  uturn: { lines: ['くるっと戻るね！', '引き返すね！'], mood: 'happy', priority: 2 },
};

const EVENTS: Record<string, Table> = {
  autoTurnLeft: { lines: ['この先まっすぐ行けないから、ひだりに行くね', '突き当たりはひだりに行くね'], mood: 'neutral', priority: 2 },
  autoTurnRight: { lines: ['この先まっすぐ行けないから、みぎに行くね', '突き当たりはみぎに行くね'], mood: 'neutral', priority: 2 },
  turning: { lines: ['曲がるよ！', 'ハンドル切るね', 'よいしょっと'], mood: 'happy', priority: 1 },
  uturning: { lines: ['くるっとね…！', '大回りするよ〜'], mood: 'happy', priority: 1 },
  wrongTurn: { lines: ['あっ、間違えた…！', 'あれ？こっちじゃなかった…', 'ご、ごめん、逆に曲がっちゃった'], mood: 'sad', priority: 4 },
  tooLate: { lines: ['もう曲がっちゃった…！', 'えっ、もう遅いよぉ'], mood: 'sad', priority: 3 },
  obstacle: { lines: ['前に何かあるよ', 'これ以上進めないよ？'], mood: 'nervous', priority: 3 },
  suddenBrake: { lines: ['わっ、なんか怖くて…', 'ご、ごめん、足が勝手に…'], mood: 'nervous', priority: 3 },
  stopped: { lines: ['ふぅ…', 'ちゃんとできた…！', 'セーフ…かな？'], mood: 'neutral', priority: 1 },
  collision: { lines: ['いたっ…ごめん！', 'ぶつけちゃった…', 'あわわ…どうしよう'], mood: 'sad', priority: 5 },
  lost: { lines: ['ここ、道じゃないよね…？', 'どこ走ってるんだろ…'], mood: 'nervous', priority: 3 },
  greeting: { lines: [`よろしくね！「発進して」って言ってくれたら出発するよ`], mood: 'happy', priority: 1 },
  idle: { lines: ['運転って楽しいね', 'ちゃんと前見てるよ！', 'このへん、いい景色だね', '行きたい方向があったら言ってね'], mood: 'happy', priority: 0 },
  notUnderstood: { lines: ['え？なんて？', 'ごめん、もう一回言って？'], mood: 'neutral', priority: 1 },
};


export class Dialogue {
  private lastIndex = new Map<string, number>();

  constructor(private readonly rng: () => number) {}

  /** 出来事に対するセリフ。話すことが無ければ null */
  lineFor(trigger: DialogueTrigger): (Line & { priority: number }) | null {
    let table: Table | undefined;
    let key: string;
    if (trigger.type === 'ack') {
      key = `ack:${trigger.command}`;
      table = ACK[trigger.command];
    } else {
      key = trigger.type === 'autoTurn' ? (trigger.turn === 'right' ? 'autoTurnRight' : 'autoTurnLeft') : trigger.type;
      table = EVENTS[key];
    }
    if (!table) return null;
    let text = this.pick(key, table.lines);
    if (trigger.type === 'ack' && trigger.speedKmh !== undefined && trigger.command !== 'start') {
      text += `（${trigger.speedKmh}km/h）`;
    }
    return { text, mood: table.mood, priority: table.priority };
  }

  /** 同じセリフが続かないように選ぶ */
  private pick(key: string, lines: string[]): string {
    if (lines.length === 1) return lines[0];
    const last = this.lastIndex.get(key);
    let i = Math.floor(this.rng() * lines.length);
    if (i === last) i = (i + 1) % lines.length;
    this.lastIndex.set(key, i);
    return lines[i];
  }
}
