import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Inputs, PublishedEntry, TxResponse } from '../src/types.ts'

// ─── Mock functions ────────────────────────────────────────────────────────

const mockValidateSuiSetup = mock(async () => ({
  path: '/usr/bin/sui',
  version: '1.0.0',
  activeAddress: '0xtest_address',
  totalMist: 1_000_000_000n,
  totalSui: '1.00',
}))

const mockEnsureEnvAndSwitch = mock(async () => {})
const mockSuiPublish = mock(async () => makePublishTx('0xnew_package'))
const mockSuiUpgrade = mock(async () => makeUpgradeTx('0xupgraded_package'))
const mockReadPublishedToml = mock(
  async (_dir: string) => null as ReturnType<typeof makeTomlResult> | null
)
const mockRemovePublishedEntry = mock(
  async (_dir: string, _env: string) => false
)

// ─── Module mocks ──────────────────────────────────────────────────────────

mock.module('@actions/core', () => ({
  info: () => {},
  warning: () => {},
  debug: () => {},
  error: () => {},
  setOutput: () => {},
  setFailed: () => {},
  getInput: () => '',
}))

mock.module('../src/sui-cli.ts', () => ({
  validateSuiSetup: mockValidateSuiSetup,
  ensureEnvAndSwitch: mockEnsureEnvAndSwitch,
  suiPublish: mockSuiPublish,
  suiUpgrade: mockSuiUpgrade,
}))

mock.module('../src/published-toml.ts', () => ({
  readPublishedToml: mockReadPublishedToml,
  removePublishedEntry: mockRemovePublishedEntry,
}))

// ─── Module under test (imported after mocks are registered) ──────────────

const { deploy } = await import('../src/deploy.ts')

// ─── Helpers ──────────────────────────────────────────────────────────────

function makePublishTx(
  packageId: string,
  upgradeCapId = '0xcap_object'
): TxResponse {
  return {
    digest: '0xpublish_digest',
    effects: { status: { status: 'success' } },
    objectChanges: [
      {
        type: 'published',
        packageId,
        version: '1',
        digest: '0xpkg_digest',
        modules: ['greeting'],
      },
      {
        type: 'created',
        objectType: '0x2::package::UpgradeCap',
        objectId: upgradeCapId,
        version: '1',
        digest: '0xcap_digest',
        owner: '0xowner',
      },
    ],
  }
}

function makeUpgradeTx(
  packageId: string,
  upgradeCapId = '0xcap_object'
): TxResponse {
  return {
    digest: '0xupgrade_digest',
    effects: { status: { status: 'success' } },
    objectChanges: [
      {
        type: 'published',
        packageId,
        version: '2',
        digest: '0xpkg_digest',
        modules: ['greeting'],
      },
      {
        type: 'mutated',
        objectType: '0x2::package::UpgradeCap',
        objectId: upgradeCapId,
        version: '2',
        digest: '0xcap_digest',
        owner: '0xowner',
      },
    ],
  }
}

function makeEntry(overrides: Partial<PublishedEntry> = {}): PublishedEntry {
  return {
    chainId: '4c78adac',
    publishedAt: '0xold_package',
    originalId: '0xoriginal',
    version: 1,
    toolchainVersion: '1.69.1',
    buildConfig: '{ flavor = "sui", edition = "2024" }',
    upgradeCapability: '0xcap_object',
    ...overrides,
  }
}

function makeTomlResult(env: string, entry: PublishedEntry) {
  return {
    raw: { published: { [env]: {} } },
    entries: new Map([[env, entry]]),
  }
}

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    dir: '/workspace/example-contract',
    env: 'testnet',
    verifyDeps: false,
    deployMode: 'auto',
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockValidateSuiSetup.mockClear()
  mockEnsureEnvAndSwitch.mockClear()
  mockSuiPublish.mockClear()
  mockSuiUpgrade.mockClear()
  mockReadPublishedToml.mockClear()
  mockRemovePublishedEntry.mockClear()

  mockValidateSuiSetup.mockImplementation(async () => ({
    path: '/usr/bin/sui',
    version: '1.0.0',
    activeAddress: '0xtest_address',
    totalMist: 1_000_000_000n,
    totalSui: '1.00',
  }))
  mockEnsureEnvAndSwitch.mockImplementation(async () => {})
  mockSuiPublish.mockImplementation(async () => makePublishTx('0xnew_package'))
  mockSuiUpgrade.mockImplementation(async () =>
    makeUpgradeTx('0xupgraded_package')
  )
  mockReadPublishedToml.mockImplementation(async () => null)
  mockRemovePublishedEntry.mockImplementation(async () => false)
})

// ─── auto mode ────────────────────────────────────────────────────────────

