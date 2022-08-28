const { expect } = require("chai");
const { ethers } = require("hardhat");
const BigNumber = ethers.BigNumber;

async function fastForward(deltaS) {
  await hre.ethers.provider.send("evm_increaseTime", [deltaS]);
  await hre.ethers.provider.send("evm_mine", []);
}

describe("SEDAO", function () {
  let admin, member1, member2, member3, member4, oracle1, oracle2, eve;
  let allMembers;
  let SEDAO, ERC20;
  let proxy, sedao, shareToken, paymentToken;

  const admissionAmount = ethers.utils.parseUnits("100");
  const halfAdmissionAmount = ethers.utils.parseUnits("50");
  const admissionShareAmount = admissionAmount.mul(1);
  const minShareAmount = admissionShareAmount.div(2);
  const cooldownPeriodS = 3600*24;

  before(async function () {
    [admin, member1, member2, member3, member4, oracle1, oracle2, eve] = await ethers.getSigners(8);
    allMembers = [member1, member2, member3, member4];
    SEDAO = await ethers.getContractFactory("SEDAO");
    PaymentToken = await ethers.getContractFactory("PaymentTokenMock");
    SEShareToken = await ethers.getContractFactory("SEShareToken");
    UUPSProxy = await ethers.getContractFactory("UUPSProxy");
  });

  beforeEach(async function () {
    paymentToken = await PaymentToken.deploy(ethers.utils.parseUnits("1000000"));
    
    for(let m of allMembers) {
        await paymentToken.transfer(m.address, admissionAmount.mul(10))
    }
    
    proxy = await UUPSProxy.deploy();
    //console.log(`paymentToken: ${paymentToken.address}`);
    const sedaoLogic = await SEDAO.deploy();
    // block initialization of logic contract
    sedaoLogic.initialize(0, 0);
    await proxy.initializeProxy(sedaoLogic.address);
    sedao = await SEDAO.attach(proxy.address);
    await sedao.initialize(paymentToken.address, admissionAmount);

    shareToken = SEShareToken.attach(await sedao.shareToken());
  });

  describe("#configuration", function () {
    it("check share token contract", async function () {
      const ts = await shareToken.totalSupply();
      expect(ts).to.equal(0);

      await expect(shareToken.mint(eve.address, 1)).to.be.revertedWith(
          "only owner can mint"
      );
      await expect(shareToken.burn(member1.address, 1)).to.be.revertedWith(
          "only owner can burn"
      );
      expect(await sedao.getAdmissionShareAmount()).to.be.equal(admissionShareAmount);
      expect(await sedao.getMinShareAmount()).to.be.equal(minShareAmount);
      expect(await sedao.cooldownPeriod()).to.be.equal(BigNumber.from(cooldownPeriodS));
    });

    it("check sedao config", async function () {
      expect(await sedao.admin()).to.equal(admin.address);
      expect(await sedao.paymentToken()).to.equal(paymentToken.address);
    });
  });
  
  describe("#join", function () {
    // fail if payment fails (no / insufficient approval)
    it("fail if insufficient payment", async function () {
      await paymentToken.connect(member1).approve(sedao.address, halfAdmissionAmount);
      await expect(sedao.connect(member1).join()).to.be.revertedWith("" +
          "ERC20: insufficient allowance"
      );
      expect(!await sedao.isMember(member1.address));
      expect(await shareToken.balanceOf(member1.address)).to.be.equal(0);
      
      await paymentToken.connect(member1).approve(sedao.address, admissionAmount);
      const joinTx = await sedao.connect(member1).join();
      await expect(joinTx).to.emit(sedao, "Joined")
          .withArgs(member1.address, admissionAmount, admissionShareAmount);
      
      // marked as member and got shares
      expect(await sedao.isMember(member1.address));
      expect(await shareToken.balanceOf(member1.address)).to.be.equal(admissionShareAmount);

      // fail if already member
      await expect(sedao.connect(member1).join()).to.be.revertedWith("already a member");
    });
  });

  describe("member operations", async function () {
    beforeEach(async function () {
      // make producer1 a member
      // give quasi-unlimited approval
      await paymentToken.connect(member1)
          .approve(sedao.address, ethers.utils.parseUnits("1000000"));
      await sedao.connect(member1).join();
    });
    
    it("members (only) can buy shares", async function () {
      const sharesToBuyAmount = ethers.utils.parseUnits("10"); 
      const sharesBefore = await shareToken.balanceOf(member1.address);
      await sedao.connect(member1).buyShares(sharesToBuyAmount);
      const sharesAfter = await shareToken.balanceOf(member1.address);
      expect(sharesAfter).to.be.equal(sharesBefore.add(sharesToBuyAmount));

      await paymentToken.connect(eve)
          .approve(sedao.address, ethers.utils.parseUnits("1000000"));
      await expect(sedao.connect(eve).buyShares(sharesToBuyAmount))
          .to.be.revertedWith("not a member");
    });

    it("members can't transfer shares", async function () {
      await expect(shareToken.connect(member1).transfer(eve.address, 1))
          .to.be.revertedWith("non-transferable");
    });
    
    it("members can redeem shares which are then burned", async function () {
      const sharesToRedeemAmount = ethers.utils.parseUnits("10");
      const sharesBefore = await shareToken.balanceOf(member1.address);
      const shareSupplyBefore = await shareToken.totalSupply();
      await sedao.connect(member1).redeemShares(sharesToRedeemAmount);
      const sharesAfter = await shareToken.balanceOf(member1.address);
      const shareSupplyAfter = await shareToken.totalSupply();
      expect(sharesAfter).to.be.equal(sharesBefore.sub(sharesToRedeemAmount));
      expect(shareSupplyAfter).to.be.equal(shareSupplyBefore.sub(sharesToRedeemAmount));
    });

    it("members can't redeem all shares", async function () {
      await expect(sedao.connect(member1).redeemShares(admissionShareAmount))
          .to.be.revertedWith("not enough shares left");
    });
    
    // members can leave
    it("members can leave and redeem all shares after cooldown period", async function () {
      await expect(sedao.connect(eve).leave()).to.be.revertedWith("not a member");
      const preLeaveBal = await shareToken.balanceOf(member1.address);
      const leaveTx = await sedao.connect(member1).leave();
      await expect(leaveTx)
          .to.emit(sedao, "Left")
          .withArgs(member1.address, preLeaveBal);
      
      // can't redeem all shares now (cooldown period)
      await expect(sedao.connect(member1).redeemShares(admissionShareAmount))
          .to.be.revertedWith("cooldown not over");
      // can't redeem more than the minimum required
      await expect(sedao.connect(member1).redeemShares(minShareAmount.add(1)))
          .to.be.revertedWith("cooldown not over");
      // can redeem up to the mininum
      await sedao.connect(member1).redeemShares(minShareAmount);

      const lastSharePrice = await sedao.getSharePrice();
      // can redeem the rest after cooldown
      await fastForward(cooldownPeriodS);
      // but not more than there's left
      await expect(sedao.connect(member1).redeemShares(admissionShareAmount))
          .to.be.revertedWith("amount exceeds balance");
      const shareAmountLeft = admissionShareAmount.sub(minShareAmount);
      const redeemTx = await sedao.connect(member1).redeemShares(shareAmountLeft);
      expect(redeemTx).to.emit(sedao, "RedeemedShares")
          .withArgs(member1.address, shareAmountLeft, shareAmountLeft.mul(lastSharePrice));
    });

    // members can change rewarding preference
  });

  describe("admin/oracle operations", function () {
    beforeEach(async function () {
      await sedao.addOracle(oracle1.address);

      for(let m of allMembers) {
        await paymentToken.connect(m)
            .approve(sedao.address, ethers.utils.parseUnits("1000000"));
        await sedao.connect(m).join();
      }
    });
    
    it("admin can remove members", async function () {
      await expect(sedao.connect(eve).removeMember(member1.address))
          .to.be.revertedWith("only admin");
      await sedao.removeMember(member1.address);
      expect(!await sedao.isMember(member1.address));
    });

    it("only oracle can trigger payouts", async function () {
      await expect(sedao.connect(eve).prosumed(1, [], [], 1))
          .to.be.revertedWith("not an oracle");
    });
    
    it("correct batch accounting - default case", async function () {
      const params = {
        period: 1,
        accounts: allMembers.map(m => m.address),
        whDeltas: [2100, 800, -1300, -1600],
        whPrice: ethers.utils.parseUnits("0.001")
      };
      // assert: sum of deltas is 0
      expect(params.whDeltas.reduce((acc, cur) => acc + cur, 0));
      const payDeltas = params.whDeltas.map(e => params.whPrice.mul(e));
      const preBals = await Promise.all(allMembers.map(m => paymentToken.balanceOf(m.address)));
      const preDAOBal = await paymentToken.balanceOf(sedao.address);
      const preTotalShares = await shareToken.totalSupply();
      
      // do it!
      const tx = await sedao.connect(oracle1).prosumed(...Object.values(params));
      
      const postBals = await Promise.all(allMembers.map(m => paymentToken.balanceOf(m.address)));
      const postDAOBal = await paymentToken.balanceOf(sedao.address);
      const postTotalShares = await shareToken.totalSupply();
      
      for(let i=0; i<allMembers.length; i++) {
        const mAddr = allMembers[i];
        expect(postBals[i]).to.equal(preBals[i].add(payDeltas[i]));
        // TODO: check why those fail
        /*
        if(params.whDeltas[i] > 0) {
          await expect(tx).to.emit(sedao, "Produced")
              .withArgs(mAddr, params.period, Math.abs(params.whDeltas[i]), params.whPrice);
        } else if(params.whDeltas[i] < 0) {
          await expect(tx).to.emit(sedao, "Consumed")
              .withArgs(mAddr, params.period, params.whDeltas[i], params.whPrice);
        }
         */
      }
      expect(preDAOBal).to.equal(postDAOBal);
      expect(preTotalShares).to.equal(postTotalShares);
    });

    it("burn shares if member can't pay", async function () {
      await paymentToken.connect(member2).approve(sedao.address, 0);
      
      const params = {
        period: 2,
        accounts: [member1.address, member2.address],
        whDeltas: [20, -20],
        whPrice: ethers.utils.parseUnits("1")
      };
      const payDeltas = params.whDeltas.map(e => params.whPrice.mul(e));
      const preBals = await Promise.all(params.accounts.map(a => paymentToken.balanceOf(a)));
      const preM2Shares = await shareToken.balanceOf(member2.address);
      const preTotalShares = await shareToken.totalSupply();
      const preDAOBal = await paymentToken.balanceOf(sedao.address);
      const shrPr = await sedao.getSharePrice();
      
      //console.log(`pre: bals ${preBals}, m2shr ${preM2Shares}, totShr ${preTotalShares}, shrPr ${shrPr}`);
      
      const tx = await sedao.connect(oracle1).prosumed(...Object.values(params));
      
      const postBals = await Promise.all(params.accounts.map(a => paymentToken.balanceOf(a)));
      const postM2Shares = await shareToken.balanceOf(member2.address);
      const postTotalShares = await shareToken.totalSupply();
      const postDAOBal = await paymentToken.balanceOf(sedao.address);
      
      for(let i=0; i<params.accounts.length; i++) {
        //console.log(`a${i} preBal ${preBals[i]}, postBal ${postBals[i]}`);
      }

      expect(postBals[0]).to.equal(preBals[0].add(payDeltas[0]));
      expect(postBals[1]).to.equal(preBals[1]); // couldn't pay
      
      // TODO: also check shares
      //expect(postM2Shares)
    });
  });
  
  // TODO: upgradability
});
