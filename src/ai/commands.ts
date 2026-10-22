/**
 * キャラクターへの運転指示。音声・キーボード・画面ボタンのどれから来ても同じ形になる。
 */
export type Command =
  | 'start'
  | 'faster'
  | 'slower'
  | 'stop'
  | 'danger'
  /** 次の交差点で左／右 */
  | 'turnLeft'
  | 'turnRight'
  /** 「右」「左」だけ: すぐ先に曲がれる交差点があればそこで、無ければその場で曲がる */
  | 'goLeft'
  | 'goRight'
  /** 今すぐその場で左／右へ（道路から外れてもよい） */
  | 'steerLeft'
  | 'steerRight'
  | 'straight'
  | 'correctLeft'
  | 'correctRight'
  | 'uturn'
  | 'shiftLeft'
  | 'shiftRight'
  | 'keepLane'
  | 'returnToRoad';

/** 即座に反応すべき緊急の指示（音声認識の途中結果でも実行する） */
export function isEmergency(c: Command): boolean {
  return c === 'stop' || c === 'danger';
}

export interface CommandInfo {
  command: Command;
  label: string;
  key: string;
}

/** 画面ボタン・キー割り当て（表示順） */
export const COMMAND_BUTTONS: readonly CommandInfo[] = [
  { command: 'start', label: '発進して', key: '1' },
  { command: 'faster', label: 'スピード上げて', key: '2' },
  { command: 'slower', label: 'ゆっくり', key: '3' },
  { command: 'stop', label: '止まって', key: '4' },
  { command: 'turnLeft', label: '次を左', key: '5' },
  { command: 'turnRight', label: '次を右', key: '6' },
  { command: 'steerLeft', label: '今すぐ左', key: 'T' },
  { command: 'steerRight', label: '今すぐ右', key: 'Y' },
  { command: 'straight', label: 'まっすぐ', key: '7' },
  { command: 'danger', label: '危ない！', key: '8' },
  { command: 'correctLeft', label: 'そこじゃなくて次を左', key: '9' },
  { command: 'correctRight', label: 'そこじゃなくて次を右', key: '0' },
  { command: 'uturn', label: 'Uターン', key: 'U' },
  { command: 'shiftLeft', label: '左に寄って', key: 'Z' },
  { command: 'shiftRight', label: '右に寄って', key: 'X' },
  { command: 'keepLane', label: '車線に戻って', key: 'L' },
  { command: 'returnToRoad', label: '道に戻って', key: 'B' },
];

/** 句読点・空白・長音を除き、カタカナをひらがなにそろえる（パターンもこの形で書く） */
export function normalize(text: string): string {
  return text
    .replace(/[\s、。，．,.!！?？・ー〜~「」]/g, '')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .toLowerCase();
}

const LEFT = /(左|ひだり)/;
const RIGHT = /(右|みぎ)/;

/** 「右」と「左」の両方を含む場合は後に出てきたほうを採用する（例: 右…いや左） */
function lastSide(t: string): 'left' | 'right' | null {
  const l = t.search(/(左|ひだり)(?!.*(左|ひだり))/);
  const r = t.search(/(右|みぎ)(?!.*(右|みぎ))/);
  if (l < 0 && r < 0) return null;
  return l > r ? 'left' : 'right';
}

function sided(left: Command, right: Command): (t: string) => Command | null {
  return (t) => {
    const side = lastSide(t);
    return side === 'left' ? left : side === 'right' ? right : null;
  };
}

/** 判定順が意味を持つ（緊急 → 戻る → 訂正 → 寄せる → 今すぐ曲がる → Uターン → 右左折 → …） */
const RULES: { command: Command | ((t: string) => Command | null); pattern: RegExp }[] = [
  { command: 'danger', pattern: /(危な|あぶな|あぶね|危険|きけん|ぶつかる)/ },
  { command: 'stop', pattern: /(止まって|とまって|止まれ|とまれ|止めて|とめて|すとっぷ|stop|停止|ていし|ぶれき)/ },
  // 「車線に戻って」「道に戻って」は Uターンの「戻って」より先に判定する
  { command: 'keepLane', pattern: /(車線|しゃせん|元の位置|もとのいち|普通に走|ふつうに走)/ },
  { command: 'returnToRoad', pattern: /(道に戻|みちにもど|道路に戻|どうろにもど|道に出|みちにで|道路に出|どうろにで|こすに戻|こすにもど)/ },
  {
    command: (t) => (LEFT.test(t) ? 'correctLeft' : RIGHT.test(t) ? 'correctRight' : null),
    pattern: /(じゃなく|じゃない|ではなく|違う|ちがう|ちがくて|そこじゃ|ここじゃ)/,
  },
  {
    // 「右に寄って」「ちょっと左」: 曲がらずに走る位置だけ変える（自由に走っているときは少しだけ向きを変える）
    command: sided('shiftLeft', 'shiftRight'),
    pattern: /(寄って|よって|寄せて|よせて|寄り|より|ずれて|ちょっと|少し|すこし)/,
  },
  {
    // 「今すぐ右」「ここで左」「右に切って」: その場で曲がる（道路から外れてもよい）
    command: sided('steerLeft', 'steerRight'),
    pattern: /(今すぐ|いますぐ|すぐに|ここで|ここを|ここ右|ここ左|ここみぎ|ここひだり|今右|今左|いまみぎ|いまひだり|切って|きって|はんどる)/,
  },
  { command: 'uturn', pattern: /(uた|ｕた|ゆた|ゆうた|引き返|ひきかえ|戻って|もどって|逆に行|反対に行)/ },
  // 「次を右」「交差点を左」: 次の交差点で曲がる
  { command: sided('turnLeft', 'turnRight'), pattern: /(次|つぎ|交差点|こうさてん|角|かど|突き当|つきあた|その先|そのさき)/ },
  // 「右」「左に曲がって」: すぐ先に交差点があればそこで、無ければその場で曲がる
  { command: sided('goLeft', 'goRight'), pattern: /(左|ひだり|右|みぎ)/ },
  { command: 'straight', pattern: /(まっすぐ|真っ直ぐ|真っすぐ|直進|ちょくしん)/ },
  { command: 'slower', pattern: /(ゆっくり|ゆっくし|おそく|遅く|すぴどおと|すぴど落と|速度落と|落として|おとして|減速)/ },
  { command: 'faster', pattern: /(飛ばして|とばして|すぴどあげ|すぴどあっぷ|すぴど上げ|速度上げ|上げて|あげて|速く|はやく|急いで|いそいで|加速)/ },
  // 音声認識は「はっしん」を「発信」「発振」などの同音語で返すことがあるので、それらも受け付ける
  { command: 'start', pattern: /(発進|発信|発振|八進|はっしん|発車|はっしゃ|出発|しゅっぱつ|進んで|すすんで|行って|いって|行こう|いこう|動いて|うごいて|go|よし)/ },
];

/** 発話から指示を1つ読み取る。該当しなければ null */
export function parseCommand(text: string): Command | null {
  const t = normalize(text);
  if (!t) return null;
  for (const rule of RULES) {
    if (!rule.pattern.test(t)) continue;
    const c = typeof rule.command === 'function' ? rule.command(t) : rule.command;
    if (c) return c;
  }
  return null;
}
