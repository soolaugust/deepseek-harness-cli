/** The assembled cli profile: boot the real Loader tree and exit cleanly on a closed stdin. */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
// The cli profile needs no overlay; binArgs fully supplies the argv, and this
// real patch file satisfies the loader-smoke configPath contract.
const configPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

describe('cli profile smoke', () => {
  it('boots the interactive profile and exits cleanly on a closed stdin', async () => {
    const result = await runLoaderSmoke({
      label: 'cli profile boot smoke',
      tempDirPrefix: 'cli-profile-smoke-',
      binScript: dshBinScript,
      configPath,
      binArgs: ['cli', '--no-interactive'],
      tsconfigPath,
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('prints the cli app help and exits', async () => {
    const result = await runLoaderSmoke({
      label: 'cli profile help smoke',
      tempDirPrefix: 'cli-profile-help-',
      binScript: dshBinScript,
      configPath,
      binArgs: ['cli', '--help'],
      tsconfigPath,
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })
    expect(result.stdout).toContain('dsh cli')
    expect(result.stdout).toContain('--resume')
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
