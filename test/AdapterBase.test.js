const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("AdapterBase", function () {
  async function deployAdapterFixture() {
    const [owner, router, user1, user2, attacker] = await ethers.getSigners();

    // Deploy a concrete implementation for testing
    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const adapter = await MockAdapter.deploy(
      router.address,
      "TestProtocol",
      5, // Medium risk
      800 // 8% APY
    );

    return { adapter, owner, router, user1, user2, attacker };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);
      expect(await adapter.owner()).to.equal(owner.address);
    });

    it("Should set the correct strategy router", async function () {
      const { adapter, router } = await loadFixture(deployAdapterFixture);
      expect(await adapter.strategyRouter()).to.equal(router.address);
    });

    it("Should set the correct protocol name", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.protocolName()).to.equal("TestProtocol");
    });

    it("Should set the correct risk score", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.getRiskScore()).to.equal(5);
    });

    it("Should not be paused initially", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.paused()).to.equal(false);
    });

    it("Should revert with zero router address", async function () {
      const MockAdapter = await ethers.getContractFactory("MockAdapter");
      await expect(
        MockAdapter.deploy(ethers.ZeroAddress, "Test", 5, 800)
      ).to.be.revertedWithCustomError(MockAdapter, "ZeroRouter");
    });

    it("Should revert with invalid risk score (0)", async function () {
      const { router } = await loadFixture(deployAdapterFixture);
      const MockAdapter = await ethers.getContractFactory("MockAdapter");
      await expect(
        MockAdapter.deploy(router.address, "Test", 0, 800)
      ).to.be.revertedWithCustomError(MockAdapter, "InvalidRiskScore");
    });

    it("Should revert with invalid risk score (>10)", async function () {
      const { router } = await loadFixture(deployAdapterFixture);
      const MockAdapter = await ethers.getContractFactory("MockAdapter");
      await expect(
        MockAdapter.deploy(router.address, "Test", 11, 800)
      ).to.be.revertedWithCustomError(MockAdapter, "InvalidRiskScore");
    });

    it("Should have correct version", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.VERSION()).to.equal("1.0.0");
    });
  });

  describe("Deposit", function () {
    it("Should allow router to deposit", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      const amount = ethers.parseEther("10");
      const tx = await adapter
        .connect(router)
        .deposit(user1.address, amount, "0x");

      await expect(tx).to.emit(adapter, "Deposited");

      expect(await adapter.userDeposits(user1.address)).to.equal(amount);
      expect(await adapter.totalDeposits()).to.equal(amount);
    });

    it("Should revert when non-router tries to deposit", async function () {
      const { adapter, user1 } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter
          .connect(user1)
          .deposit(user1.address, ethers.parseEther("10"), "0x")
      ).to.be.revertedWithCustomError(adapter, "NotRouter");
    });

    it("Should revert with zero amount", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await expect(
        adapter.connect(router).deposit(user1.address, 0, "0x")
      ).to.be.revertedWithCustomError(adapter, "ZeroAmount");
    });

    it("Should revert with zero address user", async function () {
      const { adapter, router } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter
          .connect(router)
          .deposit(ethers.ZeroAddress, ethers.parseEther("10"), "0x")
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should revert when paused", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      await adapter.connect(owner).pause("Emergency");

      await expect(
        adapter
          .connect(router)
          .deposit(user1.address, ethers.parseEther("10"), "0x")
      ).to.be.revertedWithCustomError(adapter, "IsPaused");
    });

    it("Should handle multiple deposits from same user", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("5"), "0x");
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("3"), "0x");

      expect(await adapter.userDeposits(user1.address)).to.equal(
        ethers.parseEther("8")
      );
      expect(await adapter.totalDeposits()).to.equal(ethers.parseEther("8"));
    });

    it("Should track deposits for multiple users independently", async function () {
      const { adapter, router, user1, user2 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter
        .connect(router)
        .deposit(user2.address, ethers.parseEther("5"), "0x");

      expect(await adapter.userDeposits(user1.address)).to.equal(
        ethers.parseEther("10")
      );
      expect(await adapter.userDeposits(user2.address)).to.equal(
        ethers.parseEther("5")
      );
      expect(await adapter.totalDeposits()).to.equal(ethers.parseEther("15"));
    });
  });

  describe("Withdraw", function () {
    it("Should allow router to withdraw", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      // First deposit
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      // Then withdraw
      const tx = await adapter
        .connect(router)
        .withdraw(user1.address, ethers.parseEther("5"), "0x");

      await expect(tx).to.emit(adapter, "Withdrawn");

      expect(await adapter.userDeposits(user1.address)).to.equal(
        ethers.parseEther("5")
      );
      expect(await adapter.totalDeposits()).to.equal(ethers.parseEther("5"));
    });

    it("Should revert when non-router tries to withdraw", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      await expect(
        adapter
          .connect(user1)
          .withdraw(user1.address, ethers.parseEther("5"), "0x")
      ).to.be.revertedWithCustomError(adapter, "NotRouter");
    });

    it("Should revert with zero amount", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      await expect(
        adapter.connect(router).withdraw(user1.address, 0, "0x")
      ).to.be.revertedWithCustomError(adapter, "ZeroAmount");
    });

    it("Should revert with zero address user", async function () {
      const { adapter, router } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter
          .connect(router)
          .withdraw(ethers.ZeroAddress, ethers.parseEther("5"), "0x")
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should revert when paused", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter.connect(owner).pause("Emergency");

      await expect(
        adapter
          .connect(router)
          .withdraw(user1.address, ethers.parseEther("5"), "0x")
      ).to.be.revertedWithCustomError(adapter, "IsPaused");
    });

    it("Should revert with insufficient balance", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("5"), "0x");

      await expect(
        adapter
          .connect(router)
          .withdraw(user1.address, ethers.parseEther("10"), "0x")
      ).to.be.revertedWithCustomError(adapter, "InsufficientBalance");
    });

    it("Should allow full withdrawal", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter
        .connect(router)
        .withdraw(user1.address, ethers.parseEther("10"), "0x");

      expect(await adapter.userDeposits(user1.address)).to.equal(0);
      expect(await adapter.totalDeposits()).to.equal(0);
    });
  });

  describe("Harvest", function () {
    it("Should allow router to harvest", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      // Deposit first
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      const tx = await adapter.connect(router).harvest(user1.address, 0);
      await expect(tx).to.emit(adapter, "Harvested");
    });

    it("Should revert when non-router tries to harvest", async function () {
      const { adapter, user1 } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(user1).harvest(user1.address, 0)
      ).to.be.revertedWithCustomError(adapter, "NotRouter");
    });

    it("Should revert with zero address user", async function () {
      const { adapter, router } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(router).harvest(ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should revert when paused", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      await adapter.connect(owner).pause("Emergency");

      await expect(
        adapter.connect(router).harvest(user1.address, 0)
      ).to.be.revertedWithCustomError(adapter, "IsPaused");
    });

    it("Should revert if yield below minimum", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      // Mock adapter returns 0 yield by default
      await expect(
        adapter.connect(router).harvest(user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(adapter, "InsufficientBalance");
    });
  });

  describe("View Functions", function () {
    it("Should return current APY", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.getCurrentAPY()).to.equal(800);
    });

    it("Should return risk score", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.getRiskScore()).to.equal(5);
    });

    it("Should return TVL", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      // MockAdapter initializes with 1000 ETH TVL
      expect(await adapter.getTVL()).to.equal(ethers.parseEther("1000"));

      // MockAdapter returns 1000 ETH initially
      expect(await adapter.getTVL()).to.equal(ethers.parseEther("1000"));

      // After deposit, TVL stays at mock value (not actual tracking)
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      expect(await adapter.getTVL()).to.equal(ethers.parseEther("1000"));
    });

    it("Should return user balance", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      expect(await adapter.getUserBalance(user1.address)).to.equal(0);

      // Deposit through router (which updates userDeposits)
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      // getUserBalance should return userDeposits from AdapterBase
      expect(await adapter.getUserBalance(user1.address)).to.equal(
        ethers.parseEther("10")
      );
    });

    it("Should return 0 for zero address balance", async function () {
      const { adapter } = await loadFixture(deployAdapterFixture);
      expect(await adapter.getUserBalance(ethers.ZeroAddress)).to.equal(0);
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      const tx = await adapter.connect(owner).pause("Security concern");
      await expect(tx)
        .to.emit(adapter, "AdapterPaused")
        .withArgs("Security concern");

      expect(await adapter.paused()).to.equal(true);
    });

    it("Should allow owner to unpause", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      await adapter.connect(owner).pause("Test");
      const tx = await adapter.connect(owner).unpause();

      await expect(tx).to.emit(adapter, "AdapterUnpaused");
      expect(await adapter.paused()).to.equal(false);
    });

    it("Should revert when non-owner tries to pause", async function () {
      const { adapter, attacker } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(attacker).pause("Malicious")
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });

    it("Should revert when non-owner tries to unpause", async function () {
      const { adapter, owner, attacker } = await loadFixture(
        deployAdapterFixture
      );

      await adapter.connect(owner).pause("Test");

      await expect(
        adapter.connect(attacker).unpause()
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });
  });

  describe("Risk Score Update", function () {
    it("Should allow owner to update risk score", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      const tx = await adapter.connect(owner).updateRiskScore(8);
      await expect(tx).to.emit(adapter, "RiskScoreUpdated").withArgs(5, 8);

      expect(await adapter.getRiskScore()).to.equal(8);
    });

    it("Should revert when non-owner tries to update", async function () {
      const { adapter, attacker } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(attacker).updateRiskScore(8)
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });

    it("Should revert with invalid risk score (0)", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(owner).updateRiskScore(0)
      ).to.be.revertedWithCustomError(adapter, "InvalidRiskScore");
    });

    it("Should revert with invalid risk score (>10)", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(owner).updateRiskScore(11)
      ).to.be.revertedWithCustomError(adapter, "InvalidRiskScore");
    });

    it("Should handle boundary values (1 and 10)", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      await adapter.connect(owner).updateRiskScore(1);
      expect(await adapter.getRiskScore()).to.equal(1);

      await adapter.connect(owner).updateRiskScore(10);
      expect(await adapter.getRiskScore()).to.equal(10);
    });
  });

  describe("Ownership Transfer", function () {
    it("Should allow owner to transfer ownership", async function () {
      const { adapter, owner, user1 } = await loadFixture(deployAdapterFixture);

      const tx = await adapter.connect(owner).transferOwnership(user1.address);
      await expect(tx)
        .to.emit(adapter, "OwnershipTransferred")
        .withArgs(owner.address, user1.address);

      expect(await adapter.owner()).to.equal(user1.address);
    });

    it("Should revert when non-owner tries to transfer", async function () {
      const { adapter, user1, attacker } = await loadFixture(
        deployAdapterFixture
      );

      await expect(
        adapter.connect(attacker).transferOwnership(user1.address)
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });

    it("Should revert with zero address", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(owner).transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("New owner should have full control", async function () {
      const { adapter, owner, user1 } = await loadFixture(deployAdapterFixture);

      await adapter.connect(owner).transferOwnership(user1.address);

      // New owner can pause
      await adapter.connect(user1).pause("Test");
      expect(await adapter.paused()).to.equal(true);

      // Old owner cannot
      await expect(
        adapter.connect(owner).unpause()
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });
  });

  describe("Emergency Mode", function () {
    it("Should allow owner to initiate emergency mode", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      const tx = await adapter.connect(owner).initiateEmergencyMode();
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const expectedUnlock = block.timestamp + 7 * 24 * 60 * 60;

      await expect(tx).to.emit(adapter, "EmergencyModeInitiated");
      expect(await adapter.emergencyMode()).to.equal(true);
      expect(await adapter.emergencyUnlockTime()).to.equal(expectedUnlock);
    });

    it("Should allow owner to cancel emergency mode", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);

      await adapter.connect(owner).initiateEmergencyMode();
      const tx = await adapter.connect(owner).cancelEmergencyMode();

      await expect(tx).to.emit(adapter, "EmergencyModeCancelled");
      expect(await adapter.emergencyMode()).to.equal(false);
      expect(await adapter.emergencyUnlockTime()).to.equal(0);
    });

    it("Should revert when non-owner initiates emergency", async function () {
      const { adapter, attacker } = await loadFixture(deployAdapterFixture);

      await expect(
        adapter.connect(attacker).initiateEmergencyMode()
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });

    it("Should revert when non-owner cancels emergency", async function () {
      const { adapter, owner, attacker } = await loadFixture(
        deployAdapterFixture
      );

      await adapter.connect(owner).initiateEmergencyMode();

      await expect(
        adapter.connect(attacker).cancelEmergencyMode()
      ).to.be.revertedWithCustomError(adapter, "NotOwner");
    });
  });

  describe("Emergency Withdrawal", function () {
    it("Should allow user to withdraw after emergency delay", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      // Setup: deposit funds
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      // Initiate emergency mode
      await adapter.connect(owner).initiateEmergencyMode();

      // Wait for delay
      await time.increase(7 * 24 * 60 * 60 + 1);

      // Emergency withdraw
      const tx = await adapter.connect(user1).emergencyWithdraw();
      await expect(tx).to.emit(adapter, "EmergencyWithdrawal");

      expect(await adapter.userDeposits(user1.address)).to.equal(0);
    });

    it("Should revert if emergency mode not active", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      await expect(
        adapter.connect(user1).emergencyWithdraw()
      ).to.be.revertedWithCustomError(adapter, "EmergencyModeNotActive");
    });

    it("Should revert if delay not passed", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter.connect(owner).initiateEmergencyMode();

      // Try immediately
      await expect(
        adapter.connect(user1).emergencyWithdraw()
      ).to.be.revertedWithCustomError(adapter, "EmergencyDelayNotPassed");
    });

    it("Should revert if user has no deposits", async function () {
      const { adapter, user1, owner } = await loadFixture(deployAdapterFixture);

      await adapter.connect(owner).initiateEmergencyMode();
      await time.increase(7 * 24 * 60 * 60 + 1);

      await expect(
        adapter.connect(user1).emergencyWithdraw()
      ).to.be.revertedWithCustomError(adapter, "NoDeposits");
    });

    it("Should allow multiple users to withdraw independently", async function () {
      const { adapter, router, user1, user2, owner } = await loadFixture(
        deployAdapterFixture
      );

      // Setup: both users deposit
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter
        .connect(router)
        .deposit(user2.address, ethers.parseEther("5"), "0x");

      // Emergency mode
      await adapter.connect(owner).initiateEmergencyMode();
      await time.increase(7 * 24 * 60 * 60 + 1);

      // Both can withdraw
      await adapter.connect(user1).emergencyWithdraw();
      await adapter.connect(user2).emergencyWithdraw();

      expect(await adapter.userDeposits(user1.address)).to.equal(0);
      expect(await adapter.userDeposits(user2.address)).to.equal(0);
      expect(await adapter.totalDeposits()).to.equal(0);
    });

    it("Should prevent double withdrawal", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter.connect(owner).initiateEmergencyMode();
      await time.increase(7 * 24 * 60 * 60 + 1);

      // First withdrawal
      await adapter.connect(user1).emergencyWithdraw();

      // Second attempt should fail
      await expect(
        adapter.connect(user1).emergencyWithdraw()
      ).to.be.revertedWithCustomError(adapter, "NoDeposits");
    });

    it("Should work even when adapter is paused", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter.connect(owner).pause("Emergency");
      await adapter.connect(owner).initiateEmergencyMode();
      await time.increase(7 * 24 * 60 * 60 + 1);

      // Should still work when paused
      await expect(adapter.connect(user1).emergencyWithdraw()).to.emit(
        adapter,
        "EmergencyWithdrawal"
      );
    });
  });

  describe("Access Control Edge Cases", function () {
    it("Should maintain state correctly after ownership transfer", async function () {
      const { adapter, router, user1, owner } = await loadFixture(
        deployAdapterFixture
      );

      // Deposit with old owner
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");

      // Transfer ownership
      await adapter.connect(owner).transferOwnership(user1.address);

      // New owner can manage adapter
      await adapter.connect(user1).pause("Test");

      // But deposits still tracked correctly
      expect(await adapter.userDeposits(user1.address)).to.equal(
        ethers.parseEther("10")
      );
    });

    it("Should not allow router bypass through direct calls", async function () {
      const { adapter, user1 } = await loadFixture(deployAdapterFixture);

      // All these should fail for non-router
      await expect(
        adapter.connect(user1).deposit(user1.address, 100, "0x")
      ).to.be.revertedWithCustomError(adapter, "NotRouter");

      await expect(
        adapter.connect(user1).withdraw(user1.address, 100, "0x")
      ).to.be.revertedWithCustomError(adapter, "NotRouter");

      await expect(
        adapter.connect(user1).harvest(user1.address, 0)
      ).to.be.revertedWithCustomError(adapter, "NotRouter");
    });
  });

  describe("State Consistency", function () {
    it("Should maintain accurate totalDeposits", async function () {
      const { adapter, router, user1, user2 } = await loadFixture(
        deployAdapterFixture
      );

      // Multiple deposits
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter
        .connect(router)
        .deposit(user2.address, ethers.parseEther("5"), "0x");
      expect(await adapter.totalDeposits()).to.equal(ethers.parseEther("15"));

      // Partial withdrawal
      await adapter
        .connect(router)
        .withdraw(user1.address, ethers.parseEther("3"), "0x");
      expect(await adapter.totalDeposits()).to.equal(ethers.parseEther("12"));

      // Full withdrawal
      await adapter
        .connect(router)
        .withdraw(user2.address, ethers.parseEther("5"), "0x");
      expect(await adapter.totalDeposits()).to.equal(ethers.parseEther("7"));
    });

    it("Should maintain per-user deposit tracking", async function () {
      const { adapter, router, user1 } = await loadFixture(
        deployAdapterFixture
      );

      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("10"), "0x");
      await adapter
        .connect(router)
        .deposit(user1.address, ethers.parseEther("5"), "0x");
      expect(await adapter.userDeposits(user1.address)).to.equal(
        ethers.parseEther("15")
      );

      await adapter
        .connect(router)
        .withdraw(user1.address, ethers.parseEther("7"), "0x");
      expect(await adapter.userDeposits(user1.address)).to.equal(
        ethers.parseEther("8")
      );
    });
  });
});
