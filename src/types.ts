export type DeployMode = 'auto' | 'force-publish' | 'safe-upgrade-only'

export interface Inputs {
  /** Absolute path to the Move package directory */
  dir: string
  /** Environment alias in local Sui CLI config (e.g. testnet, mainnet) */
  env: string
  /** Optional RPC URL override */
  rpcUrl?: string
  deployMode: DeployMode
}

// ─── Published.toml ────────────────────────────────────────────────────────

export interface PublishedEntry {
  chainId: string
  publishedAt: string
  originalId: string
  version: number
  toolchainVersion: string
  /** Raw inline-table string, e.g. `{ flavor = "sui", edition = "2024" }` */
  buildConfig: string
  upgradeCapability: string
}

// ─── Sui CLI output ────────────────────────────────────────────────────────

/** Subset of `SuiTransactionBlockResponse` we care about */
export interface TxResponse {
  digest: string
  effects: {
    status: { status: 'success' | 'failure'; error?: string }
  }
  objectChanges: ObjectChange[]
}

export type ObjectChange =
  | PublishedObjectChange
  | CreatedObjectChange
  | MutatedObjectChange
  | OtherObjectChange

export interface PublishedObjectChange {
  type: 'published'
  packageId: string
  version: string
  digest: string
  modules: string[]
}

export interface CreatedObjectChange {
  type: 'created'
  objectType: string
  objectId: string
  version: string
  digest: string
  owner: unknown
}

export interface MutatedObjectChange {
  type: 'mutated'
  objectType: string
  objectId: string
  version: string
  digest: string
  owner: unknown
}

export interface OtherObjectChange {
  type: string
  [key: string]: unknown
}

// ─── Deploy result ─────────────────────────────────────────────────────────

export interface DeployResult {
  digest: string
  packageId: string
  upgradeCap: string
  publishedType: 'new' | 'upgraded'
  previousPackageId: string
}
