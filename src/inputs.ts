import * as path from 'node:path'
import * as core from '@actions/core'
import { z } from 'zod/v4'
import { actionInputsSchema } from './schemas/inputs.ts'
import type { Inputs } from './types.ts'

export function parseInputs(): Inputs {
  const raw = {
    dir: core.getInput('dir') || '.',
    env: core.getInput('env') || 'testnet',
    rpcUrl: core.getInput('rpc-url') || undefined,
    deployMode: (core.getInput('deploy-mode') ||
      'auto') as Inputs['deployMode'],
  }

  const result = actionInputsSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid inputs: ${z.prettifyError(result.error)}`)
  }

  return {
    ...result.data,
    // Resolve dir relative to the workspace/repo root (GITHUB_WORKSPACE)
    dir: path.resolve(
      process.env.GITHUB_WORKSPACE ?? process.cwd(),
      result.data.dir
    ),
  }
}
