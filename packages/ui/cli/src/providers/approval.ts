/**
 * The terminal-side approval answerer: renders each ask as a view notice and
 * grants the action once so the interactive session stays usable. The grant is
 * visible in the transcript; the sandbox and permission presets still bound
 * what the tool may touch.
 * @module @deepseek-ai/dsh-cli-ui/providers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'

/** The view surface the answerer needs; structural so the renderer stays free of the driver. */
interface NoticeView {
  notice(text: string): void
}

/**
 * Install the approval answerer for the given view store.
 * @param ctx - Cordis context carrying the approval service.
 * @param view - the REPL view store that surfaces the ask.
 * @returns a disposer removing the listener.
 */
export function installCliApproval(ctx: Context, view: NoticeView): () => void {
  return ctx.on('approval/request', (request: ApprovalRequest) => {
    view.notice(
      `[approval] ${request.toolName}${request.reason !== undefined ? `: ${request.reason}` : ''} — granted once`,
    )
    return Promise.resolve('allowed-once' satisfies ApprovalOutcome)
  })
}
