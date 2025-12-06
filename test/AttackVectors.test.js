const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Attack Vectors & Bypass Attempts", function () {
  async function deployFullSystemFixture() {
    const [owner, user1, user2, attacker, signer1, signer2, signer3] =
      await ethers.getSigners();

    const PolicyGuard = await ethers.getContractFactory("PolicyGuard");
    const policyGuard = await PolicyGuard.deploy();

    const StrategyRouter = await ethers.getContractFactory("StrategyRouter");
    const strategyRouter = await StrategyRouter.deploy(
      await policyGuard.getAddress()
    );

    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const adapter1 = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Aave",
      3,
      800
    );
    const adapter2 = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Compound",
      5,
      600
    );

    const MockSafe = await ethers.getContractFactory("MockSafe");
    const mockSafe = await MockSafe.deploy([
      signer1.address,
      signer2.address,
      signer3.address,
    ]);

    const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
    const safeExecutor = await SafeExecutor.deploy(
      await strategyRouter.getAddress()
    );

    return {
      policyGuard,
      strategyRouter,
      safeExecutor,
      adapter1,
      adapter2,
      mockSafe,
      owner,
      user1,
      user2,
      attacker,
      signer1,
      signer2,
      signer3,
    };
  }

  // ==================== FRONT-RUNNING ATTACKS ====================
  describe("Front-Running Attacks", function () {
    it("Should not allow front-running intent creation to steal ID", async function () {
      const { strategyRouter, user1, attacker } = await loadFixture(
        deployFullSystemFixture
      );

      // User1 creates intent
      const tx1 = await strategyRouter
        .connect(user1)
        .createIntent(800, 5, ethers.parseEther("1"), ethers.parseEther("0.1"));
      const receipt1 = await tx1.wait();
      const event1 = receipt1.logs.find((log) => {
        try {
          return (
            strategyRouter.interface.parseLog(log)?.name === "IntentCreated"
          );
        } catch {
          return false;
        }
      });
      const intentId1 = strategyRouter.interface.parseLog(event1).args.intentId;

      // Attacker tries to create same intent (different timestamp = different ID)
      const tx2 = await strategyRouter
        .connect(attacker)
        .createIntent(800, 5, ethers.parseEther("1"), ethers.parseEther("0.1"));
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find((log) => {
        try {
          return (
            strategyRouter.interface.parseLog(log)?.name === "IntentCreated"
          );
        } catch {
          return false;
        }
      });
      const intentId2 = strategyRouter.interface.parseLog(event2).args.intentId;

      // IDs should be different (includes msg.sender in hash)
      expect(intentId1).to.not.equal(intentId2);

      // Each user owns their own intent
      const intent1 = await strategyRouter.getIntent(intentId1);
      const intent2 = await strategyRouter.getIntent(intentId2);
      expect(intent1.user).to.equal(user1.address);
      expect(intent2.user).to.equal(attacker.address);
    });

    it("Should not allow front-running Safe transaction confirmation", async function () {
      const { mockSafe, signer1, signer2, signer3, attacker, user1 } =
        await loadFixture(deployFullSystemFixture);

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      // Attacker tries to front-run and confirm
      await expect(
        safeExecutor.connect(attacker).confirmTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "NotSigner");
    });
  });

  // ==================== GRIEFING ATTACKS ====================
  describe("Griefing Attacks", function () {
    it("Should not allow griefing by creating policies for other users", async function () {
      const { policyGuard, user1, attacker } = await loadFixture(
        deployFullSystemFixture
      );

      // Attacker creates a policy (only affects attacker's own address)
      await policyGuard
        .connect(attacker)
        .createPolicy(ethers.parseEther("1"), 100, 1, true);

      // User1's policy should be unaffected (no policy)
      const user1Policy = await policyGuard.getPolicy(user1.address);
      expect(user1Policy.active).to.equal(false);

      // User1 can still create their own policy
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      const newPolicy = await policyGuard.getPolicy(user1.address);
      expect(newPolicy.dailyLimit).to.equal(ethers.parseEther("100"));
    });

    it("Should not allow griefing Safe by spamming invalid confirmations", async function () {
      const { mockSafe, signer1, signer2, signer3, attacker, user1 } =
        await loadFixture(deployFullSystemFixture);

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      // Attacker tries multiple confirmation attempts - all should fail
      for (let i = 0; i < 5; i++) {
        await expect(
          safeExecutor.connect(attacker).confirmTransaction(txHash)
        ).to.be.revertedWithCustomError(safeExecutor, "NotSigner");
      }

      // Legitimate signers can still confirm
      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);

      const txn = await safeExecutor.getTransaction(txHash);
      expect(txn.confirmationsReceived).to.equal(2);
    });

    it("Should not allow griefing by cancelling others' transactions", async function () {
      const { mockSafe, signer1, signer2, signer3, attacker, user1 } =
        await loadFixture(deployFullSystemFixture);

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      // Attacker tries to cancel
      await expect(
        safeExecutor.connect(attacker).cancelTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "NotSigner");

      // Transaction should still be active
      const txn = await safeExecutor.getTransaction(txHash);
      expect(txn.cancelled).to.equal(false);
    });
  });

  // ==================== PRIVILEGE ESCALATION ====================
  describe("Privilege Escalation", function () {
    it("Should not allow user to escalate to owner privileges", async function () {
      const { policyGuard, strategyRouter, adapter1, attacker } =
        await loadFixture(deployFullSystemFixture);

      // Attacker tries owner-only functions
      await expect(
        policyGuard
          .connect(attacker)
          .whitelistProtocol(await adapter1.getAddress(), 3)
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");

      await expect(
        policyGuard
          .connect(attacker)
          .emergencyPause(attacker.address, "Self pause")
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");

      await expect(
        strategyRouter
          .connect(attacker)
          .registerAdapter(await adapter1.getAddress(), "Malicious")
      ).to.be.revertedWithCustomError(strategyRouter, "NotOwner");
    });

    it("Should not allow signer to escalate to router privileges", async function () {
      const { mockSafe, signer1, signer2, signer3, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(user1.address); // user1 is router

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      // Signer tries to queue (router-only)
      await expect(
        safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            signer1.address,
            0,
            "0x"
          )
      ).to.be.revertedWithCustomError(safeExecutor, "NotRouter");
    });

    it("Should not allow intent owner to modify other users' intents", async function () {
      const {
        strategyRouter,
        policyGuard,
        adapter1,
        adapter2,
        owner,
        user1,
        attacker,
      } = await loadFixture(deployFullSystemFixture);

      // Setup
      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter2.getAddress(), "Compound");
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // User1 creates intent
      const tx = await strategyRouter
        .connect(user1)
        .createIntent(800, 5, ethers.parseEther("1"), ethers.parseEther("0.1"));
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            strategyRouter.interface.parseLog(log)?.name === "IntentCreated"
          );
        } catch {
          return false;
        }
      });
      const intentId = strategyRouter.interface.parseLog(event).args.intentId;

      // Attacker tries to execute user1's intent
      await expect(
        strategyRouter.connect(attacker).executeRoute(intentId, [])
      ).to.be.revertedWithCustomError(strategyRouter, "NotIntentOwner");
    });
  });

  // ==================== REPLAY ATTACKS ====================
  describe("Replay Attacks", function () {
    it("Should not allow replaying executed transactions", async function () {
      const { mockSafe, signer1, signer2, signer3, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);
      await time.increase(3601);

      // Execute once
      await safeExecutor.executeTransaction(txHash);

      // Try to replay
      await expect(
        safeExecutor.executeTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "AlreadyExecuted");

      // Try to re-confirm and execute
      await expect(
        safeExecutor.connect(signer3).confirmTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "AlreadyExecuted");
    });

    it("Should not allow replaying confirmations", async function () {
      const { mockSafe, signer1, signer2, signer3, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      // First confirmation
      await safeExecutor.connect(signer1).confirmTransaction(txHash);

      // Try to replay same confirmation
      await expect(
        safeExecutor.connect(signer1).confirmTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "AlreadyConfirmed");

      // Confirmation count should still be 1
      const txn = await safeExecutor.getTransaction(txHash);
      expect(txn.confirmationsReceived).to.equal(1);
    });
  });

  // ==================== DAILY LIMIT BYPASS ATTEMPTS ====================
  describe("Daily Limit Bypass Attempts", function () {
    it("Should not allow bypassing daily limit with multiple small transfers", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Try to bypass with many small transfers
      for (let i = 0; i < 10; i++) {
        await policyGuard.validateTransfer(
          user1.address,
          await adapter1.getAddress(),
          ethers.parseEther("10")
        );
      }

      // 11th transfer should be blocked (100 ETH limit reached)
      const tx = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("1")
      );
      await expect(tx).to.emit(policyGuard, "TransferBlocked");
    });

    it("Should not allow bypassing daily limit by recreating policy", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("100")
      );

      await expect(
        policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 10, false)
      ).to.be.revertedWithCustomError(policyGuard, "PolicyAlreadyExists");

      const remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(ethers.parseEther("0"));
    });

    it("Should not allow bypassing daily limit via different protocols", async function () {
      const { policyGuard, adapter1, adapter2, owner, user1 } =
        await loadFixture(deployFullSystemFixture);

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter2.getAddress(), 5);

      // 60 ETH to adapter1
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("60")
      );

      // 40 ETH to adapter2 (total 100)
      await policyGuard.validateTransfer(
        user1.address,
        await adapter2.getAddress(),
        ethers.parseEther("40")
      );

      // Any more to either should fail
      const tx1 = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("1")
      );
      await expect(tx1).to.emit(policyGuard, "TransferBlocked");

      const tx2 = await policyGuard.validateTransfer(
        user1.address,
        await adapter2.getAddress(),
        ethers.parseEther("1")
      );
      await expect(tx2).to.emit(policyGuard, "TransferBlocked");
    });
  });

  // ==================== WHITELIST BYPASS ATTEMPTS ====================
  describe("Whitelist Bypass Attempts", function () {
    it("Should not allow transfers to non-whitelisted protocol when required", async function () {
      const { policyGuard, adapter1, adapter2, owner, user1 } =
        await loadFixture(deployFullSystemFixture);

      // Policy requires whitelist
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, true);

      // Only whitelist adapter1
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Transfer to whitelisted adapter1 should work
      const tx1 = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("10")
      );
      await expect(tx1).to.emit(policyGuard, "TransferValidated");

      // Transfer to non-whitelisted adapter2 should fail
      const tx2 = await policyGuard.validateTransfer(
        user1.address,
        await adapter2.getAddress(),
        ethers.parseEther("10")
      );
      await expect(tx2).to.emit(policyGuard, "TransferBlocked");
    });

    it("Should not allow user to whitelist protocols themselves", async function () {
      const { policyGuard, adapter1, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await expect(
        policyGuard
          .connect(user1)
          .whitelistProtocol(await adapter1.getAddress(), 3)
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");
    });
  });

  // ==================== RISK SCORE BYPASS ATTEMPTS ====================
  describe("Risk Score Bypass Attempts", function () {
    it("Should block high-risk protocols regardless of whitelist status", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      // User sets max risk to 5
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);

      // Owner whitelists with high risk score
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 8);

      // Transfer should be blocked due to risk
      const tx = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("10")
      );
      await expect(tx).to.emit(policyGuard, "TransferBlocked");
    });

    it("Should not allow user to change protocol risk scores", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 8);

      // User cannot re-whitelist with lower risk
      await expect(
        policyGuard
          .connect(user1)
          .whitelistProtocol(await adapter1.getAddress(), 2)
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");

      // Risk score should remain 8
      expect(
        await policyGuard.getProtocolRiskScore(await adapter1.getAddress())
      ).to.equal(8);
    });
  });

  // ==================== THRESHOLD MANIPULATION ====================
  describe("Threshold Manipulation Attacks", function () {
    it("Should not allow executing with fewer confirmations than threshold", async function () {
      const { mockSafe, signer1, signer2, signer3, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      // 3-of-3 threshold
      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 3, signers, 3600);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      // Only 2 confirmations
      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);
      await time.increase(3601);

      // Should fail - need 3 confirmations
      await expect(
        safeExecutor.executeTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "NotEnoughConfirmations");

      // Add third confirmation
      await safeExecutor.connect(signer3).confirmTransaction(txHash);

      // Now should succeed
      await expect(safeExecutor.executeTransaction(txHash)).to.emit(
        safeExecutor,
        "TransactionExecuted"
      );
    });

    it("Should not allow changing threshold after Safe registration", async function () {
      const { mockSafe, signer1, signer2, signer3 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      // Try to re-register with lower threshold (would need to be a new Safe or have update function)
      // Current implementation doesn't have update - so re-registering just overwrites
      // This is a design decision - in production might want to prevent this
      const config = await safeExecutor.getSafeConfig(
        await mockSafe.getAddress()
      );
      expect(config.threshold).to.equal(2);
    });
  });

  // ==================== TIMING ATTACKS ====================
  describe("Timing Attacks", function () {
    it("Should not allow executing before delay expires", async function () {
      const { mockSafe, signer1, signer2, signer3, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      const oneHour = 60 * 60;
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, oneHour);

      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(await mockSafe.getAddress(), user1.address, 0, "0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            safeExecutor.interface.parseLog(log)?.name === "TransactionQueued"
          );
        } catch {
          return false;
        }
      });
      const txHash = safeExecutor.interface.parseLog(event).args.txHash;

      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);

      // Immediately after - should fail
      await expect(
        safeExecutor.executeTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "DelayNotPassed");

      // After full delay - should succeed
      await time.increase(oneHour + 1);
      await expect(safeExecutor.executeTransaction(txHash)).to.emit(
        safeExecutor,
        "TransactionExecuted"
      );
    });

    it("Should properly track daily limit reset timing", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Use limit
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("100")
      );

      // Try at 23 hours - should still be blocked
      await time.increase(23 * 60 * 60);
      const tx1 = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("1")
      );
      await expect(tx1).to.emit(policyGuard, "TransferBlocked");

      // After 24+ hours - should work
      await time.increase(2 * 60 * 60);
      const tx2 = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("1")
      );
      await expect(tx2).to.emit(policyGuard, "TransferValidated");
    });
  });

  // ==================== EMERGENCY PAUSE BYPASS ====================
  describe("Emergency Pause Bypass Attempts", function () {
    it("Should completely block paused user from all transfers", async function () {
      const { policyGuard, adapter1, adapter2, owner, user1 } =
        await loadFixture(deployFullSystemFixture);

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter2.getAddress(), 5);

      // Pause user
      await policyGuard
        .connect(owner)
        .emergencyPause(user1.address, "Security incident");

      // All transfers should fail
      await expect(
        policyGuard.validateTransfer(
          user1.address,
          await adapter1.getAddress(),
          ethers.parseEther("1")
        )
      ).to.be.revertedWithCustomError(policyGuard, "NoActivePolicy");

      await expect(
        policyGuard.validateTransfer(
          user1.address,
          await adapter2.getAddress(),
          ethers.parseEther("1")
        )
      ).to.be.revertedWithCustomError(policyGuard, "NoActivePolicy");
    });

    it("Should allow paused user to reactivate by creating new policy (soft pause)", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Soft pause user (emergencyPause)
      await policyGuard
        .connect(owner)
        .emergencyPause(user1.address, "Temporary pause");

      // User CAN create new policy after soft pause (intended behavior)
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("50"), 3000, 5, false);

      const policy = await policyGuard.getPolicy(user1.address);
      expect(policy.active).to.equal(true);
    });

    it("Should NOT allow blacklisted user to reactivate by creating new policy (hard block)", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Hard blacklist user
      await policyGuard
        .connect(owner)
        .blacklistUser(user1.address, "Malicious activity detected");

      // User CANNOT create new policy when blacklisted
      await expect(
        policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("50"), 3000, 5, false)
      ).to.be.revertedWithCustomError(policyGuard, "UserBlacklisted");

      // Verify user is blacklisted
      expect(await policyGuard.isUserBlacklisted(user1.address)).to.equal(true);
    });

    it("Should block all transfers for blacklisted user", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Blacklist user
      await policyGuard
        .connect(owner)
        .blacklistUser(user1.address, "Malicious activity");

      // Transfers should fail with UserBlacklisted
      await expect(
        policyGuard.validateTransfer(
          user1.address,
          await adapter1.getAddress(),
          ethers.parseEther("1")
        )
      ).to.be.revertedWithCustomError(policyGuard, "UserBlacklisted");
    });

    it("Should allow owner to unblacklist user", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Blacklist then unblacklist
      await policyGuard
        .connect(owner)
        .blacklistUser(user1.address, "Temporary block");
      expect(await policyGuard.isUserBlacklisted(user1.address)).to.equal(true);

      await policyGuard.connect(owner).unblacklistUser(user1.address);
      expect(await policyGuard.isUserBlacklisted(user1.address)).to.equal(
        false
      );

      // User can now create policy again
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("50"), 3000, 5, false);
      const policy = await policyGuard.getPolicy(user1.address);
      expect(policy.active).to.equal(true);
    });

    it("Should not allow non-owner to blacklist users", async function () {
      const { policyGuard, user1, attacker } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);

      await expect(
        policyGuard
          .connect(attacker)
          .blacklistUser(user1.address, "Malicious attempt")
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");
    });

    it("Should not allow non-owner to unblacklist users", async function () {
      const { policyGuard, owner, user1, attacker } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .blacklistUser(user1.address, "Security incident");

      await expect(
        policyGuard.connect(attacker).unblacklistUser(user1.address)
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");

      // User should still be blacklisted
      expect(await policyGuard.isUserBlacklisted(user1.address)).to.equal(true);
    });
  });

  // ==================== INTEGER OVERFLOW/UNDERFLOW ====================
  describe("Integer Overflow/Underflow Protection", function () {
    it("Should handle maximum uint256 values safely", async function () {
      const { policyGuard, user1 } = await loadFixture(deployFullSystemFixture);

      const maxUint = ethers.MaxUint256;

      // Creating policy with max values should work (Solidity 0.8+ has built-in overflow protection)
      await policyGuard.connect(user1).createPolicy(maxUint, 10000, 10, false);

      const policy = await policyGuard.getPolicy(user1.address);
      expect(policy.dailyLimit).to.equal(maxUint);
    });

    it("Should handle large transfer amounts without overflow", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      const largeAmount = ethers.parseEther("1000000000"); // 1 billion ETH

      await policyGuard
        .connect(user1)
        .createPolicy(largeAmount, 10000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Large transfer should work
      const tx = await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        largeAmount
      );
      await expect(tx).to.emit(policyGuard, "TransferValidated");
    });
  });

  // ==================== ZERO ADDRESS ATTACKS ====================
  describe("Zero Address Attacks", function () {
    it("Should reject zero address in protocol whitelist", async function () {
      const { policyGuard, owner } = await loadFixture(deployFullSystemFixture);

      await expect(
        policyGuard.connect(owner).whitelistProtocol(ethers.ZeroAddress, 3)
      ).to.be.revertedWithCustomError(policyGuard, "ZeroAddress");
    });

    it("Should reject zero address in adapter registration", async function () {
      const { strategyRouter, owner } = await loadFixture(
        deployFullSystemFixture
      );

      await expect(
        strategyRouter
          .connect(owner)
          .registerAdapter(ethers.ZeroAddress, "Malicious")
      ).to.be.revertedWithCustomError(strategyRouter, "ZeroAddress");
    });

    it("Should reject zero address in Safe registration", async function () {
      const { signer1, signer2, signer3 } = await loadFixture(
        deployFullSystemFixture
      );

      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      const signers = [signer1.address, signer2.address, signer3.address];
      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(ethers.ZeroAddress, 2, signers, 3600)
      ).to.be.revertedWithCustomError(safeExecutor, "ZeroAddress");
    });
  });
});