describe('auto mode', () => {
  test('publishes new when no Published.toml exists', async () => {
    let reads = 0
    mockReadPublishedToml.mockImplementation(async () => {
      reads += 1
      if (reads === 1) return null
      return makeTomlResult(
        'testnet',
        makeEntry({ originalId: '0xnew_original' })
      )
    })

    const result = await deploy(makeInputs({ deployMode: 'auto' }))

    expect(mockSuiPublish).toHaveBeenCalledWith('/usr/bin/sui', {
      cwd: '/workspace/example-contract',
      verifyDeps: false,
    })
    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('new')
    expect(result.packageId).toBe('0xnew_original')
    expect(result.upgradeCap).toBe('0xcap_object')
    expect(result.previousPackageId).toBe('')
  })

  test('publishes new when env entry is missing in Published.toml', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult('mainnet', makeEntry())
    )

    const result = await deploy(
      makeInputs({ deployMode: 'auto', env: 'testnet' })
    )

    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('new')
    expect(result.upgradeCap).toBe('')
  })

  test('publishes new when entry exists but has no upgrade-capability', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult('testnet', makeEntry({ upgradeCapability: '' }))
    )

    const result = await deploy(makeInputs({ deployMode: 'auto' }))

    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('new')
  })

  test('upgrades when entry with upgrade-capability exists', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult(
        'testnet',
        makeEntry({ upgradeCapability: '0xcap_object' })
      )
    )

    const result = await deploy(makeInputs({ deployMode: 'auto' }))

    expect(mockSuiUpgrade).toHaveBeenCalledWith('/usr/bin/sui', {
      cwd: '/workspace/example-contract',
      upgradeCapId: '0xcap_object',
      verifyDeps: false,
    })
    expect(mockSuiUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSuiPublish).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('upgraded')
    expect(result.packageId).toBe('0xoriginal')
    expect(result.upgradeCap).toBe('0xcap_object')
    expect(result.previousPackageId).toBe('0xold_package')
  })

  test('forwards verify-deps=true for publish and upgrade', async () => {
    mockReadPublishedToml.mockImplementation(async () => null)
    await deploy(makeInputs({ deployMode: 'auto', verifyDeps: true }))

    expect(mockSuiPublish).toHaveBeenCalledWith('/usr/bin/sui', {
      cwd: '/workspace/example-contract',
      verifyDeps: true,
    })

    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult(
        'testnet',
        makeEntry({ upgradeCapability: '0xcap_object' })
      )
    )
    await deploy(makeInputs({ deployMode: 'auto', verifyDeps: true }))

    expect(mockSuiUpgrade).toHaveBeenCalledWith('/usr/bin/sui', {
      cwd: '/workspace/example-contract',
      upgradeCapId: '0xcap_object',
      verifyDeps: true,
    })
  })

  test('falls back to publish when upgrade fails with compatibility error', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult(
        'testnet',
        makeEntry({ upgradeCapability: '0xcap_object' })
      )
    )
    mockSuiUpgrade.mockImplementation(async () => {
      throw new Error(
        'Package upgrade is incompatible with the existing version'
      )
    })
    mockRemovePublishedEntry.mockImplementation(async () => true)

    const result = await deploy(makeInputs({ deployMode: 'auto' }))

    expect(mockSuiUpgrade).toHaveBeenCalledTimes(1)
    expect(mockRemovePublishedEntry).toHaveBeenCalledTimes(1)
    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(result.publishedType).toBe('new')
    expect(result.previousPackageId).toBe('0xold_package')
  })

  test('rethrows non-compatibility upgrade errors', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult(
        'testnet',
        makeEntry({ upgradeCapability: '0xcap_object' })
      )
    )
    mockSuiUpgrade.mockImplementation(async () => {
      throw new Error('insufficient gas')
    })

    await expect(deploy(makeInputs({ deployMode: 'auto' }))).rejects.toThrow(
      'insufficient gas'
    )
    expect(mockSuiPublish).not.toHaveBeenCalled()
  })
})

// ─── force-publish mode ───────────────────────────────────────────────────

describe('force-publish mode', () => {
  test('always publishes new when no entry exists', async () => {
    mockReadPublishedToml.mockImplementation(async () => null)
    mockRemovePublishedEntry.mockImplementation(async () => false)

    const result = await deploy(makeInputs({ deployMode: 'force-publish' }))

    expect(mockRemovePublishedEntry).toHaveBeenCalledTimes(1)
    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('new')
  })

  test('removes existing entry and publishes new', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult(
        'testnet',
        makeEntry({ upgradeCapability: '0xcap_object' })
      )
    )
    mockRemovePublishedEntry.mockImplementation(async () => true)

    const result = await deploy(makeInputs({ deployMode: 'force-publish' }))

    expect(mockRemovePublishedEntry).toHaveBeenCalledTimes(1)
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(result.publishedType).toBe('new')
    expect(result.previousPackageId).toBe('0xold_package')
  })
})

// ─── safe-upgrade-only mode ───────────────────────────────────────────────

describe('safe-upgrade-only mode', () => {
  test('publishes new on first deploy (no existing entry)', async () => {
    mockReadPublishedToml.mockImplementation(async () => null)

    const result = await deploy(makeInputs({ deployMode: 'safe-upgrade-only' }))

    expect(mockSuiPublish).toHaveBeenCalledTimes(1)
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('new')
    expect(result.previousPackageId).toBe('')
  })

  test('upgrades when entry with upgrade-capability exists', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult(
        'testnet',
        makeEntry({ upgradeCapability: '0xcap_object' })
      )
    )

    const result = await deploy(makeInputs({ deployMode: 'safe-upgrade-only' }))

    expect(mockSuiUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSuiPublish).not.toHaveBeenCalled()
    expect(result.publishedType).toBe('upgraded')
    expect(result.packageId).toBe('0xoriginal')
    expect(result.upgradeCap).toBe('0xcap_object')
  })

  test('throws when entry exists but has no upgrade-capability', async () => {
    mockReadPublishedToml.mockImplementation(async () =>
      makeTomlResult('testnet', makeEntry({ upgradeCapability: '' }))
    )

    await expect(
      deploy(makeInputs({ deployMode: 'safe-upgrade-only' }))
    ).rejects.toThrow('safe-upgrade-only')
    expect(mockSuiPublish).not.toHaveBeenCalled()
    expect(mockSuiUpgrade).not.toHaveBeenCalled()
  })
})
