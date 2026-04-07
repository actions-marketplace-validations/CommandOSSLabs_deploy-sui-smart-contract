import * as core from '@actions/core'
import { deploy } from './deploy.ts'
import { parseInputs } from './inputs.ts'

async function run(): Promise<void> {
  const inputs = parseInputs()

  core.info(`Deploying Sui package in: ${inputs.dir}`)
  core.info(`Environment : ${inputs.env}`)
  core.info(`Deploy mode : ${inputs.deployMode}`)

  const result = await deploy(inputs)

  core.setOutput('digest', result.digest)
  core.setOutput('upgrade-cap', result.upgradeCap)
  core.setOutput('published-package-id', result.packageId)
  core.setOutput('published-type', result.publishedType)
  core.setOutput('previous-package-id', result.previousPackageId)

  core.info(`\nDone. published-type=${result.publishedType}`)
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err))
})
