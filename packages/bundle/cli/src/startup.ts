/**
 * The interactive CLI app's command-line provider: it parses the invocation's
 * flags and `--help`, then publishes {@link CLI_STARTUP_SERVICE}. The runner is
 * an ordinary consumer whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-cli/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'cli-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the interactive runner. */
export const CLI_STARTUP_SERVICE = 'cliStartup'

/** A permission preset the CLI exposes; maps onto sandbox + approval policy. */
export type CliPermission = 'read-only' | 'workspace-write' | 'danger-full-access'

/** How to choose the session this invocation drives. */
export type CliResumeChoice = 'latest' | 'fresh' | {
  /** The exact persisted session id to resume. */
  sessionId: string
}

/** What the runner row reads from {@link CLI_STARTUP_SERVICE}. */
export interface CliStartupValues {
  /** Override the default model for this session (exact model id). */
  readonly model?: string
  /** Override the provider for this session (exact provider id). */
  readonly provider?: string
  /** Working directory the session runs in; defaults to the process cwd. */
  readonly cwd: string
  /** Which session to drive: latest for this cwd, a fresh one, or a named id. */
  readonly resume: CliResumeChoice
  /** Permission preset; the interactive default asks per action. */
  readonly permission: CliPermission
  /** Agent preset to compose the session's agent from, when the deployment has a preset roster. */
  readonly mode?: string
  /** Whether to drive the terminal UI; `--no-interactive` prints plain lines. */
  readonly interactive: boolean
  /** Extra diagnostics on stderr. */
  readonly verbose: boolean
}

/**
 * This app's command: its flags and help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function cliCommand(): Command {
  return new Command()
    .name('dsh cli')
    .description('Start an interactive terminal session with a dsh agent.')
    .helpOption('-h, --help', 'show this help')
    .option('--model <model>', 'override the model for this session (e.g. deepseek-v4-flash)')
    .option('--provider <provider>', 'override the provider for this session')
    .option('--cwd <path>', 'working directory for the session', process.cwd())
    .option('--resume [choice]', 'session to drive: latest (a bare --resume), fresh, or a session id; default is a brand-new session')
    .option('--permission <preset>', 'permission preset: read-only, workspace-write (default), or danger-full-access', 'workspace-write')
    .option('-m, --mode <preset>', 'agent preset to compose the session from (e.g. standard, code, memory-os); default depends on the deployment roster')
    .option('--no-interactive', 'do not start the terminal UI; print plain output (CI)')
    .option('--verbose', 'extra diagnostics on stderr')
    .addHelpText('after', `
Examples:
  dsh cli                           start a brand-new interactive session
  dsh cli --resume                  resume the latest session for this directory
  dsh cli --resume session-xyz      resume a specific session by id
  dsh cli --permission read-only    read-only session
  dsh cli --mode code               compose the session from the code agent preset
  dsh cli --no-interactive "hi"     plain output mode (CI)
`)
}

/**
 * Parse and provide the CLI invocation as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = cliCommand()
  program.action(() => {
    const opts = program.opts<{
      model?: string
      provider?: string
      cwd: string
      resume?: string | boolean
      permission: string
      mode?: string
      interactive: boolean
      verbose: boolean
    }>()
    // A bare `--resume` (commander delivers boolean `true`) resumes the latest
    // session for this cwd; `--resume fresh` starts a new one; a string value
    // is a specific session id. Absent the flag, the default is a brand-new
    // session. Commander never delivers `false` for an optional-value option.
    const resume: CliResumeChoice = opts.resume === true
      ? 'latest'
      : opts.resume === undefined || opts.resume === 'fresh'
        ? 'fresh'
        : typeof opts.resume === 'string' && opts.resume === 'latest'
          ? 'latest'
          : { sessionId: typeof opts.resume === 'string' ? opts.resume : 'latest' }
    if (opts.cwd === '') {
      program.error('error: --cwd needs a path')
    }
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(opts.permission)) {
      program.error(`error: --permission must be read-only, workspace-write, or danger-full-access, got ${JSON.stringify(opts.permission)}`)
    }
    ctx.provide(CLI_STARTUP_SERVICE, {
      // Omit absent overrides so optional fields stay absent under
      // exactOptionalPropertyTypes.
      ...(opts.model === undefined ? {} : { model: opts.model }),
      ...(opts.provider === undefined ? {} : { provider: opts.provider }),
      ...(opts.mode === undefined ? {} : { mode: opts.mode }),
      cwd: opts.cwd,
      resume,
      permission: opts.permission as CliPermission,
      interactive: opts.interactive,
      verbose: opts.verbose,
    } satisfies CliStartupValues)
  })
  parseCmdline(ctx, program)
}
