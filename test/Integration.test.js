const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Integration Tests - Full Flow", function () {
  async function deployFullSystemFixture() {
    const [owner, user1, user2, signer1, signer2, signer3] =
      await ethers.getSigners();

    // Deploy PolicyGuard
    const PolicyGuard = await ethers.getContractFactory("PolicyGuard");
    const policyGuard = await PolicyGuard.deploy();

    // Deploy StrategyRouter
    const StrategyRouter = await ethers.getContractFactory("StrategyRouter");
    const strategyRouter = await StrategyRouter.deploy(
      await policyGuard.getAddress()
    );

    // Deploy SafeExecutor
    const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
    const safeExecutor = await SafeExecutor.deploy(
      await strategyRouter.getAddress()
    );

    // Deploy Mock Adapters
    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const aaveAdapter = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Aave",
      3,
      800
    );
    const compoundAdapter = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Compound",
      5,
      600
    );
    const lidoAdapter = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Lido",
      2,
      450
    );

    // Deploy Mock Safe
    const MockSafe = await ethers.getContractFactory("MockSafe");
    const mockSafe = await MockSafe.deploy([
      signer1.address,
      signer2.address,
      signer3.address,
    ]);

    return {
      policyGuard,
      strategyRouter,
      safeExecutor,
      aaveAdapter,
      compoundAdapter,
      lidoAdapter,
      mockSafe,
      owner,
      user1,
      user2,
      signer1,
      signer2,
      signer3,
    };
  }

  describe("Flow 1: User Onboarding", function () {
    it("Should complete full user onboarding flow", async function () {
      const { policyGuard, strategyRouter, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      // Step 1: User creates a policy
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 2000, 7, true);

      const policy = await policyGuard.getPolicy(user1.address);
      expect(policy.active).to.equal(true);

      // Step 2: User creates an intent
      const tx = await strategyRouter
        .connect(user1)
        .createIntent(
          800,
          5,
          ethers.parseEther("2"),
          ethers.parseEther("0.05")
        );

      await expect(tx).to.emit(strategyRouter, "IntentCreated");
    });
  });

  describe("Flow 2: Protocol Registration & Whitelisting", function () {
    it("Should register adapters and whitelist protocols", async function () {
      const {
        policyGuard,
        strategyRouter,
        aaveAdapter,
        compoundAdapter,
        lidoAdapter,
        owner,
      } = await loadFixture(deployFullSystemFixture);

      // Register adapters
      await strategyRouter
        .connect(owner)
        .registerAdapter(await aaveAdapter.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await compoundAdapter.getAddress(), "Compound");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await lidoAdapter.getAddress(), "Lido");

      expect(await strategyRouter.getAdapterCount()).to.equal(3);

      // Whitelist protocols
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await aaveAdapter.getAddress(), 3);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await compoundAdapter.getAddress(), 5);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await lidoAdapter.getAddress(), 2);

      expect(
        await policyGuard.isProtocolWhitelisted(await aaveAdapter.getAddress())
      ).to.equal(true);
    });
  });

  describe("Flow 3: Optimal Route Selection", function () {
    it("Should find best adapter based on user preferences", async function () {
      const {
        strategyRouter,
        aaveAdapter,
        compoundAdapter,
        lidoAdapter,
        owner,
      } = await loadFixture(deployFullSystemFixture);

      await strategyRouter
        .connect(owner)
        .registerAdapter(await aaveAdapter.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await compoundAdapter.getAddress(), "Compound");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await lidoAdapter.getAddress(), "Lido");

      // Aave (8%, risk 3) should win for 5% target with max risk 5
      let [bestAdapter, expectedAPY] = await strategyRouter.getOptimalRoute(
        ethers.parseEther("10"),
        500,
        5
      );
      expect(bestAdapter).to.equal(await aaveAdapter.getAddress());
      expect(expectedAPY).to.equal(800);

      // Lido (4.5%, risk 2) should win for 4% target with max risk 2
      [bestAdapter, expectedAPY] = await strategyRouter.getOptimalRoute(
        ethers.parseEther("10"),
        400,
        2
      );
      expect(bestAdapter).to.equal(await lidoAdapter.getAddress());
    });
  });

  describe("Flow 4: Policy Enforcement", function () {
    it("Should enforce daily limits across multiple transfers", async function () {
      const { policyGuard, aaveAdapter, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await aaveAdapter.getAddress(), 3);

      // First transfer: 60 ETH
      await policyGuard.validateTransfer(
        user1.address,
        await aaveAdapter.getAddress(),
        ethers.parseEther("60")
      );

      // Second transfer: 30 ETH (total 90, within limit)
      const tx1 = await policyGuard.validateTransfer(
        user1.address,
        await aaveAdapter.getAddress(),
        ethers.parseEther("30")
      );
      await expect(tx1).to.emit(policyGuard, "TransferValidated");

      // Third transfer: 20 ETH (total 110, exceeds 100 limit)
      const tx2 = await policyGuard.validateTransfer(
        user1.address,
        await aaveAdapter.getAddress(),
        ethers.parseEther("20")
      );
      await expect(tx2).to.emit(policyGuard, "TransferBlocked");

      // Check remaining limit
      const remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(ethers.parseEther("10"));
    });

    it("Should reset daily limit after 24 hours", async function () {
      const { policyGuard, aaveAdapter, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await aaveAdapter.getAddress(), 3);

      // Use up daily limit
      await policyGuard.validateTransfer(
        user1.address,
        await aaveAdapter.getAddress(),
        ethers.parseEther("100")
      );

      let remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(0);

      // Fast forward 24 hours
      await time.increase(86401);

      // Limit should be reset
      remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(ethers.parseEther("100"));
    });
  });

  describe("Flow 5: Multi-Sig Safe Execution", function () {
    it("Should complete full Safe transaction flow", async function () {
      const { mockSafe, signer1, signer2, signer3, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      // Deploy SafeExecutor with signer1 as router for testing
      const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
      const safeExecutor = await SafeExecutor.deploy(signer1.address);

      // Register Safe
      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      // Queue transaction (signer1 is the router)
      const tx = await safeExecutor
        .connect(signer1)
        .queueTransaction(
          await mockSafe.getAddress(),
          user1.address,
          ethers.parseEther("1"),
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

      // Confirm by 2 signers
      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);

      // Check confirmations
      expect(await safeExecutor.isConfirmed(txHash, signer1.address)).to.equal(
        true
      );
      expect(await safeExecutor.isConfirmed(txHash, signer2.address)).to.equal(
        true
      );
      expect(await safeExecutor.isConfirmed(txHash, signer3.address)).to.equal(
        false
      );

      // Cannot execute yet (delay not passed)
      expect(await safeExecutor.canExecute(txHash)).to.equal(false);

      // Wait for delay
      await time.increase(3601);

      // Now can execute
      expect(await safeExecutor.canExecute(txHash)).to.equal(true);

      // Execute
      await expect(safeExecutor.executeTransaction(txHash)).to.emit(
        safeExecutor,
        "TransactionExecuted"
      );
    });
  });

  describe("Flow 6: Emergency Scenarios", function () {
    it("Should handle emergency pause correctly", async function () {
      const { policyGuard, aaveAdapter, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 10, false);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await aaveAdapter.getAddress(), 3);

      // Normal transfer works
      await policyGuard.validateTransfer(
        user1.address,
        await aaveAdapter.getAddress(),
        ethers.parseEther("10")
      );

      // Emergency pause
      await policyGuard
        .connect(owner)
        .emergencyPause(user1.address, "Suspicious activity detected");

      // Transfers now blocked
      await expect(
        policyGuard.validateTransfer(
          user1.address,
          await aaveAdapter.getAddress(),
          ethers.parseEther("10")
        )
      ).to.be.revertedWithCustomError(policyGuard, "NoActivePolicy");
    });

    it("Should block high-risk protocols", async function () {
      const { policyGuard, aaveAdapter, owner, user1 } = await loadFixture(
        deployFullSystemFixture
      );

      // User sets max risk to 5
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);

      // Protocol has risk 8 (too high)
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await aaveAdapter.getAddress(), 8);

      // Transfer blocked due to high risk
      const tx = await policyGuard.validateTransfer(
        user1.address,
        await aaveAdapter.getAddress(),
        ethers.parseEther("10")
      );
      await expect(tx).to.emit(policyGuard, "TransferBlocked");
    });
  });

  describe("Flow 7: Complete Investment Cycle", function () {
    it("Should simulate complete investment workflow", async function () {
      const {
        policyGuard,
        strategyRouter,
        aaveAdapter,
        compoundAdapter,
        owner,
        user1,
      } = await loadFixture(deployFullSystemFixture);

      // 1. Setup: Register and whitelist protocols
      await strategyRouter
        .connect(owner)
        .registerAdapter(await aaveAdapter.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await compoundAdapter.getAddress(), "Compound");
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await aaveAdapter.getAddress(), 3);
      await policyGuard
        .connect(owner)
        .whitelistProtocol(await compoundAdapter.getAddress(), 5);

      // 2. User creates policy
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("1000"), 3000, 7, true);

      // 3. User creates intent
      const intentTx = await strategyRouter
        .connect(user1)
        .createIntent(
          700,
          5,
          ethers.parseEther("10"),
          ethers.parseEther("0.1")
        );
      await expect(intentTx).to.emit(strategyRouter, "IntentCreated");

      // 4. Find optimal route
      const [bestAdapter, expectedAPY] = await strategyRouter.getOptimalRoute(
        ethers.parseEther("100"),
        700,
        5
      );
      expect(bestAdapter).to.equal(await aaveAdapter.getAddress());

      // 5. Validate transfer through PolicyGuard
      const validateTx = await policyGuard.validateTransfer(
        user1.address,
        bestAdapter,
        ethers.parseEther("100")
      );
      await expect(validateTx).to.emit(policyGuard, "TransferValidated");

      // 6. Check remaining daily limit
      const remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(ethers.parseEther("900"));
    });
  });
});
