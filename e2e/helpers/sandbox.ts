import fs from 'node:fs/promises'
import { externalSentinelDirectory } from './first-use-fixtures.js'
import { sandboxHome, sandboxLocalData, sandboxRoamingData } from './paths.js'

export async function resetSandbox() {
  await fs.rm(sandboxHome, { force: true, recursive: true })
  await fs.mkdir(sandboxHome, { recursive: true })
  await fs.mkdir(sandboxRoamingData, { recursive: true })
  await fs.mkdir(sandboxLocalData, { recursive: true })
  await fs.mkdir(externalSentinelDirectory, { recursive: true })
}

export function sandboxEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: sandboxHome,
    USERPROFILE: sandboxHome,
    APPDATA: sandboxRoamingData,
    LOCALAPPDATA: sandboxLocalData,
    XDG_CONFIG_HOME: `${sandboxHome}/.config`,
    XDG_DATA_HOME: `${sandboxHome}/.local/share`,
    XDG_CACHE_HOME: `${sandboxHome}/.cache`,
  }
}
