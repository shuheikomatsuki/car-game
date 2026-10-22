/**
 * キャラクターのセリフの読み上げ（Web Speech API の音声合成）。
 * 端末に日本語の音声が無い場合は何もしない（字幕だけになる）。
 */
export class VoiceOutput {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private speakingUntil = 0;
  private unlocked = false;

  constructor() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('ja'));
      // 女性的な声を優先（名前で判別できる範囲で）
      this.voice =
        voices.find((v) => /kyoko|nanami|haruka|ayumi|female|女性/i.test(v.name)) ?? voices[0] ?? null;
    };
    pick();
    speechSynthesis.addEventListener('voiceschanged', pick);
  }

  /** 読み上げ中（音声認識が自分の声を拾わないよう、この間は通常の指示を無視する） */
  get speaking(): boolean {
    return performance.now() < this.speakingUntil || ('speechSynthesis' in window && speechSynthesis.speaking);
  }

  speak(text: string): void {
    if (!this.enabled || !this.voice) return;
    // 括弧内（速度表示など）は読まない
    const spoken = text.replace(/（.*?）/g, '');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(spoken);
    u.voice = this.voice;
    u.lang = 'ja-JP';
    u.pitch = 1.5;
    u.rate = 1.1;
    u.onend = () => {
      this.speakingUntil = performance.now() + 400;
    };
    this.speakingUntil = performance.now() + 400 + spoken.length * 150;
    speechSynthesis.speak(u);
  }

  /**
   * iPhone などは、最初の読み上げをユーザー操作の中で行わないと以降も声が出ない。
   * 画面に触れたときに無音の読み上げを一度だけ行っておく。
   */
  unlock(): void {
    if (this.unlocked || !('speechSynthesis' in window)) return;
    this.unlocked = true;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  cancel(): void {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
