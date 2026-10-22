/**
 * 先行後追い（サドンデス）のバトル。2台が前後に並んでスタートし、1本ずつ走って判定する。
 *
 * - 後追いが先行を抜いて先にゴールしたら、後追いの勝ち
 * - 先行が先にゴールし、後追いが SAFE_SECONDS 秒より遅れてゴールしたら（まだゴールしていなくても）、先行の勝ち
 * - 後追いが SAFE_SECONDS 秒以内に続いてゴールしたら引き分け。先行と後追いを入れ替えて次の1本へ
 *
 * 途中でどれだけ差が開いても、判定はゴールの時点でする
 */

/** 先行のゴールから、後追いがこの秒数以内に続いてゴールすれば引き分け [s] */
export const SAFE_SECONDS = 1;
/** スタートで後追いが先行の後ろに並ぶ間隔 [m] */
export const CHASE_START_GAP = 12;

export type RunOutcome = 'leadWins' | 'chaseWins' | 'draw';

/** 1台の走り */
export interface Runner {
  /** スタートラインからコースに沿って進んだ距離 [m] */
  distance: number;
  /** ゴールしていればタイム（スタートの合図からの秒数）、まだなら null */
  finishTime: number | null;
}

/** 1本の走りを判定する。time はいまの時刻（スタートの合図からの秒数）。まだ決まらなければ null */
export function judgeRun(lead: Runner, chase: Runner, time: number, safe = SAFE_SECONDS): RunOutcome | null {
  if (chase.finishTime !== null && (lead.finishTime === null || chase.finishTime < lead.finishTime)) return 'chaseWins';
  if (lead.finishTime === null) return null;
  if (chase.finishTime !== null) return chase.finishTime - lead.finishTime <= safe ? 'draw' : 'leadWins';
  return time - lead.finishTime > safe ? 'leadWins' : null;
}

/** 先行後追いのバトルの進行（何本目か、どちらが先行か、勝ったのは誰か） */
export class SuddenDeath {
  /** 何本目か（1 から） */
  round = 1;
  /** いまの1本で自分が先行か */
  playerLeads: boolean;
  /** 決着がついたら勝った側 */
  winner: 'player' | 'rival' | null = null;
  /** いまの1本の判定（まだなら null） */
  outcome: RunOutcome | null = null;

  constructor(playerLeadsFirst: boolean) {
    this.playerLeads = playerLeadsFirst;
  }

  /** 毎ステップ呼ぶ。time はいまの時刻。この1本の判定が決まったときだけ結果を返す（決まった後は null） */
  update(player: Runner, rival: Runner, time: number): RunOutcome | null {
    if (this.outcome !== null) return null;
    const [lead, chase] = this.playerLeads ? [player, rival] : [rival, player];
    const outcome = judgeRun(lead, chase, time);
    if (outcome === null) return null;
    this.outcome = outcome;
    if (outcome !== 'draw') {
      const leadWon = outcome === 'leadWins';
      this.winner = leadWon === this.playerLeads ? 'player' : 'rival';
    }
    return outcome;
  }

  /** 先行が後追いより前にいる距離 [m]（スタートの間隔を含む） */
  gap(player: Runner, rival: Runner): number {
    return this.playerLeads ? player.distance - rival.distance : rival.distance - player.distance;
  }

  /** 引き分けのあと、先行と後追いを入れ替えて次の1本へ */
  nextRound(): void {
    if (this.outcome !== 'draw') return;
    this.round++;
    this.playerLeads = !this.playerLeads;
    this.outcome = null;
  }
}
