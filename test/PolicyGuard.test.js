const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PolicyGuard", function () {
  async function deployPolicyGuardFixture() {
    const [owner, user1, user2, protocol1, protocol2] =
      await ethers.getSigners();

    const PolicyGuard = await ethers.getContractFactory("PolicyGuard");
    const policyGuard = await PolicyGuard.deploy();

    return { policyGuard, owner, user1, user2, protocol1, protocol2 };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { policyGuard, owner } = await loadFixture(
        deployPolicyGuardFixture
      );
      expect(await policyGuard.owner()).to.equal(owner.address);
    });
  });

  describe("Policy Creation", function () {
    it("Should create a policy with valid parameters", async function () {
      const { policyGuard, user1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      const dailyLimit = ethers.parseEther("100");
      const maxExposure = 2000; // 20%
      const maxRisk = 7;

      await policyGuard
        .connect(user1)
        .createPolicy(dailyLimit, maxExposure, maxRisk, true);

      const policy = await policyGuard.getPolicy(user1.address);
      expect(policy.dailyLimit).to.equal(dailyLimit);
      expect(policy.maxProtocolExposure).to.equal(maxExposure);
      expect(policy.maxRiskScore).to.equal(maxRisk);
      expect(policy.requireWhitelist).to.equal(true);
      expect(policy.active).to.equal(true);
    });

    it("Should revert with zero daily limit", async function () {
      const { policyGuard, user1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await expect(
        policyGuard.connect(user1).createPolicy(0, 2000, 5, false)
      ).to.be.revertedWithCustomError(policyGuard, "InvalidDailyLimit");
    });

    it("Should revert with invalid exposure limit (>100%)", async function () {
      const { policyGuard, user1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await expect(
        policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 10001, 5, false)
      ).to.be.revertedWithCustomError(policyGuard, "InvalidExposureLimit");
    });

    it("Should revert with invalid risk score", async function () {
      const { policyGuard, user1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await expect(
        policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 2000, 0, false)
      ).to.be.revertedWithCustomError(policyGuard, "InvalidRiskScore");

      await expect(
        policyGuard
          .connect(user1)
          .createPolicy(ethers.parseEther("100"), 2000, 11, false)
      ).to.be.revertedWithCustomError(policyGuard, "InvalidRiskScore");
    });
  });

  describe("Protocol Whitelisting", function () {
    it("Should whitelist a protocol with risk score", async function () {
      const { policyGuard, owner, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard.connect(owner).whitelistProtocol(protocol1.address, 3);

      expect(
        await policyGuard.isProtocolWhitelisted(protocol1.address)
      ).to.equal(true);
      expect(
        await policyGuard.getProtocolRiskScore(protocol1.address)
      ).to.equal(3);
    });

    it("Should revert when non-owner tries to whitelist", async function () {
      const { policyGuard, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await expect(
        policyGuard.connect(user1).whitelistProtocol(protocol1.address, 3)
      ).to.be.revertedWithCustomError(policyGuard, "NotOwner");
    });

    it("Should revert with zero address", async function () {
      const { policyGuard, owner } = await loadFixture(
        deployPolicyGuardFixture
      );

      await expect(
        policyGuard.connect(owner).whitelistProtocol(ethers.ZeroAddress, 3)
      ).to.be.revertedWithCustomError(policyGuard, "ZeroAddress");
    });
  });

  describe("Transfer Validation", function () {
    it("Should validate transfer within daily limit", async function () {
      const { policyGuard, owner, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      // Setup
      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);
      await policyGuard.connect(owner).whitelistProtocol(protocol1.address, 3);

      // Validate transfer
      const tx = await policyGuard.validateTransfer(
        user1.address,
        protocol1.address,
        ethers.parseEther("50")
      );

      await expect(tx)
        .to.emit(policyGuard, "TransferValidated")
        .withArgs(user1.address, protocol1.address, ethers.parseEther("50"));
    });

    it("Should block transfer exceeding daily limit", async function () {
      const { policyGuard, owner, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);
      await policyGuard.connect(owner).whitelistProtocol(protocol1.address, 3);

      // First transfer uses 80 ETH
      await policyGuard.validateTransfer(
        user1.address,
        protocol1.address,
        ethers.parseEther("80")
      );

      // Second transfer of 30 ETH should fail (total 110 > 100 limit)
      const tx = await policyGuard.validateTransfer(
        user1.address,
        protocol1.address,
        ethers.parseEther("30")
      );

      await expect(tx).to.emit(policyGuard, "TransferBlocked");
    });

    it("Should block transfer to non-whitelisted protocol when required", async function () {
      const { policyGuard, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, true);

      const tx = await policyGuard.validateTransfer(
        user1.address,
        protocol1.address,
        ethers.parseEther("10")
      );

      await expect(tx).to.emit(policyGuard, "TransferBlocked");
    });

    it("Should block transfer to high-risk protocol", async function () {
      const { policyGuard, owner, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);
      await policyGuard.connect(owner).whitelistProtocol(protocol1.address, 8); // Risk 8 > max 5

      const tx = await policyGuard.validateTransfer(
        user1.address,
        protocol1.address,
        ethers.parseEther("10")
      );

      await expect(tx).to.emit(policyGuard, "TransferBlocked");
    });

    it("Should revert for user without active policy", async function () {
      const { policyGuard, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await expect(
        policyGuard.validateTransfer(
          user1.address,
          protocol1.address,
          ethers.parseEther("10")
        )
      ).to.be.revertedWithCustomError(policyGuard, "NoActivePolicy");
    });
  });

  describe("Emergency Pause", function () {
    it("Should pause user policy", async function () {
      const { policyGuard, owner, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);
      await policyGuard
        .connect(owner)
        .emergencyPause(user1.address, "Suspicious activity");

      const policy = await policyGuard.getPolicy(user1.address);
      expect(policy.active).to.equal(false);
    });

    it("Should block transfers after pause", async function () {
      const { policyGuard, owner, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);
      await policyGuard
        .connect(owner)
        .emergencyPause(user1.address, "Suspicious activity");

      await expect(
        policyGuard.validateTransfer(
          user1.address,
          protocol1.address,
          ethers.parseEther("10")
        )
      ).to.be.revertedWithCustomError(policyGuard, "NoActivePolicy");
    });
  });

  describe("View Functions", function () {
    it("Should return remaining daily limit", async function () {
      const { policyGuard, owner, user1, protocol1 } = await loadFixture(
        deployPolicyGuardFixture
      );

      await policyGuard
        .connect(user1)
        .createPolicy(ethers.parseEther("100"), 5000, 5, false);
      await policyGuard.connect(owner).whitelistProtocol(protocol1.address, 3);

      // Spend 40 ETH
      await policyGuard.validateTransfer(
        user1.address,
        protocol1.address,
        ethers.parseEther("40")
      );

      const remaining = await policyGuard.getRemainingDailyLimit(user1.address);
      expect(remaining).to.equal(ethers.parseEther("60"));
    });
  });
});
