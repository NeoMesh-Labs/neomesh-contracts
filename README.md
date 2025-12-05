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
npm run compile

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint contracts
npm run lint
```

## Test Coverage

The test suite includes **129 tests** covering:

### Unit Tests (51 tests)
- **PolicyGuard**: Policy creation, whitelisting, transfer validation, emergency pause
- **StrategyRouter**: Intent creation, adapter registration, optimal routing
- **SafeExecutor**: Safe registration, transaction queue, confirmations, execution

### Integration/Flow Tests (9 tests)
- **User Onboarding**: Complete policy + intent creation flow
- **Protocol Registration**: Adapter registration and whitelisting
- **Optimal Route Selection**: Finding best adapter based on APY/risk
- **Policy Enforcement**: Daily limits, 24h reset, risk blocking
- **Multi-Sig Execution**: Full Safe transaction lifecycle
- **Emergency Scenarios**: Pause functionality, risk blocking
- **Complete Investment Cycle**: End-to-end workflow simulation

### Security & Edge Case Tests (36 tests)
- **Reentrancy Protection**: Rapid sequential transfers
- **Access Control**: Owner-only functions, intent ownership, signer verification
- **Boundary Values**: Min/max limits, exact thresholds, zero values
- **State Transitions**: Policy lifecycle, transaction states, double-execution prevention
- **Time-Based Behavior**: 24h limit reset, delay enforcement
- **Multi-User Scenarios**: Independent policies, isolated intents
- **Protocol Exposure**: Per-protocol tracking, exposure limit checks

### Attack Vector Tests (29 tests)
- **Front-Running Attacks**: Intent ID collision, transaction confirmation hijacking
- **Griefing Attacks**: Policy spam, confirmation spam, cancellation attempts
- **Privilege Escalation**: User-to-owner, signer-to-router, cross-user intent access
- **Replay Attacks**: Double execution, double confirmation prevention
- **Daily Limit Bypass**: Small transfers, policy recreation, multi-protocol splitting
- **Whitelist Bypass**: Non-whitelisted transfers, self-whitelisting attempts
- **Risk Score Bypass**: High-risk protocol blocking, score manipulation
- **Threshold Manipulation**: Under-threshold execution, threshold changes
- **Timing Attacks**: Pre-delay execution, daily reset manipulation
- **Emergency Pause Bypass**: Post-pause transfers, reactivation attempts
- **Integer Overflow/Underflow**: Max uint256 handling, large amounts
- **Zero Address Attacks**: Null address injection in all registration functions

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

## Security Features

✅ **Two-Tier User Blocking:**
- `emergencyPause(user)` - Soft pause, user can reactivate by creating new policy (for temporary issues)
- `blacklistUser(user)` - Hard block, persists across policy recreation (for malicious actors)
- `unblacklistUser(user)` - Owner can remove from blacklist when resolved

## Audits

🔜 Audits pending - contracts are in development

## License

MIT License - see [LICENSE](LICENSE) for details

## Links

- [Website](https://neomesh.io)
- [Documentation](https://docs.neomesh.io)
- [Twitter](https://twitter.com/neomesh_io)
