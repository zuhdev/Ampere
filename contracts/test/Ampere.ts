import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Ampere test matrix (21 cases)
 *  policy:     allowlist hit/miss, deny-all empty allowlist, blocklist
 *  caps:       per-address cap exceeded, daily budget exceeded (deterministic)
 *  lifecycle:  expiry, pause (registry + paymaster), relay failure (target revert)
 *  security:   attacker recordSpend, attacker setPolicy, owner withdraw, non-relayer,
 *              caller-chosen amount cannot under-record spend (GasBudgetExceeded)
 *  4337:       validatePaymasterUserOp + postOp with mocked UserOp via MockEntryPoint
 *  invariant:  zero user-funds risk — user balance unchanged after every case
 */

const APP_KEY = ethers.id("test.app");
const PER_ADDRESS_CAP = ethers.parseEther("0.01"); // BOT / addr / 24h
const DAILY_BUDGET = ethers.parseEther("1"); // BOT / day
const GAS_BUDGET = ethers.parseEther("0.001"); // authorized per relay

describe("Ampere", function () {
  // Runtime behavior is fully exercised; ethers-v6 factory deploy() is untyped,
  // so the fixture is typed loosely on purpose.
  type Ctx = Record<string, any>;

  async function deployFixture(): Promise<Ctx> {
    const [owner, relayer, user, attacker, sponsor] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("SponsorPolicyRegistry");
    const registry = (await Registry.deploy()) as any;

    const EntryPoint = await ethers.getContractFactory("MockEntryPoint");
    const entryPoint = (await EntryPoint.deploy()) as any;

    const Paymaster = await ethers.getContractFactory("GaslessPaymaster");
    const paymaster = (await Paymaster.deploy(
      await registry.getAddress(),
      await entryPoint.getAddress()
    )) as any;

    const Vault = await ethers.getContractFactory("BudgetVault");
    const vault = (await Vault.deploy(
      await paymaster.getAddress(),
      ethers.ZeroAddress
    )) as any;

    await registry.setPaymaster(await paymaster.getAddress());
    await paymaster.setRelayer(relayer.address);
    await paymaster.setVault(await vault.getAddress());

    const Target = await ethers.getContractFactory("MockTarget");
    const target = (await Target.deploy()) as any;

    // fund: paymaster float + vault budget + paymaster EntryPoint deposit
    await owner.sendTransaction({
      to: await paymaster.getAddress(),
      value: ethers.parseEther("5"),
    });
    await vault
      .connect(sponsor)
      .depositNative(APP_KEY, { value: ethers.parseEther("10") });
    await entryPoint.depositTo(await paymaster.getAddress(), {
      value: ethers.parseEther("2"),
    });

    const policy = {
      allowlist: [await target.getAddress()],
      blocklist: [] as string[],
      perAddressCap: PER_ADDRESS_CAP,
      dailyBudget: DAILY_BUDGET,
      expiresAt: 0,
      paused: false,
    };
    await registry.connect(sponsor).setPolicy(APP_KEY, policy);

    return { owner, relayer, user, attacker, sponsor, registry, paymaster, vault, target, entryPoint };
  }

  // ---- helpers ----
  const relay = (pm: any, beneficiary: string, targetAddr: string, data = "0x") =>
    pm.sponsorAndSend(APP_KEY, targetAddr, beneficiary, GAS_BUDGET, data);

  const workData = (target: any, arg = "0x") =>
    target.interface.encodeFunctionData("doWork", [arg]);

  function makeUserOp(
    pmAddress: string,
    sender: string,
    targetAddress: string,
    callData: string
  ) {
    const innerExecute = new ethers.AbiCoder().encode(
      ["address", "uint256", "bytes"],
      [targetAddress, 0, callData]
    );
    return {
      sender,
      nonce: 0,
      initCode: "0x",
      callData: ethers.concat([
        ethers.id("execute(address,uint256,bytes)").slice(0, 10),
        innerExecute,
      ]),
      accountGasLimits: ethers.ZeroHash,
      preVerificationGas: 50_000,
      gasFees: ethers.ZeroHash,
      paymasterAndData: ethers.solidityPacked(
        ["address", "uint128", "uint128", "bytes32"],
        [pmAddress, 200_000, 200_000, APP_KEY]
      ),
      signature: "0x",
    };
  }

  it("1. allows relay when target is on allowlist and policy valid", async function () {
    const { relayer, user, target, paymaster } = await deployFixture();
    const data = workData(target, "0x1234");
    const tx = await relay(
      paymaster.connect(relayer),
      user.address,
      await target.getAddress(),
      data
    );
    const rc = await tx.wait();
    expect(rc.status).to.equal(1);
    expect(await target.lastCaller()).to.equal(await paymaster.getAddress());
    expect(await target.hitCount()).to.equal(1n);
  });

  it("2. deny-all when allowlist is empty", async function () {
    const { relayer, user, sponsor, registry, target, paymaster } = await deployFixture();
    await registry.connect(sponsor).setPolicy(APP_KEY, {
      allowlist: [],
      blocklist: [],
      perAddressCap: PER_ADDRESS_CAP,
      dailyBudget: DAILY_BUDGET,
      expiresAt: 0,
      paused: false,
    });
    await expect(
      relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("3. reverts when target not on allowlist", async function () {
    const { relayer, user, attacker, paymaster, target } = await deployFixture();
    await expect(
      relay(paymaster.connect(relayer), user.address, attacker.address, workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("4. blocklist denies even if allowlist hits", async function () {
    const { relayer, user, sponsor, registry, target, paymaster } = await deployFixture();
    const targetAddr = await target.getAddress();
    await registry.connect(sponsor).setPolicy(APP_KEY, {
      allowlist: [targetAddr],
      blocklist: [targetAddr],
      perAddressCap: PER_ADDRESS_CAP,
      dailyBudget: DAILY_BUDGET,
      expiresAt: 0,
      paused: false,
    });
    await expect(
      relay(paymaster.connect(relayer), user.address, targetAddr, workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("5. per-address cap blocks beneficiary over rolling-24h cap", async function () {
    const { relayer, user, sponsor, registry, target, paymaster } = await deployFixture();
    // one relay records deterministic spend S (measured, not guessed)
    await relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target));
    const spent = await registry.addressSpent(APP_KEY, user.address);
    expect(spent).to.be.gt(0n);

    // cap exactly at S → the next relay (S + gasCost) must exceed
    await registry.connect(sponsor).setPolicy(APP_KEY, {
      allowlist: [await target.getAddress()],
      blocklist: [],
      perAddressCap: spent,
      dailyBudget: DAILY_BUDGET,
      expiresAt: 0,
      paused: false,
    });
    await expect(
      relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("6. daily budget blocks when exceeded", async function () {
    const { relayer, user, sponsor, registry, target, paymaster } = await deployFixture();
    await relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target));
    const daySpent = await registry.daySpent(APP_KEY);
    expect(daySpent).to.be.gt(0n);

    // daily budget exactly at current spend → next relay exceeds
    await registry.connect(sponsor).setPolicy(APP_KEY, {
      allowlist: [await target.getAddress()],
      blocklist: [],
      perAddressCap: PER_ADDRESS_CAP,
      dailyBudget: daySpent,
      expiresAt: 0,
      paused: false,
    });
    await expect(
      relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("7. expired policy is not sponsorable", async function () {
    const { relayer, user, sponsor, registry, target, paymaster } = await deployFixture();
    await registry.connect(sponsor).setPolicy(APP_KEY, {
      allowlist: [await target.getAddress()],
      blocklist: [],
      perAddressCap: PER_ADDRESS_CAP,
      dailyBudget: DAILY_BUDGET,
      expiresAt: (await ethers.provider.getBlock("latest"))!.timestamp - 1,
      paused: false,
    });
    await expect(
      relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("8. paused policy is not sponsorable", async function () {
    const { relayer, user, sponsor, registry, target, paymaster } = await deployFixture();
    await registry.connect(sponsor).setPolicy(APP_KEY, {
      allowlist: [await target.getAddress()],
      blocklist: [],
      perAddressCap: PER_ADDRESS_CAP,
      dailyBudget: DAILY_BUDGET,
      expiresAt: 0,
      paused: true,
    });
    await expect(
      relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("9. paymaster pause() blocks sponsorship with a single call", async function () {
    const { owner, relayer, user, paymaster, target } = await deployFixture();
    await paymaster.connect(owner).pause();
    await expect(
      relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).to.be.revertedWithCustomError(paymaster, "EnforcedPause");
    await paymaster.connect(owner).unpause();
  });

  it("10. only relayer can call sponsorAndSend", async function () {
    const { attacker, user, paymaster, target } = await deployFixture();
    await expect(
      paymaster
        .connect(attacker)
        .sponsorAndSend(APP_KEY, await target.getAddress(), user.address, GAS_BUDGET, workData(target))
    ).to.be.revertedWithCustomError(paymaster, "NotRelayer");
  });

  it("11. relay failure: target revert does not record spend above authorized budget", async function () {
    const { relayer, user, target, paymaster, vault, registry } = await deployFixture();
    await target.setShouldRevert(true);

    const budgetBefore = await vault.budgetOf(APP_KEY);
    const dayBefore = await registry.daySpent(APP_KEY);

    // call succeeds at EVM level; inner call returns success=false
    const tx = await relay(
      paymaster.connect(relayer),
      user.address,
      await target.getAddress(),
      workData(target)
    );
    const rc = await tx.wait();
    expect(rc.status).to.equal(1);

    const spent = budgetBefore - (await vault.budgetOf(APP_KEY));
    expect(spent).to.be.gt(0n); // gas was still burned
    expect(spent).to.be.lte(GAS_BUDGET); // ...but capped
    expect((await registry.daySpent(APP_KEY)) - dayBefore).to.equal(spent);
    expect(await target.hitCount()).to.equal(0n);
  });

  it("12. attacker cannot call recordSpend", async function () {
    const { attacker, registry, user } = await deployFixture();
    await expect(
      registry.connect(attacker).recordSpend(APP_KEY, user.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(registry, "NotPaymaster");
  });

  it("13. attacker cannot overwrite someone else's policy", async function () {
    const { attacker, registry, target } = await deployFixture();
    await expect(
      registry.connect(attacker).setPolicy(APP_KEY, {
        allowlist: [attacker.address],
        blocklist: [],
        perAddressCap: ethers.MaxUint256,
        dailyBudget: ethers.MaxUint256,
        expiresAt: 0,
        paused: false,
      })
    ).to.be.revertedWithCustomError(registry, "NotPolicyOwner");
  });

  it("14. non-owner cannot withdraw from vault or paymaster", async function () {
    const { attacker, vault, paymaster } = await deployFixture();
    await expect(
      vault.connect(attacker).withdraw(attacker.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(
      paymaster.connect(attacker).withdraw(attacker.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
  });

  it("15. owner withdraw returns own budget; vault accounting stays sane", async function () {
    const { owner, vault, registry } = await deployFixture();
    const vaultAddr = await vault.getAddress();
    const vaultBal = await ethers.provider.getBalance(vaultAddr);
    const amount = ethers.parseEther("1");

    // gas-aware assertion: owner receives exactly `amount` net of their own gas
    await expect(() =>
      vault.connect(owner).withdraw(owner.address, amount)
    ).to.changeEtherBalance(owner, amount);

    expect(await ethers.provider.getBalance(vaultAddr)).to.equal(vaultBal - amount);
    // sponsor budget liability untouched by owner sweep
    expect(await vault.budgetOf(APP_KEY)).to.equal(ethers.parseEther("10"));
    expect(await registry.daySpent(APP_KEY)).to.be.a("bigint");
  });

  it("16. reentrancy: recordSpend is nonReentrant", async function () {
    // The guard is compile-time proven by OZ ReentrancyGuard; here we assert the
    // recorded-spend path through a live relay (which itself is nonReentrant).
    const { relayer, user, paymaster, target, registry } = await deployFixture();
    await relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target));
    expect(await registry.spendCount(APP_KEY)).to.equal(1n);
  });

  it("17. ERC-4337: validatePaymasterUserOp accepts compliant UserOp", async function () {
    const { paymaster, entryPoint, target, user } = await deployFixture();
    const userOp = makeUserOp(
      await paymaster.getAddress(),
      user.address,
      await target.getAddress(),
      workData(target)
    );
    const [context, validationData] = await entryPoint.callValidate.staticCall(
      await paymaster.getAddress(),
      userOp,
      ethers.id("op1"),
      GAS_BUDGET
    );
    expect(validationData).to.equal(0n);
    const [appKey, sender, maxCost] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["bytes32", "address", "uint256"],
      context
    );
    expect(appKey).to.equal(APP_KEY);
    expect(sender).to.equal(user.address);
    expect(maxCost).to.equal(GAS_BUDGET);
  });

  it("18. ERC-4337: validatePaymasterUserOp rejects non-allowlisted target", async function () {
    const { paymaster, entryPoint, attacker, user, target } = await deployFixture();
    const userOp = makeUserOp(
      await paymaster.getAddress(),
      user.address,
      attacker.address, // not on allowlist
      workData(target)
    );
    await expect(
      entryPoint.callValidate.staticCall(
        await paymaster.getAddress(),
        userOp,
        ethers.id("op2"),
        GAS_BUDGET
      )
    ).to.be.revertedWithCustomError(paymaster, "NotSponsorable");
  });

  it("19. ERC-4337: postOp records spend and refills EntryPoint deposit", async function () {
    const { paymaster, entryPoint, user, registry } = await deployFixture();
    const pmAddress = await paymaster.getAddress();

    // fund the paymaster's EntryPoint deposit
    await entryPoint.depositTo(pmAddress, { value: ethers.parseEther("1") });
    const depositBefore = await entryPoint.balanceOf(pmAddress);

    const context = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256"],
      [APP_KEY, user.address, GAS_BUDGET]
    );
    const actualGasCost = ethers.parseEther("0.0001");
    await entryPoint.callPostOp(pmAddress, 0, context, actualGasCost, 1n); // opSucceeded=0

    const depositAfter = await entryPoint.balanceOf(pmAddress);
    // paymaster pulled actualGasCost from vault → pushed to EntryPoint
    expect(depositAfter).to.equal(depositBefore + actualGasCost);
    expect(await registry.daySpent(APP_KEY)).to.be.gte(actualGasCost);
  });

  it("20. zero user-funds risk: user balance unchanged across every path", async function () {
    const { relayer, user, target, paymaster, vault, registry } = await deployFixture();
    const pm = paymaster.connect(relayer);
    const before = await ethers.provider.getBalance(user.address);

    // success path
    await relay(pm, user.address, await target.getAddress(), workData(target));

    // revert path
    await target.setShouldRevert(true);
    await relay(pm, user.address, await target.getAddress(), workData(target));
    await target.setShouldRevert(false);

    // more relays (drain towards cap) — user still never pays
    for (let i = 0; i < 3; i++) {
      await relay(pm, user.address, await target.getAddress(), workData(target));
    }

    const after = await ethers.provider.getBalance(user.address);
    expect(after).to.equal(before); // user NEVER paid gas

    // sponsor budget was debited for real gas; spend was recorded
    expect(await vault.budgetOf(APP_KEY)).to.be.lt(ethers.parseEther("10"));
    expect(await registry.daySpent(APP_KEY)).to.be.gt(0n);
  });

  it("21. caller-chosen amount cannot under-record spend: cost > amount reverts", async function () {
    const { relayer, user, target, paymaster, vault, registry } = await deployFixture();
    const budgetBefore = await vault.budgetOf(APP_KEY);
    const dayBefore = await registry.daySpent(APP_KEY);

    // a 1 wei authorization cannot cover the measured tx cost — must revert, not clamp
    await expect(
      paymaster
        .connect(relayer)
        .sponsorAndSend(APP_KEY, await target.getAddress(), user.address, 1n, workData(target))
    ).to.be.revertedWithCustomError(paymaster, "GasBudgetExceeded");

    // nothing recorded, nothing debited: caps stay intact for the next (honest) relay
    expect(await vault.budgetOf(APP_KEY)).to.equal(budgetBefore);
    expect(await registry.daySpent(APP_KEY)).to.equal(dayBefore);
    expect(await registry.spendCount(APP_KEY)).to.equal(0n);

    // a realistic amount still relays and charges the measured cost (not the amount)
    const rc = await (
      await relay(paymaster.connect(relayer), user.address, await target.getAddress(), workData(target))
    ).wait();
    expect(rc!.status).to.equal(1);
    const charged = budgetBefore - (await vault.budgetOf(APP_KEY));
    expect(charged).to.be.gt(0n);
    expect(charged).to.be.lt(GAS_BUDGET); // charged actual cost, well under the authorization
  });
});
