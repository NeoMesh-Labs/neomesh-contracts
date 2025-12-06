const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("StrategyRouter", function () {
  async function deployStrategyRouterFixture() {
    const [owner, user1, user2, attacker] = await ethers.getSigners();

    // Deploy PolicyGuard first
    const PolicyGuard = await ethers.getContractFactory("PolicyGuard");
    const policyGuard = await PolicyGuard.deploy();

    // Deploy StrategyRouter
    const StrategyRouter = await ethers.getContractFactory("StrategyRouter");
    const strategyRouter = await StrategyRouter.deploy(
      await policyGuard.getAddress()
    );

    // Deploy mock adapters
    const MockAdapter = await ethers.getContractFactory("MockAdapter");
    const adapter1 = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Aave",
      3,
      800 // 8% APY
    );
    const adapter2 = await MockAdapter.deploy(
      await strategyRouter.getAddress(),
      "Compound",
      5,
      600 // 6% APY
    );

    return {
      strategyRouter,
      policyGuard,
      adapter1,
      adapter2,
      owner,
      user1,
      user2,
      attacker,
    };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { strategyRouter, owner } = await loadFixture(
        deployStrategyRouterFixture
      );
      expect(await strategyRouter.owner()).to.equal(owner.address);
    });

    it("Should set the correct PolicyGuard", async function () {
      const { strategyRouter, policyGuard } = await loadFixture(
        deployStrategyRouterFixture
      );
      expect(await strategyRouter.policyGuard()).to.equal(
        await policyGuard.getAddress()
      );
    });
  });

  describe("Intent Creation", function () {
    it("Should create an intent with valid parameters", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

      const tx = await strategyRouter.connect(user1).createIntent(
        800, // 8% target APY
        5, // Medium risk
        ethers.parseEther("1"), // 1 ETH liquidity reserve
        ethers.parseEther("0.01") // Max 0.01 ETH gas
      );

      await expect(tx).to.emit(strategyRouter, "IntentCreated");
    });

    it("Should revert with invalid risk level (0)", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

      await expect(
        strategyRouter
          .connect(user1)
          .createIntent(
            800,
            0,
            ethers.parseEther("1"),
            ethers.parseEther("0.01")
          )
      ).to.be.revertedWithCustomError(strategyRouter, "InvalidRiskLevel");
    });

    it("Should revert with invalid risk level (>10)", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

      await expect(
        strategyRouter
          .connect(user1)
          .createIntent(
            800,
            11,
            ethers.parseEther("1"),
            ethers.parseEther("0.01")
          )
      ).to.be.revertedWithCustomError(strategyRouter, "InvalidRiskLevel");
    });

    it("Should revert with unrealistic APY (>50%)", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

      await expect(
        strategyRouter
          .connect(user1)
          .createIntent(
            5001,
            5,
            ethers.parseEther("1"),
            ethers.parseEther("0.01")
          )
      ).to.be.revertedWithCustomError(strategyRouter, "UnrealisticAPY");
    });

    it("Should store intent correctly", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

      const tx = await strategyRouter
        .connect(user1)
        .createIntent(
          800,
          5,
          ethers.parseEther("1"),
          ethers.parseEther("0.01")
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

      const parsedEvent = strategyRouter.interface.parseLog(event);
      const intentId = parsedEvent.args.intentId;

      const intent = await strategyRouter.getIntent(intentId);
      expect(intent.user).to.equal(user1.address);
      expect(intent.targetAPY).to.equal(800);
      expect(intent.maxRisk).to.equal(5);
      expect(intent.active).to.equal(true);
    });
  });

  describe("Intent Updates", function () {
    it("Should update existing intent", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

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

      // Update intent
      await strategyRouter
        .connect(user1)
        .updateIntent(
          intentId,
          1000,
          7,
          ethers.parseEther("2"),
          ethers.parseEther("0.2")
        );

      const intent = await strategyRouter.getIntent(intentId);
      expect(intent.targetAPY).to.equal(1000);
      expect(intent.maxRisk).to.equal(7);
    });

    it("Should not allow non-owner to update intent", async function () {
      const { strategyRouter, user1, attacker } = await loadFixture(
        deployStrategyRouterFixture
      );

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

      await expect(
        strategyRouter
          .connect(attacker)
          .updateIntent(
            intentId,
            1000,
            7,
            ethers.parseEther("2"),
            ethers.parseEther("0.2")
          )
      ).to.be.revertedWithCustomError(strategyRouter, "NotIntentOwner");
    });

    it("Should deactivate intent", async function () {
      const { strategyRouter, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

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

      await strategyRouter.connect(user1).deactivateIntent(intentId);

      const intent = await strategyRouter.getIntent(intentId);
      expect(intent.active).to.equal(false);
    });
  });

  describe("Adapter Registration", function () {
    it("Should register an adapter", async function () {
      const { strategyRouter, adapter1, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await expect(
        strategyRouter
          .connect(owner)
          .registerAdapter(await adapter1.getAddress(), "Aave")
      )
        .to.emit(strategyRouter, "AdapterRegistered")
        .withArgs(await adapter1.getAddress(), "Aave");

      expect(
        await strategyRouter.registeredAdapters(await adapter1.getAddress())
      ).to.equal(true);
    });

    it("Should revert when non-owner tries to register", async function () {
      const { strategyRouter, adapter1, user1 } = await loadFixture(
        deployStrategyRouterFixture
      );

      await expect(
        strategyRouter
          .connect(user1)
          .registerAdapter(await adapter1.getAddress(), "Aave")
      ).to.be.revertedWithCustomError(strategyRouter, "NotOwner");
    });

    it("Should revert with zero address", async function () {
      const { strategyRouter, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await expect(
        strategyRouter
          .connect(owner)
          .registerAdapter(ethers.ZeroAddress, "Test")
      ).to.be.revertedWithCustomError(strategyRouter, "ZeroAddress");
    });

    it("Should revert when adapter already registered", async function () {
      const { strategyRouter, adapter1, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");

      await expect(
        strategyRouter
          .connect(owner)
          .registerAdapter(await adapter1.getAddress(), "Aave")
      ).to.be.revertedWithCustomError(strategyRouter, "AlreadyRegistered");
    });
  });

  describe("Adapter Removal Safety", function () {
    it("Should not allow removing adapter with TVL > 0", async function () {
      const { strategyRouter, adapter1, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");

      // Set mock TVL > 0
      await adapter1.setMockTVL(ethers.parseEther("100"));

      await expect(
        strategyRouter.connect(owner).removeAdapter(await adapter1.getAddress())
      ).to.be.revertedWithCustomError(strategyRouter, "AdapterHasFunds");
    });

    it("Should allow removing adapter with TVL = 0", async function () {
      const { strategyRouter, adapter1, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");

      // Set TVL to 0
      await adapter1.setMockTVL(0);

      await expect(
        strategyRouter.connect(owner).removeAdapter(await adapter1.getAddress())
      ).to.emit(strategyRouter, "AdapterRemoved");

      expect(
        await strategyRouter.isAdapterRegistered(await adapter1.getAddress())
      ).to.equal(false);
    });
  });

  describe("View Functions", function () {
    it("Should return all adapters", async function () {
      const { strategyRouter, adapter1, adapter2, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter2.getAddress(), "Compound");

      const adapters = await strategyRouter.getAdapters();
      expect(adapters.length).to.equal(2);
      expect(adapters[0]).to.equal(await adapter1.getAddress());
      expect(adapters[1]).to.equal(await adapter2.getAddress());
    });

    it("Should return adapter count", async function () {
      const { strategyRouter, adapter1, adapter2, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      expect(await strategyRouter.getAdapterCount()).to.equal(0);

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");
      expect(await strategyRouter.getAdapterCount()).to.equal(1);

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter2.getAddress(), "Compound");
      expect(await strategyRouter.getAdapterCount()).to.equal(2);
    });
  });

  describe("Optimal Route", function () {
    it("Should find optimal route based on APY and risk", async function () {
      const { strategyRouter, adapter1, adapter2, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter2.getAddress(), "Compound");

      // adapter1: 8% APY, risk 3
      // adapter2: 6% APY, risk 5
      const [bestAdapter, expectedAPY] = await strategyRouter.getOptimalRoute(
        ethers.ZeroHash,
        500,
        5
      );

      expect(bestAdapter).to.equal(await adapter1.getAddress());
      expect(expectedAPY).to.equal(800);
    });

    it("Should return zero address if no adapter meets criteria", async function () {
      const { strategyRouter, adapter1, adapter2, owner } = await loadFixture(
        deployStrategyRouterFixture
      );

      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter1.getAddress(), "Aave");
      await strategyRouter
        .connect(owner)
        .registerAdapter(await adapter2.getAddress(), "Compound");

      const [bestAdapter, expectedAPY] = await strategyRouter.getOptimalRoute(
        ethers.ZeroHash,
        2000,
        5
      );

      expect(bestAdapter).to.equal(ethers.ZeroAddress);
      expect(expectedAPY).to.equal(0);
    });
  });
});
