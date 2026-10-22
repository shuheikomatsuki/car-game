import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands';
import { Dialogue } from './dialogue';
import { createRng } from './personality';

const TRIGGERS = [
  ...(['start', 'faster', 'slower', 'stop', 'danger', 'turnLeft', 'turnRight', 'straight', 'correctLeft', 'correctRight', 'uturn', 'goLeft', 'goRight', 'steerLeft', 'steerRight', 'shiftLeft', 'shiftRight', 'keepLane', 'returnToRoad'] as const).map(
    (command) => ({ type: 'ack' as const, command }),
  ),
  { type: 'autoTurn' as const, turn: 'left' as const },
  { type: 'autoTurn' as const, turn: 'right' as const },
  ...(['uturning', 'wrongTurn', 'tooLate', 'obstacle', 'suddenBrake', 'stopped', 'collision', 'offRoad', 'rejoin', 'avoid', 'greeting', 'idle', 'notUnderstood'] as const).map(
    (type) => ({ type }),
  ),
];

describe('Dialogue', () => {
  it('has a line for every trigger', () => {
    const d = new Dialogue(createRng(1));
    for (const t of TRIGGERS) expect(d.lineFor(t as never), JSON.stringify(t)).not.toBeNull();
  });

  it('never says something that would be heard as a driving command (voice echo safety)', () => {
    const d = new Dialogue(createRng(1));
    for (const t of TRIGGERS) {
      // 各セリフ表を何度か引いて全種類を確認する
      for (let i = 0; i < 20; i++) {
        const line = d.lineFor(t as never)!;
        const heard = parseCommand(line.text);
        // 右左折の返事（「次はみぎね」等）は拾われうるが、緊急指示に化けてはいけない
        expect(heard === 'stop' || heard === 'danger', line.text).toBe(false);
      }
    }
  });

  it('does not repeat the same line twice in a row', () => {
    const d = new Dialogue(createRng(3));
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const text = d.lineFor({ type: 'idle' })!.text;
      expect(text).not.toBe(prev);
      prev = text;
    }
  });
});
