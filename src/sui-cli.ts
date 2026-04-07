import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import { z } from 'zod/v4'
import {
  gasCoinArraySchema,
  suiEnvObjectSchema,
  suiEnvTupleSchema,
  txResponseSchema,
} from './schemas/sui-cli.ts'
import type { TxResponse } from './types.ts'

export interface SuiSetupInfo {
  path: string
  version: string
  activeAddress: string
  totalMist: bigint
  totalSui: string
}

interface SuiEnvConfig {
  alias: string
  rpc: string
}

interface SuiEnvsJson {
  envs: SuiEnvConfig[]
  activeEnv?: string
}

export async function validateSuiSetup(): Promise<SuiSetupInfo> {
  const suiPath = await io.which('sui', true)

  const versionRaw = await runSuiCapture(suiPath, ['--version'])
  const version = parseSuiVersion(versionRaw)
  core.info(`Sui CLI version: ${version}`)

  const activeAddress = (
    await runSuiCapture(suiPath, ['client', 'active-address'])
  ).trim()
  core.info(`Active address: ${activeAddress}`)

  const gasRaw = await runSuiCapture(suiPath, ['client', 'gas', '--json'])
  const gas = parseGasCoins(gasRaw)
  const totalMist = gas.reduce(
    (acc, coin) => acc + BigInt(coin.mistBalance),
    0n
  )
  const totalSui = formatMistToSui(totalMist)
  core.info(
    `Active address total balance: ${totalSui} SUI (${totalMist.toString()} MIST)`
  )

  return { path: suiPath, version, activeAddress, totalMist, totalSui }
}

export async function ensureEnvAndSwitch(
  suiPath: string,
  env: string,
  rpcUrl?: string
): Promise<void> {
  const envsInfo = await listClientEnvs(suiPath)
  const existing = envsInfo.envs.find((item) => item.alias === env)

  if (!rpcUrl) {
    if (!existing) {
      throw new Error(
        `Sui environment "${env}" does not exist in local config. ` +
          'Please configure it in setup-sui-cli or provide rpc-url.'
      )
    }
    await runSui(suiPath, ['client', 'switch', '--env', env])
    core.info(`Using existing Sui env: ${env}`)
    return
  }

  if (!existing) {
    core.info(`Adding missing env "${env}" with rpc ${rpcUrl}`)
    await runSui(suiPath, [
      'client',
      'new-env',
      '--alias',
      env,
      '--rpc',
      rpcUrl,
    ])
    await runSui(suiPath, ['client', 'switch', '--env', env])
    return
  }

  if (normalizeUrl(existing.rpc) === normalizeUrl(rpcUrl)) {
    core.info(`Using existing Sui env "${env}" (rpc already matches input)`)
    await runSui(suiPath, ['client', 'switch', '--env', env])
    return
  }

  core.info(
    `Trying to recreate env "${env}" with the provided rpc-url to override config.`
  )
  const sameAliasResult = await runSuiAllowFail(suiPath, [
    'client',
    'new-env',
    '--alias',
    env,
    '--rpc',
    rpcUrl,
  ])

  if (sameAliasResult.exitCode === 0) {
    await runSui(suiPath, ['client', 'switch', '--env', env])
    core.info(`Recreated and switched to env alias: ${env}`)
    return
  }

  core.warning(
    `Could not recreate env alias "${env}" directly. Falling back to a run-scoped override alias. ` +
      `${sameAliasResult.stderr || sameAliasResult.stdout}`
  )

  const overrideAlias = `gha-${env}`
  const overrideExisting = envsInfo.envs.find(
    (item) => item.alias === overrideAlias
  )

  if (
    overrideExisting &&
    normalizeUrl(overrideExisting.rpc) !== normalizeUrl(rpcUrl)
  ) {
    throw new Error(
      `Cannot override env "${env}" in-place and existing override alias "${overrideAlias}" points to a different rpc. ` +
        'Please clean up that alias in setup-sui-cli configuration, or use a different env name.'
    )
  }

  if (!overrideExisting) {
    core.info(
      `Env "${env}" exists with a different rpc. Creating override alias "${overrideAlias}" for this run.`
    )
    await runSui(suiPath, [
      'client',
      'new-env',
      '--alias',
      overrideAlias,
      '--rpc',
      rpcUrl,
    ])
  }

  await runSui(suiPath, ['client', 'switch', '--env', overrideAlias])
  core.info(`Switched to override env alias: ${overrideAlias}`)
}

export interface PublishOptions {
  cwd: string
  gasLimit?: number
}

export interface UpgradeOptions extends PublishOptions {
  upgradeCapId: string
}

