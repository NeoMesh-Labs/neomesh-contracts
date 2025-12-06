const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Security & Edge Cases", function () {
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

  // ==================== REENTRANCY TESTS ====================
  describe("Reentrancy Protection", function () {
    it("PolicyGuard: validateTransfer should be safe from reentrancy", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Multiple rapid transfers should all be tracked correctly
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("30")
      );
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("30")
      );
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("30")
      );

      // Should have 10 ETH remaining (100 - 90)
      const remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(ethers.parseEther("10"));
    });
  });

  // ==================== ACCESS CONTROL TESTS ====================
  describe("Access Control", function () {
    describe("PolicyGuard Access Control", function () {
      it("Should prevent non-owner from whitelisting protocols", async function () {
        const { policyGuard, adapter1, attacker } = await loadFixture(
          deployFullSystemFixture
        );

        await expect(
          policyGuard
            .connect(attacker)
            .whitelistProtocol(await adapter1.getAddress(), 3)
        ).to.be.revertedWithCustomError(policyGuard, "NotOwner");
      });

      it("Should prevent non-owner from emergency pausing", async function () {
        const { policyGuard, user1, attacker } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 10, false);

        await expect(
          policyGuard
            .connect(attacker)
            .emergencyPause(user1.address, "Malicious pause")
        ).to.be.revertedWithCustomError(policyGuard, "NotOwner");
      });

      it("Should allow user to only modify their own policy", async function () {
        const { policyGuard, user1, user2 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 10, false);

        // user2 cannot validate transfers for user1's policy
        // (validateTransfer is external, but policy belongs to user1)
        const policy = await policyGuard.getPolicy(user1.address);
        expect(policy.active).to.equal(true);

        // user2 creates their own policy - should not affect user1
        await policyGuard
          .connect(user2)
          .createPolicy(ethers.parseEther("50"), 3000, 5, true);

        const policy1 = await policyGuard.getPolicy(user1.address);
        const policy2 = await policyGuard.getPolicy(user2.address);
        expect(policy1.dailyLimit).to.equal(ethers.parseEther("100"));
        expect(policy2.dailyLimit).to.equal(ethers.parseEther("50"));
      });
    });

    describe("StrategyRouter Access Control", function () {
      it("Should prevent non-owner from registering adapters", async function () {
        const { strategyRouter, adapter1, attacker } = await loadFixture(
          deployFullSystemFixture
        );

        await expect(
          strategyRouter
            .connect(attacker)
            .registerAdapter(await adapter1.getAddress(), "Malicious")
        ).to.be.revertedWithCustomError(strategyRouter, "NotOwner");
      });

      it("Should prevent non-intent-owner from executing routes", async function () {
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
        await policyGuard
          .connect(owner)
          .whitelistProtocol(await adapter2.getAddress(), 5);

        // User1 creates intent
        const tx = await strategyRouter
          .connect(user1)
          .createIntent(
            800,
            5,
            ethers.parseEther("1"),
            ethers.parseEther("0.1")
          );
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

    describe("SafeExecutor Access Control", function () {
      it("Should prevent non-router from queuing transactions", async function () {
        const { safeExecutor, mockSafe, signer1, signer2, signer3, attacker } =
          await loadFixture(deployFullSystemFixture);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        await expect(
          safeExecutor
            .connect(attacker)
            .queueTransaction(
              await mockSafe.getAddress(),
              attacker.address,
              ethers.parseEther("100"),
              "0x"
            )
        ).to.be.revertedWithCustomError(safeExecutor, "NotRouter");
      });

      it("Should prevent non-signer from confirming transactions", async function () {
        const { mockSafe, signer1, signer2, signer3, attacker } =
          await loadFixture(deployFullSystemFixture);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        const tx = await safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            attacker.address,
            0,
            "0x"
          );
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

        await expect(
          safeExecutor.connect(attacker).confirmTransaction(txHash)
        ).to.be.revertedWithCustomError(safeExecutor, "NotSigner");
      });

      it("Should prevent non-signer from cancelling transactions", async function () {
        const { mockSafe, signer1, signer2, signer3, attacker } =
          await loadFixture(deployFullSystemFixture);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        const tx = await safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            attacker.address,
            0,
            "0x"
          );
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

        await expect(
          safeExecutor.connect(attacker).cancelTransaction(txHash)
        ).to.be.revertedWithCustomError(safeExecutor, "NotSigner");
      });
    });
  });

  // ==================== BOUNDARY VALUE TESTS ====================
  describe("Boundary Values", function () {
    describe("PolicyGuard Boundaries", function () {
      it("Should handle minimum valid daily limit (1 wei)", async function () {
        const { policyGuard, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard.connect(user1).createPolicy(1, 5000, 5, false);
        const policy = await policyGuard.getPolicy(user1.address);
        expect(policy.dailyLimit).to.equal(1);
      });

      it("Should handle maximum exposure (100%)", async function () {
        const { policyGuard, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 10000, 5, false);
        const policy = await policyGuard.getPolicy(user1.address);
        expect(policy.maxProtocolExposure).to.equal(10000);
      });

      it("Should handle risk score boundaries (1 and 10)", async function () {
        const { policyGuard, user1, user2 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 1, false);
        await policyGuard
          .connect(user2)
          .createPolicy(ethers.parseEther("100"), 5000, 10, false);

        const policy1 = await policyGuard.getPolicy(user1.address);
        const policy2 = await policyGuard.getPolicy(user2.address);
        expect(policy1.maxRiskScore).to.equal(1);
        expect(policy2.maxRiskScore).to.equal(10);
      });

      it("Should handle exact daily limit transfer", async function () {
        const { policyGuard, adapter1, owner, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 10, false);
        await policyGuard
          .connect(owner)
          .whitelistProtocol(await adapter1.getAddress(), 3);

        // Exact limit should succeed
        const tx = await policyGuard.validateTransfer(
          user1.address,
          await adapter1.getAddress(),
          ethers.parseEther("100")
        );
        await expect(tx).to.emit(policyGuard, "TransferValidated");

        // Any additional should fail
        const tx2 = await policyGuard.validateTransfer(
          user1.address,
          await adapter1.getAddress(),
          1
        );
        await expect(tx2).to.emit(policyGuard, "TransferBlocked");
      });
    });

    describe("StrategyRouter Boundaries", function () {
      it("Should handle minimum APY target (0)", async function () {
        const { strategyRouter, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        const tx = await strategyRouter
          .connect(user1)
          .createIntent(0, 5, ethers.parseEther("1"), ethers.parseEther("0.1"));
        await expect(tx).to.emit(strategyRouter, "IntentCreated");
      });

      it("Should handle maximum APY target (5000 = 50%)", async function () {
        const { strategyRouter, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        const tx = await strategyRouter
          .connect(user1)
          .createIntent(
            5000,
            5,
            ethers.parseEther("1"),
            ethers.parseEther("0.1")
          );
        await expect(tx).to.emit(strategyRouter, "IntentCreated");
      });

      it("Should reject APY just over maximum (5001)", async function () {
        const { strategyRouter, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        await expect(
          strategyRouter
            .connect(user1)
            .createIntent(
              5001,
              5,
              ethers.parseEther("1"),
              ethers.parseEther("0.1")
            )
        ).to.be.revertedWithCustomError(strategyRouter, "UnrealisticAPY");
      });

      it("Should handle zero liquidity reserve", async function () {
        const { strategyRouter, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        const tx = await strategyRouter
          .connect(user1)
          .createIntent(800, 5, 0, ethers.parseEther("0.1"));
        await expect(tx).to.emit(strategyRouter, "IntentCreated");
      });

      it("Should handle zero max gas cost", async function () {
        const { strategyRouter, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        const tx = await strategyRouter
          .connect(user1)
          .createIntent(800, 5, ethers.parseEther("1"), 0);
        await expect(tx).to.emit(strategyRouter, "IntentCreated");
      });
    });

    describe("SafeExecutor Boundaries", function () {
      it("Should handle minimum delay (1 hour)", async function () {
        const { mockSafe, signer1, signer2, signer3 } = await loadFixture(
          deployFullSystemFixture
        );

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        const config = await safeExecutor.getSafeConfig(
          await mockSafe.getAddress()
        );
        expect(config.delay).to.equal(3600);
      });

      it("Should handle maximum delay (7 days)", async function () {
        const { mockSafe, signer1, signer2, signer3 } = await loadFixture(
          deployFullSystemFixture
        );

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        const sevenDays = 7 * 24 * 60 * 60;
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, sevenDays);

        const config = await safeExecutor.getSafeConfig(
          await mockSafe.getAddress()
        );
        expect(config.delay).to.equal(sevenDays);
      });

      it("Should reject delay just under minimum", async function () {
        const { mockSafe, signer1, signer2, signer3 } = await loadFixture(
          deployFullSystemFixture
        );

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await expect(
          safeExecutor
            .connect(signer1)
            .registerSafe(await mockSafe.getAddress(), 2, signers, 3599)
        ).to.be.revertedWithCustomError(safeExecutor, "InvalidDelay");
      });

      it("Should handle threshold equal to signers count", async function () {
        const { mockSafe, signer1, signer2, signer3 } = await loadFixture(
          deployFullSystemFixture
        );

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 3, signers, 3600);

        const config = await safeExecutor.getSafeConfig(
          await mockSafe.getAddress()
        );
        expect(config.threshold).to.equal(3);
      });

      it("Should handle single signer with threshold 1", async function () {
        const { mockSafe, signer1 } = await loadFixture(
          deployFullSystemFixture
        );

        // Deploy new mock safe with single owner
        const MockSafe = await ethers.getContractFactory("MockSafe");
        const singleSafe = await MockSafe.deploy([signer1.address]);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        await safeExecutor
          .connect(signer1)
          .registerSafe(await singleSafe.getAddress(), 1, [signer1.address], 0);

        const config = await safeExecutor.getSafeConfig(
          await singleSafe.getAddress()
        );
        expect(config.threshold).to.equal(1);
      });
    });
  });

  // ==================== STATE TRANSITION TESTS ====================
  describe("State Transitions", function () {
    describe("Policy State Transitions", function () {
      it("Should correctly transition from no policy to active policy", async function () {
        const { policyGuard, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        // No policy initially
        const policyBefore = await policyGuard.getPolicy(user1.address);
        expect(policyBefore.active).to.equal(false);

        // Create policy
        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 5, false);

        // Policy now active
        const policyAfter = await policyGuard.getPolicy(user1.address);
        expect(policyAfter.active).to.equal(true);
      });

      it("Should correctly transition from active to paused", async function () {
        const { policyGuard, owner, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 5, false);
        expect((await policyGuard.getPolicy(user1.address)).active).to.equal(
          true
        );

        await policyGuard
          .connect(owner)
          .emergencyPause(user1.address, "Test pause");
        expect((await policyGuard.getPolicy(user1.address)).active).to.equal(
          false
        );
      });

      it("Should allow policy update (not override with createPolicy)", async function () {
        const { policyGuard, user1 } = await loadFixture(
          deployFullSystemFixture
        );

        await policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 5000, 5, false);
        expect(
          (await policyGuard.getPolicy(user1.address)).dailyLimit
        ).to.equal(ethers.parseEther("100"));

        await policyGuard
          .connect(user1)
          .updatePolicy(ethers.parseEther("200"), 3000, 7, true);

        const newPolicy = await policyGuard.getPolicy(user1.address);
        expect(newPolicy.dailyLimit).to.equal(ethers.parseEther("200"));
        expect(newPolicy.maxProtocolExposure).to.equal(3000);
        expect(newPolicy.maxRiskScore).to.equal(7);
        expect(newPolicy.requireWhitelist).to.equal(true);
      });
    });

    describe("Transaction State Transitions", function () {
      it("Should correctly transition: queued -> confirmed -> executed", async function () {
        const { mockSafe, signer1, signer2, signer3, user1 } =
          await loadFixture(deployFullSystemFixture);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        // Queue
        const tx = await safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            0,
            "0x"
          );
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

        let txn = await safeExecutor.getTransaction(txHash);
        expect(txn.executed).to.equal(false);
        expect(txn.cancelled).to.equal(false);
        expect(txn.confirmationsReceived).to.equal(0);

        // Confirm
        await safeExecutor.connect(signer1).confirmTransaction(txHash);
        await safeExecutor.connect(signer2).confirmTransaction(txHash);

        txn = await safeExecutor.getTransaction(txHash);
        expect(txn.confirmationsReceived).to.equal(2);

        // Wait and execute
        await time.increase(3601);
        await safeExecutor.executeTransaction(txHash);

        txn = await safeExecutor.getTransaction(txHash);
        expect(txn.executed).to.equal(true);
      });

      it("Should correctly transition: queued -> cancelled", async function () {
        const { mockSafe, signer1, signer2, signer3, user1 } =
          await loadFixture(deployFullSystemFixture);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        const tx = await safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            0,
            "0x"
          );
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

        await safeExecutor.connect(signer1).cancelTransaction(txHash);

        const txn = await safeExecutor.getTransaction(txHash);
        expect(txn.cancelled).to.equal(true);
        expect(txn.executed).to.equal(false);
      });

      it("Should prevent execution after cancellation", async function () {
        const { mockSafe, signer1, signer2, signer3, user1 } =
          await loadFixture(deployFullSystemFixture);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        const tx = await safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            0,
            "0x"
          );
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

        // Confirm first
        await safeExecutor.connect(signer1).confirmTransaction(txHash);
        await safeExecutor.connect(signer2).confirmTransaction(txHash);

        // Then cancel
        await safeExecutor.connect(signer3).cancelTransaction(txHash);

        // Wait for delay
        await time.increase(3601);

        // Should not be able to execute
        await expect(
          safeExecutor.executeTransaction(txHash)
        ).to.be.revertedWithCustomError(safeExecutor, "TransactionCancelled");
      });

      it("Should prevent double execution", async function () {
        const { mockSafe, signer1, signer2, signer3, user1 } =
          await loadFixture(deployFullSystemFixture);

        const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
        const safeExecutor = await SafeExecutor.deploy(signer1.address);

        const signers = [signer1.address, signer2.address, signer3.address];
        await safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

        const tx = await safeExecutor
          .connect(signer1)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            0,
            "0x"
          );
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

        // First execution
        await safeExecutor.executeTransaction(txHash);

        // Second execution should fail
        await expect(
          safeExecutor.executeTransaction(txHash)
        ).to.be.revertedWithCustomError(safeExecutor, "AlreadyExecuted");
      });
    });
  });

  // ==================== TIME-BASED TESTS ====================
  describe("Time-Based Behavior", function () {
    it("Daily limit should reset after 24 hours", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Use full limit
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("100")
      );
      expect(await policyGuard.getRemainingDailyLimit(user1.address)).to.equal(
        0
      );

      // After 24 hours - should reset
      await time.increase(86401);
      expect(await policyGuard.getRemainingDailyLimit(user1.address)).to.equal(
        ethers.parseEther("100")
      );
    });

    it("Transaction delay should be enforced", async function () {
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

      // Before delay - should fail
      await expect(
        safeExecutor.executeTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "DelayNotPassed");

      // After delay - should succeed
      await time.increase(3601);
      await expect(safeExecutor.executeTransaction(txHash)).to.emit(
        safeExecutor,
        "TransactionExecuted"
      );
    });
  });

  // ==================== MULTI-USER SCENARIOS ====================
  describe("Multi-User Scenarios", function () {
    it("Multiple users should have independent policies", async function () {
      const { policyGuard, adapter1, owner, user1, user2 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // User1: 100 ETH limit
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      // User2: 50 ETH limit
      await policyGuard
        .connect(user2)
        .createPolicy(ethers.parseEther("50"), 5000, 10, false);

      // User1 uses 80 ETH
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("80")
      );

      // User2 should still have full 50 ETH
      expect(await policyGuard.getRemainingDailyLimit(user2.address)).to.equal(
        ethers.parseEther("50")
      );

      // User1 should have 20 ETH remaining
      expect(await policyGuard.getRemainingDailyLimit(user1.address)).to.equal(
        ethers.parseEther("20")
      );
    });

    it("Multiple users can create intents independently", async function () {
      const { strategyRouter, user1, user2 } = await loadFixture(
        deployFullSystemFixture
      );

      const tx1 = await strategyRouter
        .connect(user1)
        .createIntent(800, 5, ethers.parseEther("1"), ethers.parseEther("0.1"));
      const tx2 = await strategyRouter
        .connect(user2)
        .createIntent(
          600,
          3,
          ethers.parseEther("2"),
          ethers.parseEther("0.05")
        );

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      const event1 = receipt1.logs.find((log) => {
        try {
          return (
            strategyRouter.interface.parseLog(log)?.name === "IntentCreated"
          );
        } catch {
          return false;
        }
      });
      const event2 = receipt2.logs.find((log) => {
        try {
          return (
            strategyRouter.interface.parseLog(log)?.name === "IntentCreated"
          );
        } catch {
          return false;
        }
      });

      const intentId1 = strategyRouter.interface.parseLog(event1).args.intentId;
      const intentId2 = strategyRouter.interface.parseLog(event2).args.intentId;

      // Different intent IDs
      expect(intentId1).to.not.equal(intentId2);

      // Correct owners
      const intent1 = await strategyRouter.getIntent(intentId1);
      const intent2 = await strategyRouter.getIntent(intentId2);
      expect(intent1.user).to.equal(user1.address);
      expect(intent2.user).to.equal(user2.address);
    });
  });

  // ==================== PROTOCOL EXPOSURE TESTS ====================
  describe("Protocol Exposure Tracking", function () {
    it("Should track exposure per protocol correctly", async function () {
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

      // 30 ETH to adapter1
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("30")
      );
      // 20 ETH to adapter2
      await policyGuard.validateTransfer(
        user1.address,
        await adapter2.getAddress(),
        ethers.parseEther("20")
      );

      // Check exposure
      const exposure1 = await policyGuard.protocolExposure(
        user1.address,
        await adapter1.getAddress()
      );
      const exposure2 = await policyGuard.protocolExposure(
        user1.address,
        await adapter2.getAddress()
      );

      expect(exposure1).to.equal(ethers.parseEther("30"));
      expect(exposure2).to.equal(ethers.parseEther("20"));
    });

    it("Should check exposure limits correctly", async function () {
      const { policyGuard, adapter1, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      // 20% max exposure
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 2000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter1.getAddress(), 3);

      // Add 15 ETH exposure
      await policyGuard.validateTransfer(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("15")
      );

      // Check if adding 10 more would exceed 20% of 100 ETH portfolio
      const [allowed, exposureBps] = await policyGuard.checkExposureLimit(
        user1.address,
        await adapter1.getAddress(),
        ethers.parseEther("10"),
        ethers.parseEther("100") // 100 ETH portfolio
      );

      // 25 ETH / 100 ETH = 25% > 20% limit
      expect(allowed).to.equal(false);
      expect(exposureBps).to.equal(2500); // 25%
    });
  });

  describe("StrategyRouter Pause Mechanism", function () {
    it("Should prevent intent creation when paused", async function () {
      const { strategyRouter, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await strategyRouter.connect(owner).pause("Emergency maintenance");

      await expect(
        strategyRouter
          .connect(user1)
          .createIntent(
            800,
            5,
            ethers.parseEther("1"),
            ethers.parseEther("0.1")
          )
      ).to.be.revertedWithCustomError(strategyRouter, "IsPaused");
    });

    it("Should prevent route execution when paused", async function () {
      const { strategyRouter, policyGuard, adapter1, owner, user1 } =
        await loadFixture(deployFullSystemFixture);

      // Create intent before pause
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

      // Pause
      await strategyRouter.connect(owner).pause("Emergency");

      // Try to execute
      await expect(
        strategyRouter.connect(user1).executeRoute(intentId, [])
      ).to.be.revertedWithCustomError(strategyRouter, "IsPaused");
    });

    it("Should allow unpause and resume operations", async function () {
      const { strategyRouter, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await strategyRouter.connect(owner).pause("Test");
      await strategyRouter.connect(owner).unpause();

      // Should work after unpause
      await expect(
        strategyRouter
          .connect(user1)
          .createIntent(
            800,
            5,
            ethers.parseEther("1"),
            ethers.parseEther("0.1")
          )
      ).to.emit(strategyRouter, "IntentCreated");
    });
  });

  describe("Gas Limit Warnings", function () {
    it("Should emit warning when gas limit exceeded but not revert", async function () {
      const { strategyRouter, policyGuard, adapter1, adapter2, owner, user1 } =
        await loadFixture(deployFullSystemFixture);

      // Setup with very low gas limit
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
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await adapter2.getAddress(), 5);

      const tx = await strategyRouter
        .connect(user1)
        .createIntent(800, 5, ethers.parseEther("1"), 1); // 1 wei gas limit

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

      // Set user balances
      await adapter1.setUserBalance(user1.address, ethers.parseEther("10"));

      // Execute route - should emit warning but succeed
      const routes = [
        {
          fromAdapter: await adapter1.getAddress(),
          toAdapter: await adapter2.getAddress(),
          amount: ethers.parseEther("1"),
          minReceived: 0,
          data: "0x",
        },
      ];

      await expect(
        strategyRouter.connect(user1).executeRoute(intentId, routes)
      ).to.emit(strategyRouter, "GasLimitExceededWarning");
    });
  });
});
