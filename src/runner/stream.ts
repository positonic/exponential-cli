import type { RunnerEvent, RunnerEventKind } from 'exponential-sdk';

/**
 * Turns Claude Code's `--output-format stream-json` lines into run events
 * (Exponential ADR-0067). One JSON object per line:
 *
 *   {"type":"system","subtype":"init",...}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","name":"Read","input":{...}}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":...}]}}
 *   {"type":"result","subtype":"success","result":"<final text>","usage":{...},"total_cost_usd":0.01,"is_error":false}
 *
 * The parser is deliberately tolerant: a line it does not understand becomes
 * nothing, never an exception, so a new Claude Code release cannot stall a
 * run. Codex gets its own parser later; the event shape is the contract.
 */

export interface ParsedStream {
  /** Events in order, numbered from `firstSeq`. */
  events: RunnerEvent[];
  /** The final assistant text from the `result` line, if any. */
  resultText: string | null;
  /** `result.is_error` or an `error` subtype. */
  isError: boolean;
  errorMessage: string | null;
  usage: Record<string, unknown> | null;
  /** The session id from `system.init`, when present (for resume later). */
  sessionId: string | null;
  askedOwner: boolean;
  finishedViaTool: boolean;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: ContentBlock[] | string };
  result?: string;
  is_error?: boolean;
  error?: string;
  usage?: Record<string, unknown>;
  total_cost_usd?: number;
}

const MAX_PAYLOAD_TEXT = 2000;

function clip(value: unknown, max = MAX_PAYLOAD_TEXT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export class StreamParser {
  private nextSeq: number;
  readonly events: RunnerEvent[] = [];
  resultText: string | null = null;
  isError = false;
  errorMessage: string | null = null;
  usage: Record<string, unknown> | null = null;
  sessionId: string | null = null;
  /** The session called ask_owner: the run is parked by the app; the runner must not finish it. */
  askedOwner = false;
  /** The session called finish_run itself: the runner's final finish is a no-op. */
  finishedViaTool = false;

  constructor(firstSeq = 1) {
    this.nextSeq = firstSeq;
  }

  private push(kind: RunnerEventKind, payload: Record<string, unknown>): RunnerEvent {
    const event = { seq: this.nextSeq++, kind, payload };
    this.events.push(event);
    return event;
  }

  /** Feed one line; returns the events it produced (possibly none). */
  feed(line: string): RunnerEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let parsed: StreamLine;
    try {
      parsed = JSON.parse(trimmed) as StreamLine;
    } catch {
      return [];
    }
    const before = this.events.length;

    switch (parsed.type) {
      case 'system':
        if (parsed.subtype === 'init' && typeof parsed.session_id === 'string') this.sessionId = parsed.session_id;
        break;
      case 'assistant': {
        const content = parsed.message?.content;
        if (typeof content === 'string') {
          if (content.trim()) this.push('text', { text: clip(content) });
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              const name = block.name ?? 'tool';
              const input = (block.input ?? {}) as Record<string, unknown>;
              if (name.endsWith('__report_progress') && typeof input.text === 'string') {
                // The session's own progress line: a transcript note, not a tool row.
                this.push('text', { text: clip(input.text, 500) });
              } else if (name.endsWith('__ask_owner')) {
                this.askedOwner = true;
                this.push('tool_call', { tool: 'ask-owner', snippet: clip(input.question, 200) });
              } else if (name.endsWith('__finish_run')) {
                this.finishedViaTool = true;
                this.push('tool_call', { tool: 'finish-run', readyToClose: input.readyToClose === true });
              } else {
                this.push('tool_call', { tool: name, input: clip(block.input, 500) });
              }
            } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              this.push('text', { text: clip(block.text) });
            }
          }
        }
        break;
      }
      case 'user': {
        const content = parsed.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.push(block.is_error ? 'error' : 'tool_result', {
                toolUseId: block.tool_use_id ?? null,
                output: clip(block.content, 500),
              });
            }
          }
        }
        break;
      }
      case 'result':
        this.resultText = typeof parsed.result === 'string' ? parsed.result : null;
        this.isError = parsed.is_error === true || (parsed.subtype ?? '').startsWith('error');
        this.errorMessage = this.isError ? (parsed.error ?? parsed.result ?? parsed.subtype ?? 'error') : null;
        this.usage = parsed.usage ?? null;
        if (typeof parsed.total_cost_usd === 'number') {
          this.usage = { ...(this.usage ?? {}), totalCostUsd: parsed.total_cost_usd };
        }
        break;
      default:
        break;
    }
    return this.events.slice(before);
  }

  /** Events not yet handed out by a previous `drain`. */
  private drained = 0;
  drain(): RunnerEvent[] {
    const batch = this.events.slice(this.drained);
    this.drained = this.events.length;
    return batch;
  }

  snapshot(): ParsedStream {
    return {
      events: [...this.events],
      resultText: this.resultText,
      isError: this.isError,
      errorMessage: this.errorMessage,
      usage: this.usage,
      sessionId: this.sessionId,
      askedOwner: this.askedOwner,
      finishedViaTool: this.finishedViaTool,
    };
  }
}