export async function suiPublish(
  suiPath: string,
  opts: PublishOptions
): Promise<TxResponse> {
  const args = ['client', 'publish', '--json', '--skip-dependency-verification']
  if (opts.gasLimit) args.push('--gas-budget', String(opts.gasLimit))
  return runSuiJson(suiPath, args, opts.cwd)
}

export async function suiUpgrade(
  suiPath: string,
  opts: UpgradeOptions
): Promise<TxResponse> {
  const args = [
    'client',
    'upgrade',
    '--upgrade-capability',
    opts.upgradeCapId,
    '--json',
    '--skip-dependency-verification',
  ]
  if (opts.gasLimit) args.push('--gas-budget', String(opts.gasLimit))
  return runSuiJson(suiPath, args, opts.cwd)
}

async function listClientEnvs(suiPath: string): Promise<SuiEnvsJson> {
  const raw = await runSuiCapture(suiPath, ['client', 'envs', '--json'])
  const parsed = parseJsonWithSchema(raw, 'sui client envs --json', z.unknown())

  // Current Sui format is tuple: [envs[], activeAlias]
  if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
    const tupleResult = suiEnvTupleSchema.safeParse(parsed)
    if (!tupleResult.success) {
      throw new Error(
        `Invalid "sui client envs --json" tuple format: ${z.prettifyError(tupleResult.error)}`
      )
    }
    const [envs, activeEnv] = tupleResult.data
    return { envs, activeEnv }
  }

  // Future-proof fallback: object format
  if (parsed && typeof parsed === 'object') {
    const objResult = suiEnvObjectSchema.safeParse(parsed)
    if (!objResult.success) {
      throw new Error(
        `Invalid "sui client envs --json" object format: ${z.prettifyError(objResult.error)}`
      )
    }
    const envs = objResult.data.envs ?? []
    const activeEnv = objResult.data.activeEnv
    return { envs, activeEnv }
  }

  throw new Error(`Unexpected format from "sui client envs --json"`)
}

function parseSuiVersion(raw: string): string {
  const m = raw.match(/sui\s+(\d+\.\d+\.\d+)/i)
  if (!m) throw new Error(`Could not parse Sui version from: ${raw.trim()}`)
  return m[1]
}

interface GasCoin {
  mistBalance: number | string
}

function parseGasCoins(raw: string): GasCoin[] {
  return parseJsonWithSchema(raw, 'sui client gas --json', gasCoinArraySchema)
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function formatMistToSui(totalMist: bigint): string {
  const base = 1_000_000_000n
  const whole = totalMist / base
  const fraction = (totalMist % base)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString()
}

async function runSui(suiPath: string, args: string[]): Promise<void> {
  await exec.exec(suiPath, args)
}

async function runSuiAllowFail(
  suiPath: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const exitCode = await exec.exec(suiPath, args, {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString()
      },
      stderr: (data) => {
        stderr += data.toString()
      },
    },
  })

  return { exitCode, stdout, stderr }
}

async function runSuiCapture(suiPath: string, args: string[]): Promise<string> {
  let stdout = ''
  let stderr = ''
  const exitCode = await exec.exec(suiPath, args, {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString()
      },
      stderr: (data) => {
        stderr += data.toString()
      },
    },
  })

  if (exitCode !== 0) {
    throw new Error(
      `Command failed: sui ${args.join(' ')}\n${stderr || stdout}`
    )
  }

  return stdout
}

async function runSuiJson(
  suiPath: string,
  args: string[],
  cwd: string
): Promise<TxResponse> {
  let stdout = ''
  let stderr = ''

  const exitCode = await exec.exec(suiPath, args, {
    cwd,
    ignoreReturnCode: true,
    listeners: {
      stdout: (d) => {
        stdout += d.toString()
      },
      stderr: (d) => {
        stderr += d.toString()
      },
    },
  })

  if (stderr.trim()) core.info(stderr.trim())

  if (exitCode !== 0) {
    throw new Error(`sui exited with code ${exitCode}.\n${stderr || stdout}`)
  }

  const jsonStart = stdout.indexOf('{')
  if (jsonStart === -1) {
    throw new Error(`No JSON output from sui command.\nstdout: ${stdout}`)
  }

  let tx: TxResponse
  try {
    tx = parseJsonWithSchema(
      stdout.slice(jsonStart),
      'sui transaction json',
      txResponseSchema
    ) as TxResponse
  } catch (e) {
    throw new Error(`Failed to parse sui JSON output: ${e}`)
  }

  if (tx.effects?.status?.status !== 'success') {
    const errMsg = tx.effects?.status?.error ?? 'unknown error'
    throw new Error(`Transaction failed: ${errMsg}`)
  }

  return tx
}

function parseJsonWithSchema<T extends z.ZodTypeAny>(
  raw: string,
  label: string,
  schema: T
): z.infer<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${String(error)}`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid ${label}: ${z.prettifyError(result.error)}`)
  }
  return result.data
}
