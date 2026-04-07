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
| `verify-deps` | `true`    | Pass `--verify-deps` to Sui CLI publish/upgrade to verify dependency source code.               |
| `deploy-mode` | `auto`    | Deployment strategy: `auto`, `force-publish`, or `safe-upgrade-only`.                           |

### RPC URL

The `rpc-url` input controls which RPC endpoint is used for deployment:

- **If specified**: The provided URL is used, overriding the default.
- **If omitted**: Uses the official Sui CLI RPC endpoint based on the `env` parameter:
  - `mainnet`: `https://fullnode.mainnet.sui.io:443`
  - `testnet` (default): `https://fullnode.testnet.sui.io:443`
  - Other environments fall back to the `testnet` endpoint.

### Deploy Modes

- **`auto`** (default): If `Published.toml` contains an `upgrade-capability` for the selected `env`, the action attempts an upgrade. If upgrade compatibility checks fail, it falls back to publishing a new package.
- **`force-publish`**: Ignores any existing published entry for the selected `env` and always publishes a new package.
- **`safe-upgrade-only`**: Same as `auto` mode, but if compatibility checks failed, it will error out, ensuring that no unintended new package is published.

## Outputs

| Output                 | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `digest`               | Transaction digest.                                                                                                                  |
| `upgrade-cap`          | Upgrade capability object ID used for package upgrades.                                                                              |
| `published-package-id` | Package ID after publish/upgrade.                                                                                                    |
| `published-type`       | Publish result type, either `new` or `upgraded`.                                                                                     |
| `previous-package-id`  | Empty when newly published; same as `published-package-id` when upgraded; holds the previous package ID when force-publish was used. |

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
