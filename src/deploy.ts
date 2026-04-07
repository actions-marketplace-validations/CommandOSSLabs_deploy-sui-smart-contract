/**
 * Core deploy orchestration.
 *
 * Deploy modes:
 *   auto             – Upgrade if an upgrade-capability exists in Published.toml
 *                      for the target env; otherwise publish new.
 *   force-publish    – Always run `sui client publish` (new package ID each time).
 *   safe-upgrade-only – Inherits auto's first deploy behavior (publish when
 *                      no env entry exists), then upgrade-only afterward.
 */

import * as core from '@actions/core'
import { readPublishedToml, removePublishedEntry } from './published-toml.ts'
import {
  ensureEnvAndSwitch,
  suiPublish,
  suiUpgrade,
  validateSuiSetup,
} from './sui-cli.ts'
import type {
  DeployResult,
  Inputs,
  PublishedEntry,
  TxResponse,
} from './types.ts'

// ─── Entry point ───────────────────────────────────────────────────────────

export async function deploy(inputs: Inputs): Promise<DeployResult> {
  // 1. Validate the pre-installed Sui CLI setup (provided by setup-sui-cli action)
  const sui = await validateSuiSetup()

  // 2. Ensure env exists (and add/override only when needed), then switch
  await ensureEnvAndSwitch(sui.path, inputs.env, inputs.rpcUrl)

  // 3. Load Published.toml (may be absent for a brand-new package)
  const parsedToml = await readPublishedToml(inputs.dir)
  const existingEntry = parsedToml?.entries.get(inputs.env)

  core.debug(`deploy-mode: ${inputs.deployMode}`)
  core.debug(
    `existing entry for env "${inputs.env}": ${JSON.stringify(existingEntry)}`
  )

  // 4. Decide publish vs upgrade
  let tx: TxResponse
  let publishedType: 'new' | 'upgraded'
  let previousPackageId = ''

  const shouldUpgrade =
    (inputs.deployMode === 'safe-upgrade-only' && !!existingEntry) ||
    (inputs.deployMode === 'auto' && !!existingEntry?.upgradeCapability)

  if (
    inputs.deployMode === 'safe-upgrade-only' &&
    existingEntry &&
    !existingEntry.upgradeCapability
  ) {
    throw new Error(
      `deploy-mode is "safe-upgrade-only" but no upgrade-capability was found ` +
        `in Published.toml for environment "${inputs.env}".`
    )
  }

  if (shouldUpgrade && existingEntry) {
    core.info(
      `Upgrading package (upgrade-capability: ${existingEntry.upgradeCapability})`
    )

    try {
      tx = await suiUpgrade(sui.path, {
        cwd: inputs.dir,
        upgradeCapId: existingEntry.upgradeCapability,
        verifyDeps: inputs.verifyDeps,
      })
      publishedType = 'upgraded'
      previousPackageId = existingEntry.publishedAt
    } catch (error) {
      // In auto mode, compatibility failures should gracefully fallback to publish.
      if (inputs.deployMode === 'auto' && isUpgradeCompatibilityError(error)) {
        core.warning(
          'Upgrade failed due to compatibility constraints. Falling back to publish new package.'
        )

        const removed = await removePublishedEntry(inputs.dir, inputs.env)
        if (removed) {
          core.info(
            `Removed [published.${inputs.env}] section from Published.toml before fallback publish.`
          )
        }

        tx = await suiPublish(sui.path, {
          cwd: inputs.dir,
          verifyDeps: inputs.verifyDeps,
        })
        publishedType = 'new'
        previousPackageId = existingEntry.publishedAt
      } else {
        throw error
      }
    }
  } else {
    if (inputs.deployMode === 'force-publish') {
      const removed = await removePublishedEntry(inputs.dir, inputs.env)
      if (removed) {
        core.info(
          `Removed [published.${inputs.env}] section from Published.toml before force-publish.`
        )
      } else {
        core.info(
          `No [published.${inputs.env}] section found to remove before force-publish.`
        )
      }
    }

    if (inputs.deployMode === 'safe-upgrade-only' && !existingEntry) {
      core.info(
        `No existing published entry for env "${inputs.env}". Publishing initial package in safe-upgrade-only mode.`
      )
    }

    core.info('Publishing new package...')
    tx = await suiPublish(sui.path, {
      cwd: inputs.dir,
      verifyDeps: inputs.verifyDeps,
    })
    publishedType = 'new'
    previousPackageId = existingEntry?.publishedAt ?? ''
  }

  const { packageId, upgradeCap } = await resolvePublishedValues(
    inputs.dir,
    inputs.env,
    existingEntry
  )

  return {
    digest: tx.digest,
    packageId,
    upgradeCap,
    publishedType,
    previousPackageId,
  }
}

function isUpgradeCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  // Match common Sui compatibility signals while avoiding broad catch-all behavior.
  return (
    normalized.includes('incompatible') ||
    normalized.includes('compatibility') ||
    normalized.includes('linkage') ||
    normalized.includes('cannot upgrade') ||
    normalized.includes('upgrade is not compatible')
  )
}

// ─── Transaction parsing ───────────────────────────────────────────────────

async function resolvePublishedValues(
  dir: string,
  env: string,
  existingEntry: PublishedEntry | undefined
): Promise<Pick<DeployResult, 'packageId' | 'upgradeCap'>> {
  const sourceEntry =
    existingEntry ?? (await readPublishedToml(dir))?.entries.get(env)

  if (!sourceEntry) {
    core.warning(
      `Could not resolve original-id or upgrade-capability from Published.toml for environment "${env}".`
    )
    return { packageId: '', upgradeCap: '' }
  }

  if (!sourceEntry.originalId) {
    core.warning(
      `Could not resolve original-id from Published.toml for environment "${env}".`
    )
  }

  if (!sourceEntry.upgradeCapability) {
    core.warning(
      `Could not resolve upgrade-capability from Published.toml for environment "${env}".`
    )
  }

  return {
    packageId: sourceEntry.originalId ?? '',
    upgradeCap: sourceEntry.upgradeCapability ?? '',
  }
}
