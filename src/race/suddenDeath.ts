/**
 * 先行後追い（サドンデス）のバトル。2台が前後に並んでスタートし、1本ずつ走って判定する。
 *
 * - 先行が後追いを大きく引き離したら（BREAKAWAY_DISTANCE 以上）、その時点で先行の勝ち
 * - 後追いが先行を抜いて先にゴールしたら、後追いの勝ち
 * - どちらでもなく先行がゴールしたら引き分け。先行と後追いを入れ替えて次の1本へ
 */

/** 先行の勝ちになる、コースに沿った差 [m] */
export const BREAKAWAY_DISTANCE = 100;
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

/** 1本の走りを判定する。まだ決まらなければ null */
export function judgeRun(lead: Runner, chase: Runner, breakaway = BREAKAWAY_DISTANCE): RunOutcome | null {
  if (chase.finishTime !== null && (lead.finishTime === null || chase.finishTime < lead.finishTime)) return 'chaseWins';
  if (lead.distance - chase.distance >= breakaway) return 'leadWins';
  if (lead.finishTime !== null) return 'draw';
  return null;
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

  /** 毎ステップ呼ぶ。この1本の判定が決まったときだけ結果を返す（決まった後は null） */
  update(player: Runner, rival: Runner): RunOutcome | null {
    if (this.outcome !== null) return null;
    const [lead, chase] = this.playerLeads ? [player, rival] : [rival, player];
    const outcome = judgeRun(lead, chase);
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
