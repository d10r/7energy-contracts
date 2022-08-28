/*
 * This script deploys an instance of SEDAO with its own shareToken.
 * The paymentToken needs to already exist.
 * Config ENV vars:
 * - PAYMENT_TOKEN: address of the payment token to be set
 * - ADMISSION_AMOUNT: amount of tokens to be paid for DAO admission
 * 
 * If unspecified, a default token for kovan will be set.
 * 
 * Note: this script deploys existing binaries, doesn't compile itself.
 */

const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
    const paymentToken = process.env.PAYMENT_TOKEN || "0xb64845d53a373d35160b72492818f0d2f51292c0";
    const admissionAmount = ethers.utils.parseUnits(process.env.ADMISSION_AMOUNT || "100");
    
    const UUPSProxy = await hre.ethers.getContractFactory("UUPSProxy");
    const SEDAO = await hre.ethers.getContractFactory("SEDAO");

    const proxy = await UUPSProxy.deploy();
    await proxy.deployed();
    console.log("SEDAO proxy deployed to:", proxy.address);

    const sedaoLogic = await SEDAO.deploy();
    await sedaoLogic.deployed();
    console.log("SEDAO logic deployed to:", sedaoLogic.address);

    await (await proxy.initializeProxy(sedaoLogic.address)).wait();

    const sedao = await SEDAO.attach(proxy.address);
    await (await sedao.initialize(paymentToken, admissionAmount)).wait();
    console.log("SEDAO initialized!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
