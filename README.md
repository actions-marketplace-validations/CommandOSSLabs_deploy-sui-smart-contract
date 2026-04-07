# 🚀 deploy-sui-smart-contract

Publish or upgrade a Sui Move smart contract package using the Sui CLI. This action automates the deployment process, handling both new deployments and upgrades based on the specified strategy.

> [!NOTE] Notice
> As this action uses the Sui CLI under the hood, it will update the `Published.toml` file in-place to reflect the new package ID after deployment. Make sure to commit the updated `Published.toml` file back to your repository if you want to keep it in sync with the deployed contract.

## Prerequisite

This action requires [`setup-sui-cli`](https://github.com/marketplace/actions/setup-sui-cli) to run first, with a funded deployer wallet configured for the target network.

## Inputs

| Input         | Default   | Description                                                                                     |
| ------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `dir`         | `.`       | Directory containing `Published.toml` and Move package files.                                   |
| `env`         | `testnet` | Target Sui environment in the `Published.toml` file.                                            |
| `rpc-url`     | -         | Optional RPC URL override. If omitted, uses the official endpoint for the selected environment. |
| `deploy-mode` | `auto`    | Deployment strategy: `auto`, `force-publish`, or `safe-upgrade-only`.                           |

### RPC URL

The `rpc-url` input controls which RPC endpoint is used for deployment:

- **If specified**: The provided URL is used, overriding the default.
- **If omitted**: Uses the official Sui CLI RPC endpoint based on the `env` parameter:
  - `mainnet`: `https://fullnode.mainnet.sui.io:443`
  - `testnet` (default): `https://fullnode.testnet.sui.io:443`
  - Other environments will fallback to the `testnet` endpoint unless they are recognized by the Sui CLI.

### Deploy Modes

- **`auto`** (default): Attempts to upgrade the contract whenever possible. If the changes are incompatible with the existing upgrade cap, a force-publish is performed instead.
- **`force-publish`**: Ignores the existing upgrade cap and published packages; publishes a new contract every time.
- **`safe-upgrade-only`**: Attempts to upgrade like `auto` mode, but throws an error if incompatible changes are detected instead of falling back to force-publish.

## Outputs

| Output                 | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `digest`               | Transaction digest.                                                                                                                  |
| `upgrade-cap`          | Upgrade capability object ID used for package upgrades.                                                                              |
| `published-package-id` | Package ID after publish/upgrade.                                                                                                    |
| `published-type`       | Publish result type, either `new` or `upgraded`.                                                                                     |
| `previous-package-id`  | Empty when newly published; same as `published-package-id` when upgraded; holds the previous package ID when force-upgrade was used. |

## Examples

Setup Sui CLI and deploy:

```yaml
- name: 📦 Setup Sui CLI
  uses: CommandOSSLabs/setup-sui-cli@v1
  with:
    network: testnet
    private_key: ${{ secrets.SUI_DEPLOYER_PRIVATE_KEY }}

- name: 🚀 Deploy Sui smart contract
  uses: CommandOSSLabs/deploy-sui-smart-contract@v1
  with:
    dir: ./move
    env: testnet
```

Deploy with custom RPC URL:

```yaml
- name: 🚀 Deploy Sui smart contract
  uses: CommandOSSLabs/deploy-sui-smart-contract@v1
  with:
    dir: ./move
    env: testnet
    rpc-url: https://fullnode.testnet.sui.io:443
```

## License

This project is licensed under the [Apache License 2.0](LICENSE).
