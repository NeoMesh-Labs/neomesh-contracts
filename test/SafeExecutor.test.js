const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("SafeExecutor", function () {
  async function deploySafeExecutorFixture() {
    const [owner, router, signer1, signer2, signer3, user1] =
      await ethers.getSigners();

    // Deploy SafeExecutor
    const SafeExecutor = await ethers.getContractFactory("SafeExecutor");
    const safeExecutor = await SafeExecutor.deploy(router.address);

    // Deploy Mock Safe
    const MockSafe = await ethers.getContractFactory("MockSafe");
    const mockSafe = await MockSafe.deploy([
      signer1.address,
      signer2.address,
      signer3.address,
    ]);

    return {
      safeExecutor,
      mockSafe,
      owner,
      router,
      signer1,
      signer2,
      signer3,
      user1,
    };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { safeExecutor, owner } = await loadFixture(
        deploySafeExecutorFixture
      );
      expect(await safeExecutor.owner()).to.equal(owner.address);
    });

    it("Should set the correct strategy router", async function () {
      const { safeExecutor, router } = await loadFixture(
        deploySafeExecutorFixture
      );
      expect(await safeExecutor.strategyRouter()).to.equal(router.address);
    });
  });

  describe("Safe Registration", function () {
    it("Should register a Safe with valid parameters", async function () {
      const { safeExecutor, mockSafe, signer1, signer2, signer3 } =
        await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      const delay = 3600; // 1 hour

      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, delay)
      )
        .to.emit(safeExecutor, "SafeRegistered")
        .withArgs(await mockSafe.getAddress(), 2, 3);

      expect(
        await safeExecutor.registeredSafes(await mockSafe.getAddress())
      ).to.equal(true);
    });

    it("Should register a Safe without delay", async function () {
      const { safeExecutor, mockSafe, signer1, signer2, signer3 } =
        await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];

      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 0);

      const config = await safeExecutor.getSafeConfig(
        await mockSafe.getAddress()
      );
      expect(config.requireDelay).to.equal(false);
    });

    it("Should revert with zero address", async function () {
      const { safeExecutor, signer1, signer2, signer3 } = await loadFixture(
        deploySafeExecutorFixture
      );

      const signers = [signer1.address, signer2.address, signer3.address];

      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(ethers.ZeroAddress, 2, signers, 3600)
      ).to.be.revertedWithCustomError(safeExecutor, "ZeroAddress");
    });

    it("Should revert with invalid threshold (0)", async function () {
      const { safeExecutor, mockSafe, signer1, signer2, signer3 } =
        await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];

      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 0, signers, 3600)
      ).to.be.revertedWithCustomError(safeExecutor, "InvalidThreshold");
    });

    it("Should revert with threshold > signers", async function () {
      const { safeExecutor, mockSafe, signer1, signer2, signer3 } =
        await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];

      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 5, signers, 3600)
      ).to.be.revertedWithCustomError(safeExecutor, "InvalidThreshold");
    });

    it("Should revert with invalid delay", async function () {
      const { safeExecutor, mockSafe, signer1, signer2, signer3 } =
        await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];

      // Too short (< 1 hour)
      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 60)
      ).to.be.revertedWithCustomError(safeExecutor, "InvalidDelay");

      // Too long (> 7 days)
      await expect(
        safeExecutor
          .connect(signer1)
          .registerSafe(await mockSafe.getAddress(), 2, signers, 8 * 24 * 3600)
      ).to.be.revertedWithCustomError(safeExecutor, "InvalidDelay");
    });
  });

  describe("Transaction Queue", function () {
    it("Should queue a transaction", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      await expect(
        safeExecutor
          .connect(router)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            ethers.parseEther("1"),
            "0x"
          )
      ).to.emit(safeExecutor, "TransactionQueued");
    });

    it("Should revert when non-router queues", async function () {
      const { safeExecutor, mockSafe, signer1, signer2, signer3, user1 } =
        await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      await expect(
        safeExecutor
          .connect(user1)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            ethers.parseEther("1"),
            "0x"
          )
      ).to.be.revertedWithCustomError(safeExecutor, "NotRouter");
    });

    it("Should revert for unregistered Safe", async function () {
      const { safeExecutor, mockSafe, router, user1 } = await loadFixture(
        deploySafeExecutorFixture
      );

      await expect(
        safeExecutor
          .connect(router)
          .queueTransaction(
            await mockSafe.getAddress(),
            user1.address,
            ethers.parseEther("1"),
            "0x"
          )
      ).to.be.revertedWithCustomError(safeExecutor, "SafeNotRegistered");
    });
  });

  describe("Transaction Confirmation", function () {
    it("Should confirm a transaction", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      await expect(safeExecutor.connect(signer1).confirmTransaction(txHash))
        .to.emit(safeExecutor, "TransactionConfirmed")
        .withArgs(txHash, signer1.address);

      expect(await safeExecutor.isConfirmed(txHash, signer1.address)).to.equal(
        true
      );
    });

    it("Should revert when non-signer confirms", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      await expect(
        safeExecutor.connect(user1).confirmTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "NotSigner");
    });

    it("Should revert on double confirmation", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      await safeExecutor.connect(signer1).confirmTransaction(txHash);

      await expect(
        safeExecutor.connect(signer1).confirmTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "AlreadyConfirmed");
    });
  });

  describe("Transaction Execution", function () {
    it("Should execute after enough confirmations and delay", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      // Wait for delay
      await time.increase(3601);

      // Execute
      await expect(safeExecutor.executeTransaction(txHash)).to.emit(
        safeExecutor,
        "TransactionExecuted"
      );
    });

    it("Should revert if not enough confirmations", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      // Only 1 confirmation (need 2)
      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await time.increase(3601);

      await expect(
        safeExecutor.executeTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "NotEnoughConfirmations");
    });

    it("Should revert if delay not passed", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);

      // Don't wait for delay
      await expect(
        safeExecutor.executeTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "DelayNotPassed");
    });
  });

  describe("Transaction Cancellation", function () {
    it("Should cancel a transaction", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      await expect(
        safeExecutor.connect(signer1).cancelTransaction(txHash)
      ).to.emit(safeExecutor, "TransactionCancelledEvent");

      const txn = await safeExecutor.getTransaction(txHash);
      expect(txn.cancelled).to.equal(true);
    });

    it("Should not execute cancelled transaction", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      await safeExecutor.connect(signer1).cancelTransaction(txHash);

      await expect(
        safeExecutor.connect(signer1).confirmTransaction(txHash)
      ).to.be.revertedWithCustomError(safeExecutor, "TransactionCancelled");
    });
  });

  describe("View Functions", function () {
    it("Should check if transaction can execute", async function () {
      const {
        safeExecutor,
        mockSafe,
        router,
        signer1,
        signer2,
        signer3,
        user1,
      } = await loadFixture(deploySafeExecutorFixture);

      const signers = [signer1.address, signer2.address, signer3.address];
      await safeExecutor
        .connect(signer1)
        .registerSafe(await mockSafe.getAddress(), 2, signers, 3600);

      const tx = await safeExecutor
        .connect(router)
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

      // Not executable yet
      expect(await safeExecutor.canExecute(txHash)).to.equal(false);

      // Add confirmations
      await safeExecutor.connect(signer1).confirmTransaction(txHash);
      await safeExecutor.connect(signer2).confirmTransaction(txHash);

      // Still not executable (delay)
      expect(await safeExecutor.canExecute(txHash)).to.equal(false);

      // Wait for delay
      await time.increase(3601);

      // Now executable
      expect(await safeExecutor.canExecute(txHash)).to.equal(true);
    });
  });
});
