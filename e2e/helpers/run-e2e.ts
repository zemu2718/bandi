import path from 'node:path'
import { e2eRoot, repoRoot } from './paths.js'
import { run } from './process.js'
import { resetSandbox, sandboxEnv } from './sandbox.js'

await run('pnpm', ['--filter', '@bandi/desktop-e2e', 'build:app'], { cwd: repoRoot })

const baseEnv: Record<string, string> = {
  ...sandboxEnv(),
  // WebdriverIO 9 的 Undici dispatcher 与 Node 26 不兼容；原生 fetch 在受支持版本上行为一致。
  WDIO_USE_NATIVE_FETCH: '1',
}
const wdio = path.join(e2eRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'wdio.cmd' : 'wdio')
const runSpec = (spec: string, env = baseEnv) => run(
  wdio,
  ['run', 'wdio.conf.ts', '--spec', spec],
  { cwd: e2eRoot, env },
)

await resetSandbox()
await runSpec('specs/first-use-journey.spec.ts')
await runSpec('specs/first-use-journey.spec.ts', { ...baseEnv, BANDI_E2E_VERIFY_ONLY: '1' })

await resetSandbox()
for (const phase of ['configure', 'reset', 'fresh']) {
  await runSpec('specs/settings-lifecycle.spec.ts', { ...baseEnv, BANDI_E2E_SETTINGS_PHASE: phase })
}

await resetSandbox()
await runSpec('specs/fresh-restart.spec.ts')
