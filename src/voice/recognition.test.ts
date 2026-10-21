import { describe, expect, it } from 'vitest';
import type { Command } from '../ai/commands';
import { VoiceInput } from './recognition';

/** 認識結果のイベントを組み立てる（results[i] = [文, 確定したか]） */
function event(resultIndex: number, results: [string, boolean][]) {
  const list = results.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } }));
  return { resultIndex, results: Object.assign(list, { length: list.length }) };
}

function setup() {
  const commands: Command[] = [];
  const input = new VoiceInput({
    onCommand: (c) => commands.push(c),
    onTranscript: () => {},
    onError: () => {},
    onListeningChange: () => {},
  });
  const feed = (e: ReturnType<typeof event>) =>
    (input as unknown as { handleResult(e: unknown): void }).handleResult(e);
  return { commands, feed };
}

describe('VoiceInput', () => {
  it('fires emergency commands from interim results, only once per utterance', () => {
    const { commands, feed } = setup();
    feed(event(0, [['とま', false]]));
    expect(commands).toEqual([]);
    feed(event(0, [['止まって', false]]));
    expect(commands).toEqual(['stop']);
    feed(event(0, [['止まって！', true]]));
    expect(commands).toEqual(['stop']);
  });

  it('waits for the final result for non-emergency commands (so corrections work)', () => {
    const { commands, feed } = setup();
    feed(event(0, [['右', false]]));
    feed(event(0, [['右、いや左', false]]));
    expect(commands).toEqual([]);
    feed(event(0, [['右、いや左', true]]));
    expect(commands).toEqual(['turnLeft']);
  });

  it('handles separate utterances independently', () => {
    const { commands, feed } = setup();
    feed(event(0, [['発進して', true]]));
    feed(event(1, [['発進して', true], ['ストップ', false]]));
    expect(commands).toEqual(['start', 'stop']);
  });
});
