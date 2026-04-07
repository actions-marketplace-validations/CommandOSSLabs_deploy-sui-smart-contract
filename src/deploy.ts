/**
 * Core deploy orchestration.
 *
 * Deploy modes:
 *   auto             – Upgrade if an upgrade-capability exists in Published.toml
 *                      for the target env; otherwise publish new.
 *   force-publish    – Always run `sui client publish` (new package ID each time).
 *   safe-upgrade-only – Only upgrade; fail loudly if no upgrade-capability is found.
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
  CreatedObjectChange,
  DeployResult,
  Inputs,
  MutatedObjectChange,
  PublishedObjectChange,
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
    inputs.deployMode === 'safe-upgrade-only' ||
    (inputs.deployMode === 'auto' && !!existingEntry?.upgradeCapability)

  if (
    inputs.deployMode === 'safe-upgrade-only' &&
    !existingEntry?.upgradeCapability
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
    tx = await suiUpgrade(sui.path, {
      cwd: inputs.dir,
      upgradeCapId: existingEntry.upgradeCapability,
    })
    publishedType = 'upgraded'
    previousPackageId = existingEntry.publishedAt
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

    core.info('Publishing new package...')
    tx = await suiPublish(sui.path, { cwd: inputs.dir })
    publishedType = 'new'
    previousPackageId = existingEntry?.publishedAt ?? ''
  }

  // 5. Parse transaction output
  const result = parseTxResult(tx)

  return { ...result, publishedType, previousPackageId }
}

// ─── Transaction parsing ───────────────────────────────────────────────────

function parseTxResult(
  tx: TxResponse
): Omit<DeployResult, 'previousPackageId' | 'publishedType'> {
  const published = tx.objectChanges.find(
    (c): c is PublishedObjectChange => c.type === 'published'
  )
  if (!published) {
    throw new Error('No published object change found in transaction response.')
  }

  // UpgradeCap is "created" on first publish, "mutated" on upgrade
  const upgradeCap = tx.objectChanges.find(
    (c): c is CreatedObjectChange | MutatedObjectChange =>
      (c.type === 'created' || c.type === 'mutated') &&
      typeof (c as CreatedObjectChange).objectType === 'string' &&
      (c as CreatedObjectChange).objectType.includes('UpgradeCap')
  ) as (CreatedObjectChange | MutatedObjectChange) | undefined

  if (!upgradeCap) {
    // Non-fatal for force-publish of packages without UpgradeCap (unusual but allowed)
    core.warning('No UpgradeCap object found in transaction response.')
  }

  core.info(`Transaction digest : ${tx.digest}`)
  core.info(`Package ID         : ${published.packageId}`)
  if (upgradeCap) core.info(`UpgradeCap ID      : ${upgradeCap.objectId}`)

  return {
    digest: tx.digest,
    packageId: published.packageId,
    upgradeCap: upgradeCap?.objectId ?? '',
  }
}
