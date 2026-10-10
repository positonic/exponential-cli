import { describe, it, expect } from 'vitest';
import { StreamParser } from './stream.js';

const lines = [
  '{"type":"system","subtype":"init","session_id":"sess-1"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at the brief."},{"type":"tool_use","name":"Read","input":{"file":"README.md"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"# Readme"}]}}',
  'not json at all',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}',
  '{"type":"result","subtype":"success","result":"Shortlisted two venues.","usage":{"input_tokens":10},"total_cost_usd":0.02,"is_error":false}',
];

describe('StreamParser', () => {
  it('turns stream-json into numbered events and captures the result', () => {
    const p = new StreamParser(1);
    for (const line of lines) p.feed(line);
    const snap = p.snapshot();
    expect(snap.sessionId).toBe('sess-1');
    expect(snap.events.map((e) => [e.seq, e.kind])).toEqual([
      [1, 'text'], [2, 'tool_call'], [3, 'tool_result'], [4, 'tool_call'],
    ]);
    expect(snap.events[1]!.payload).toEqual({ tool: 'Read', input: '{"file":"README.md"}' });
    expect(snap.resultText).toBe('Shortlisted two venues.');
    expect(snap.isError).toBe(false);
    expect(snap.usage).toEqual({ input_tokens: 10, totalCostUsd: 0.02 });
  });

  it('drain hands out each event once', () => {
    const p = new StreamParser(5);
    p.feed(lines[1]!);
    expect(p.drain().map((e) => e.seq)).toEqual([5, 6]);
    p.feed(lines[4]!);
    expect(p.drain().map((e) => e.seq)).toEqual([7]);
    expect(p.drain()).toEqual([]);
  });

  it('an error result is an error, and a tool error is an error event', () => {
    const p = new StreamParser();
    p.feed('{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":"denied","is_error":true}]}}');
    p.feed('{"type":"result","subtype":"error_max_turns","is_error":true}');
    expect(p.events[0]!.kind).toBe('error');
    expect(p.snapshot()).toMatchObject({ isError: true, errorMessage: 'error_max_turns' });
  });
});
