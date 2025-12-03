# NeoMesh Smart Contracts

> Intent-based Money OS for Web3 - Core Smart Contracts

## Overview

NeoMesh is an intent-based orchestration layer that automates fund allocation across DeFi protocols. These contracts form the core infrastructure for managing intents, enforcing policies, and executing transactions securely.

## Contracts

### Core Contracts

| Contract | Description |
|----------|-------------|
| `StrategyRouter.sol` | Routes capital between adapters based on intents and gas costs |
| `PolicyGuard.sol` | Enforces spending limits, whitelists, and risk caps |
| `AdapterBase.sol` | Standardized interface for protocol integrations |
| `SafeExecutor.sol` | Gnosis Safe module for multi-sig execution |

### Interfaces

| Interface | Description |
|-----------|-------------|
| `IAdapter.sol` | Standard interface for all protocol adapters |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Intents                           │
│  "Keep 2 months liquid, target 8% APY, max 20% per protocol"│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    StrategyRouter                           │
│  • Parses intents into executable routes                    │
│  • Optimizes for gas costs                                  │
│  • Coordinates adapter interactions                         │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   PolicyGuard   │ │  SafeExecutor   │ │  AdapterBase    │
│  • Risk limits  │ │  • Multi-sig    │ │  • Aave         │
│  • Whitelists   │ │  • Time delays  │ │  • Uniswap      │
│  • Daily caps   │ │  • Safe module  │ │  • Lido         │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Installation

```bash
# Clone the repository
git clone https://github.com/neomesh-labs/neomesh-contracts.git
cd neomesh-contracts

# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test
```

## Usage

### Creating an Intent

```solidity
// Create a new investment intent
bytes32 intentId = strategyRouter.createIntent(
    800,      // 8% target APY (basis points)
    5,        // Medium risk tolerance (1-10)
    1 ether,  // Keep 1 ETH liquid
    0.01 ether // Max 0.01 ETH gas per rebalance
);
```

### Setting Up Policies

```solidity
// Create a policy with daily limits and risk caps
policyGuard.createPolicy(
    100 ether,  // 100 ETH daily limit
    2000,       // Max 20% exposure per protocol
    7,          // Max risk score of 7
    true        // Require whitelisted protocols
);
```

### Registering a Safe

```solidity
// Register a Gnosis Safe for multi-sig execution
address[] memory signers = new address[](3);
signers[0] = signer1;
signers[1] = signer2;
signers[2] = signer3;

safeExecutor.registerSafe(
    safeAddress,
    2,          // 2-of-3 threshold
    signers,
    1 hours     // 1 hour delay before execution
);
```

## Security

- All contracts are designed to be non-custodial
- Policy constraints are enforced on-chain
- Multi-sig support via Gnosis Safe integration
- Circuit breakers and emergency pause functionality

## Audits

🔜 Audits pending - contracts are in development

## License

MIT License - see [LICENSE](LICENSE) for details

## Links

- [Website](https://neomesh.io)
- [Documentation](https://docs.neomesh.io)
- [Twitter](https://twitter.com/neomesh_io)
