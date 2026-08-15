/** The REPL main loop: prompt routing, flush boundaries, and slash dispatch. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { runRepl } from '../src/run.ts'
import { createViewStore } from '../src/view.ts'

/** A scripted nextLine over a fixed input list; null once exhausted. */
function scriptedInput(lines: string[]) {
  let index = 0
  return () => Promise.resolve(lines[index++] ?? null)
}

interface Bench {
  run(): Promise<number>
  prompts: string[]
  notices: string[]
  flushCount: number
}

/** Drive runRepl against a mock agent that records followups. */
async function bench(lines: string[]): Promise<Bench> {
  const prompts: string[] = []
  const agent = {
    id: SessionId('session-test'),
    options: {},
    session: { id: SessionId('session-test') } as Session,
    inbox: { hasPending: false },
    status: 'idle',
    ctx: {} as never,
    cancel: () => {},
    runMaintenance: () => Promise.resolve(),
    send: () => {},
    followup: (message: { content: readonly { type: string; text?: string }[] }) => {
      prompts.push(message.content.map(block => (block as { text: string }).text).join(''))
    },
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  const view = createViewStore()
  const notices: string[] = []
  view.subscribe(() => {
    const last = view.getSnapshot().items.at(-1)
    if (last?.kind === 'notice') notices.push(last.text)
  })
  const flush = vi.fn(async (_session: Session) => true)
  const code = await runRepl({
    agent,
    view,
    nextLine: scriptedInput(lines),
    sessions: { flush },
  })
  return { run: () => Promise.resolve(code), prompts, notices, flushCount: flush.mock.calls.length }
}

afterEach(() => { vi.restoreAllMocks() })

describe('runRepl', () => {
  it('drives each plain prompt through followup and flushes per turn', async () => {
    const b = await bench(['hello', 'world', '/exit'])
    expect(b.prompts).toEqual(['hello', 'world'])
    // one idle+flush per prompt, plus one flush before the /exit line is read
    expect(b.flushCount).toBeGreaterThanOrEqual(3)
  })

  it('routes built-in slash commands without touching the model', async () => {
    const b = await bench(['/help', '/nope', '/exit'])
    expect(b.prompts).toEqual([])
    expect(b.notices.some(text => text.includes('Type a message'))).toBe(true)
    expect(b.notices.some(text => text.includes('unknown command: /nope'))).toBe(true)
  })

  it('returns 0 on /exit and on EOF', async () => {
    expect(await bench(['/exit']).then(b => b.run())).toBe(0)
    expect(await bench([]).then(b => b.run())).toBe(0)
  })

  it('dispatches unknown slash names to the injected command table', async () => {
    const handled: string[][] = []
    const agent = {
      whenIdle: () => Promise.resolve(),
      session: { id: SessionId('session-test') } as Session,
    } as unknown as Agent
    const view = createViewStore()
    const code = await runRepl({
      agent,
      view,
      nextLine: scriptedInput(['/model deepseek-v4-flash', '/exit']),
      sessions: { flush: vi.fn(async (_session: Session) => true) },
      commands: {
        model: async (args) => { handled.push(args) },
      },
    })
    expect(code).toBe(0)
    expect(handled).toEqual([['deepseek-v4-flash']])
  })

  it('falls back to the command registry after the injected table misses', async () => {
    const resolved: string[] = []
    const agent = {
      whenIdle: () => Promise.resolve(),
      session: { id: SessionId('session-test') } as Session,
    } as unknown as Agent
    const view = createViewStore()
    const notices: string[] = []
    view.subscribe(() => {
      const last = view.getSnapshot().items.at(-1)
      if (last?.kind === 'notice') notices.push(last.text)
    })
    const code = await runRepl({
      agent,
      view,
      nextLine: scriptedInput(['/compact', '/permission workspace-write', '/nope', '/exit']),
      sessions: { flush: vi.fn(async (_session: Session) => true) },
      runCommand: async (raw) => {
        resolved.push(raw)
        if (raw.startsWith('/nope')) return undefined
        return { text: `ok: ${raw}` }
      },
    })
    expect(code).toBe(0)
    expect(resolved).toEqual(['/compact', '/permission workspace-write', '/nope'])
    expect(notices).toContain('ok: /compact')
    expect(notices).toContain('ok: /permission workspace-write')
    expect(notices.some(text => text.includes('unknown command: /nope'))).toBe(true)
  })

  it('lists saved sessions and switches the live agent through /session', async () => {
    const switchCalls: string[] = []
    const notices: string[] = []
    const first = {
      id: SessionId('session-a'),
      session: { id: SessionId('session-a') } as Session,
      whenIdle: () => Promise.resolve(),
    } as unknown as Agent
    const second = {
      id: SessionId('session-b'),
      session: { id: SessionId('session-b') } as Session,
      whenIdle: () => Promise.resolve(),
    } as unknown as Agent
    const view = createViewStore()
    view.subscribe(() => {
      const last = view.getSnapshot().items.at(-1)
      if (last?.kind === 'notice') notices.push(last.text)
    })
    const code = await runRepl({
      agent: first,
      view,
      nextLine: scriptedInput(['/session', '/session session-b', '/session missing', '/exit']),
      sessions: { flush: vi.fn(async (_session: Session) => true) },
      listSessions: async () => [
        { id: 'session-a', cwd: '/work', createdAt: 1 },
        { id: 'session-b', createdAt: 2 },
      ],
      switchSession: async (target) => {
        switchCalls.push(target)
        return target === 'session-b' ? second : null
      },
    })
    expect(code).toBe(0)
    expect(switchCalls).toEqual(['session-b', 'missing'])
    expect(notices.some(text => text.includes('session-a (/work)'))).toBe(true)
    expect(notices.some(text => text.includes('switched to session-b'))).toBe(true)
    expect(notices.some(text => text.includes('no such session: missing'))).toBe(true)
  })
})
