# NeoMesh Smart Contracts - Flow Documentation

This document describes all possible scenarios and flows for the NeoMesh smart contract system.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [User Onboarding Flow](#user-onboarding-flow)
3. [Policy Management](#policy-management)
4. [Intent Creation & Execution](#intent-creation--execution)
5. [Transfer Validation](#transfer-validation)
6. [Multi-Sig Safe Operations](#multi-sig-safe-operations)
7. [Protocol Management](#protocol-management)
8. [Emergency & Security Flows](#emergency--security-flows)
9. [Edge Cases & Error Scenarios](#edge-cases--error-scenarios)

---

## System Overview

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

### Contract Roles

| Contract | Purpose |
|----------|---------|
| **StrategyRouter** | Central coordinator for intents and routing |
| **PolicyGuard** | Enforces user-defined risk policies |
| **SafeExecutor** | Multi-sig transaction management |
| **AdapterBase** | Interface for DeFi protocol integrations |

---

## User Onboarding Flow

### Scenario 1: New User Setup

```
User                    PolicyGuard              StrategyRouter
  │                          │                         │
  │  1. createPolicy()       │                         │
  │  (dailyLimit, exposure,  │                         │
  │   riskScore, whitelist)  │                         │
  │─────────────────────────>│                         │
  │                          │                         │
  │  ✅ PolicyCreated event  │                         │
  │<─────────────────────────│                         │
  │                          │                         │
  │  2. createIntent()       │                         │
  │  (targetAPY, maxRisk,    │                         │
  │   liquidityReserve, gas) │                         │
  │────────────────────────────────────────────────────>│
  │                          │                         │
  │  ✅ IntentCreated event  │                         │
  │<───────────────────────────────────────────────────│
```

**Parameters Explained:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `dailyLimit` | Max daily transfer amount | 100 ETH |
| `maxProtocolExposure` | Max % in single protocol (basis points) | 2000 = 20% |
| `maxRiskScore` | Max acceptable risk (1-10) | 5 |
| `requireWhitelist` | Only allow whitelisted protocols | true/false |
| `targetAPY` | Desired yield (basis points) | 800 = 8% |

---

## Policy Management

### Scenario 2: Update Policy

```
User                    PolicyGuard
  │                          │
  │  createPolicy() again    │
  │  (new parameters)        │
  │─────────────────────────>│
  │                          │
  │  ✅ Old policy replaced  │
  │  ✅ PolicyCreated event  │
  │<─────────────────────────│
```

> **Note:** Creating a new policy overwrites the existing one. Daily spent counter resets.

### Scenario 3: Policy Validation Checks

```
createPolicy() called
        │
        ▼
┌───────────────────┐
│ dailyLimit > 0 ?  │──No──> ❌ InvalidDailyLimit
└───────────────────┘
        │ Yes
        ▼
┌───────────────────┐
│ exposure ≤ 10000? │──No──> ❌ InvalidExposureLimit
└───────────────────┘
        │ Yes
        ▼
┌───────────────────┐
│ 1 ≤ risk ≤ 10 ?   │──No──> ❌ InvalidRiskScore
└───────────────────┘
        │ Yes
        ▼
┌───────────────────┐
│ User blacklisted? │──Yes─> ❌ UserBlacklisted
└───────────────────┘
        │ No
        ▼
    ✅ Policy Created
```

---

## Intent Creation & Execution

### Scenario 4: Create Investment Intent

```solidity
// User wants: 8% APY, medium risk, keep 1 ETH liquid
strategyRouter.createIntent(
    800,                    // 8% target APY
    5,                      // Risk tolerance (1-10)
    1 ether,                // Liquidity reserve
    0.01 ether              // Max gas per rebalance
);
```

**Intent ID Generation:**
```
intentId = keccak256(
    abi.encodePacked(msg.sender, block.timestamp, targetAPY, maxRisk)
)
```

### Scenario 5: Find Optimal Route

```
StrategyRouter                 Adapters
      │                           │
      │  getOptimalRoute()        │
      │  (amount, targetAPY,      │
      │   maxRisk)                │
      │                           │
      │  Query each adapter:      │
      │  ─────────────────────────>│ Aave: 8% APY, Risk 3
      │  ─────────────────────────>│ Compound: 6% APY, Risk 5
      │  ─────────────────────────>│ Lido: 4.5% APY, Risk 2
      │                           │
      │  Filter by maxRisk        │
      │  Select highest APY       │
      │  that meets targetAPY     │
      │                           │
      │  Return: (Aave, 800)      │
      │<──────────────────────────│
```

**Selection Logic:**
1. Filter adapters where `riskScore ≤ maxRisk`
2. Filter adapters where `currentAPY ≥ targetAPY`
3. Select adapter with highest APY
4. If no match: return `(address(0), 0)`

### Scenario 6: Execute Route

```
User                StrategyRouter           PolicyGuard           Adapter
  │                       │                       │                   │
  │  executeRoute()       │                       │                   │
  │──────────────────────>│                       │                   │
  │                       │                       │                   │
  │                       │  validateTransfer()   │                   │
  │                       │──────────────────────>│                   │
  │                       │                       │                   │
  │                       │  ✅ Transfer valid    │                   │
  │                       │<──────────────────────│                   │
  │                       │                       │                   │
  │                       │  deposit()            │                   │
  │                       │──────────────────────────────────────────>│
  │                       │                       │                   │
  │                       │  ✅ Shares returned   │                   │
  │                       │<─────────────────────────────────────────│
  │                       │                       │                   │
  │  ✅ RouteExecuted     │                       │                   │
  │<──────────────────────│                       │                   │
```

---

## Transfer Validation

### Scenario 7: Successful Transfer

```
validateTransfer(user, protocol, amount)
                │
                ▼
┌─────────────────────────┐
│ User has active policy? │──No──> ❌ NoActivePolicy
└─────────────────────────┘
                │ Yes
                ▼
┌─────────────────────────┐
│ User is blacklisted?    │──Yes─> ❌ UserBlacklisted
└─────────────────────────┘
                │ No
                ▼
┌─────────────────────────┐
│ Reset daily limit?      │──Yes─> Reset dailySpent = 0
│ (24h passed)            │
└─────────────────────────┘
                │
                ▼
┌─────────────────────────┐
│ dailySpent + amount     │──Yes─> ❌ TransferBlocked
│ > dailyLimit?           │        (DAILY_LIMIT)
└─────────────────────────┘
                │ No
                ▼
┌─────────────────────────┐
│ Whitelist required AND  │──Yes─> ❌ TransferBlocked
│ protocol not whitelisted│        (NOT_WHITELISTED)
└─────────────────────────┘
                │ No
                ▼
┌─────────────────────────┐
│ Protocol risk >         │──Yes─> ❌ TransferBlocked
│ user's maxRiskScore?    │        (RISK_TOO_HIGH)
└─────────────────────────┘
                │ No
                ▼
        ✅ TransferValidated
        Update dailySpent
        Update protocolExposure
```

### Scenario 8: Daily Limit Reset

```
Timeline:
─────────────────────────────────────────────────────────────>
│                                                            │
│  User creates policy                                       │
│  dailyLimit = 100 ETH                                      │
│  │                                                         │
│  ▼                                                         │
│  Transfer 60 ETH ✅                                        │
│  dailySpent = 60 ETH                                       │
│  │                                                         │
│  ▼                                                         │
│  Transfer 50 ETH ❌ (would exceed 100)                     │
│  │                                                         │
│  │                    24 hours pass                        │
│  │                         │                               │
│  ▼                         ▼                               │
│                    dailySpent resets to 0                  │
│                            │                               │
│                            ▼                               │
│                    Transfer 50 ETH ✅                      │
```

### Scenario 9: Multi-Protocol Daily Limit

```
User Policy: dailyLimit = 100 ETH

Transfer 60 ETH to Aave    ✅  dailySpent = 60
Transfer 30 ETH to Compound ✅  dailySpent = 90
Transfer 20 ETH to Lido    ❌  dailySpent would be 110 > 100

Note: Daily limit is GLOBAL across all protocols
```

---

## Multi-Sig Safe Operations

### Scenario 10: Register a Gnosis Safe

```
Signer                  SafeExecutor
   │                         │
   │  registerSafe()         │
   │  (safeAddress,          │
   │   threshold: 2,         │
   │   signers: [A, B, C],   │
   │   delay: 1 hour)        │
   │────────────────────────>│
   │                         │
   │  ✅ SafeRegistered      │
   │<────────────────────────│
```

**Validation Rules:**
- `threshold > 0`
- `threshold ≤ signers.length`
- `delay = 0` OR `1 hour ≤ delay ≤ 7 days`

### Scenario 11: Complete Transaction Flow

```
                    Queue           Confirm         Wait          Execute
                      │                │              │              │
Timeline: ────────────┼────────────────┼──────────────┼──────────────┼────>
                      │                │              │              │
                      ▼                ▼              ▼              ▼
                 Router queues    Signers         Delay         Anyone
                 transaction      confirm         period        executes
                                  (2 of 3)        passes
```

**Detailed Flow:**

```
Router              SafeExecutor              Signer1    Signer2    Signer3
  │                      │                       │          │          │
  │  queueTransaction()  │                       │          │          │
  │─────────────────────>│                       │          │          │
  │                      │                       │          │          │
  │  ✅ TransactionQueued│                       │          │          │
  │  (txHash returned)   │                       │          │          │
  │<─────────────────────│                       │          │          │
  │                      │                       │          │          │
  │                      │  confirmTransaction() │          │          │
  │                      │<──────────────────────│          │          │
  │                      │  ✅ Confirmed (1/2)   │          │          │
  │                      │                       │          │          │
  │                      │  confirmTransaction() │          │          │
  │                      │<─────────────────────────────────│          │
  │                      │  ✅ Confirmed (2/2)   │          │          │
  │                      │                       │          │          │
  │                      │        ⏳ Wait for delay (1 hour)           │
  │                      │                       │          │          │
  │                      │  executeTransaction() │          │          │
  │                      │<────────────────────────────────────────────│
  │                      │                       │          │          │
  │                      │  ✅ TransactionExecuted                     │
```

### Scenario 12: Transaction Cancellation

```
Signer              SafeExecutor
   │                      │
   │  cancelTransaction() │
   │─────────────────────>│
   │                      │
   │  ✅ Cancelled        │
   │<─────────────────────│
   │                      │
   │  (Later attempts     │
   │   to confirm or      │
   │   execute will fail) │
```

**Post-Cancellation:**
- `confirmTransaction()` → ❌ TransactionCancelled
- `executeTransaction()` → ❌ TransactionCancelled

### Scenario 13: Transaction States

```
┌──────────┐     queue      ┌──────────┐
│  (none)  │───────────────>│  QUEUED  │
└──────────┘                └──────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │ confirm     │             │ cancel
                    ▼             │             ▼
              ┌──────────┐       │       ┌───────────┐
              │CONFIRMING│       │       │ CANCELLED │
              │ (1 of N) │       │       └───────────┘
              └──────────┘       │
                    │            │
                    │ confirm    │
                    ▼            │
              ┌──────────┐       │
              │ CONFIRMED│       │
              │ (N of N) │       │
              └──────────┘       │
                    │            │
                    │ delay      │
                    ▼            │
              ┌──────────┐       │
              │  READY   │───────┘
              └──────────┘
                    │
                    │ execute
                    ▼
              ┌──────────┐
              │ EXECUTED │
              └──────────┘
```

---

## Protocol Management

### Scenario 14: Whitelist a Protocol

```
Owner               PolicyGuard
  │                      │
  │  whitelistProtocol() │
  │  (protocol, risk: 3) │
  │─────────────────────>│
  │                      │
  │  ✅ ProtocolWhitelisted
  │<─────────────────────│
```

### Scenario 15: Register an Adapter

```
Owner               StrategyRouter
  │                      │
  │  registerAdapter()   │
  │  (adapter, "Aave")   │
  │─────────────────────>│
  │                      │
  │  ✅ AdapterRegistered│
  │<─────────────────────│
```

---

## Emergency & Security Flows

### Scenario 16: Soft Pause (Emergency Pause)

```
Owner               PolicyGuard              User
  │                      │                     │
  │  emergencyPause()    │                     │
  │  (user, "Suspicious")│                     │
  │─────────────────────>│                     │
  │                      │                     │
  │  ✅ EmergencyPause   │                     │
  │<─────────────────────│                     │
  │                      │                     │
  │                      │  validateTransfer() │
  │                      │<────────────────────│
  │                      │  ❌ NoActivePolicy  │
  │                      │────────────────────>│
  │                      │                     │
  │                      │  createPolicy()     │
  │                      │<────────────────────│
  │                      │  ✅ Policy created  │
  │                      │  (User reactivated) │
```

> **Use Case:** Temporary issues, user can self-recover

### Scenario 17: Hard Block (Blacklist)

```
Owner               PolicyGuard              User
  │                      │                     │
  │  blacklistUser()     │                     │
  │  (user, "Malicious") │                     │
  │─────────────────────>│                     │
  │                      │                     │
  │  ✅ UserBlacklisted  │                     │
  │<─────────────────────│                     │
  │                      │                     │
  │                      │  validateTransfer() │
  │                      │<────────────────────│
  │                      │  ❌ UserBlacklisted │
  │                      │────────────────────>│
  │                      │                     │
  │                      │  createPolicy()     │
  │                      │<────────────────────│
  │                      │  ❌ UserBlacklisted │
  │                      │  (Cannot recover)   │
  │                      │────────────────────>│
```

> **Use Case:** Malicious actors, permanent block until owner removes

### Scenario 18: Unblacklist User

```
Owner               PolicyGuard              User
  │                      │                     │
  │  unblacklistUser()   │                     │
  │─────────────────────>│                     │
  │                      │                     │
  │  ✅ UserUnblacklisted│                     │
  │<─────────────────────│                     │
  │                      │                     │
  │                      │  createPolicy()     │
  │                      │<────────────────────│
  │                      │  ✅ Policy created  │
  │                      │────────────────────>│
```

### Comparison: Soft Pause vs Hard Block

| Feature | emergencyPause() | blacklistUser() |
|---------|------------------|-----------------|
| Deactivates policy | ✅ | ✅ |
| User can create new policy | ✅ | ❌ |
| Persists across policy recreation | ❌ | ✅ |
| Requires owner to remove | ❌ | ✅ |
| Use case | Temporary issues | Malicious actors |

---

## Edge Cases & Error Scenarios

### Scenario 19: All Error Conditions

| Error | Trigger | Contract |
|-------|---------|----------|
| `NotOwner` | Non-owner calls admin function | All |
| `NoActivePolicy` | User has no policy or paused | PolicyGuard |
| `UserBlacklisted` | User is blacklisted | PolicyGuard |
| `InvalidDailyLimit` | dailyLimit = 0 | PolicyGuard |
| `InvalidExposureLimit` | exposure > 10000 | PolicyGuard |
| `InvalidRiskScore` | risk < 1 or risk > 10 | PolicyGuard |
| `ZeroAddress` | address(0) provided | All |
| `InvalidRiskLevel` | risk < 1 or risk > 10 | StrategyRouter |
| `UnrealisticAPY` | APY > 5000 (50%) | StrategyRouter |
| `NotIntentOwner` | Wrong user executes intent | StrategyRouter |
| `AlreadyRegistered` | Adapter already registered | StrategyRouter |
| `NotRouter` | Non-router queues transaction | SafeExecutor |
| `NotSigner` | Non-signer confirms/cancels | SafeExecutor |
| `InvalidThreshold` | threshold = 0 or > signers | SafeExecutor |
| `InvalidDelay` | delay < 1h or > 7 days | SafeExecutor |
| `SafeNotRegistered` | Safe not registered | SafeExecutor |
| `AlreadyConfirmed` | Double confirmation | SafeExecutor |
| `AlreadyExecuted` | Double execution | SafeExecutor |
| `TransactionCancelled` | Action on cancelled tx | SafeExecutor |
| `NotEnoughConfirmations` | Execute before threshold | SafeExecutor |
| `DelayNotPassed` | Execute before delay | SafeExecutor |

### Scenario 20: Boundary Values

| Parameter | Minimum | Maximum |
|-----------|---------|---------|
| Daily Limit | 1 wei | uint256 max |
| Protocol Exposure | 0 (0%) | 10000 (100%) |
| Risk Score | 1 | 10 |
| Target APY | 0 (0%) | 5000 (50%) |
| Safe Threshold | 1 | signers.length |
| Safe Delay | 0 or 3600 (1h) | 604800 (7 days) |

### Scenario 21: Race Conditions & Timing

**Daily Limit Reset:**
```
- Resets after 24 hours (86400 seconds)
- Check: block.timestamp > lastResetTimestamp + 1 days - 1
```

**Transaction Delay:**
```
- Must wait full delay period after queuing
- Check: block.timestamp >= queuedAt + delay
```

---

## Quick Reference

### User Actions

| Action | Contract | Function |
|--------|----------|----------|
| Create policy | PolicyGuard | `createPolicy()` |
| Create intent | StrategyRouter | `createIntent()` |
| Execute route | StrategyRouter | `executeRoute()` |
| Check remaining limit | PolicyGuard | `getRemainingDailyLimit()` |

### Owner Actions

| Action | Contract | Function |
|--------|----------|----------|
| Whitelist protocol | PolicyGuard | `whitelistProtocol()` |
| Soft pause user | PolicyGuard | `emergencyPause()` |
| Hard block user | PolicyGuard | `blacklistUser()` |
| Unblock user | PolicyGuard | `unblacklistUser()` |
| Register adapter | StrategyRouter | `registerAdapter()` |

### Signer Actions

| Action | Contract | Function |
|--------|----------|----------|
| Register Safe | SafeExecutor | `registerSafe()` |
| Confirm transaction | SafeExecutor | `confirmTransaction()` |
| Cancel transaction | SafeExecutor | `cancelTransaction()` |
| Execute transaction | SafeExecutor | `executeTransaction()` |

---

## Gas Optimization Notes

1. **Custom Errors** - Used instead of `require()` strings for gas savings
2. **++i vs i++** - Pre-increment used in loops
3. **Strict Inequalities** - `>` instead of `>=` where possible
4. **Indexed Events** - Key parameters indexed for efficient filtering

---

*Document generated for NeoMesh Smart Contracts v1.0*
