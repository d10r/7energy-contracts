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
    
    const SEDAO = await hre.ethers.getContractFactory("SEDAO");
    const sedao = await SEDAO.deploy(paymentToken, admissionAmount);
    await sedao.deployed();

    console.log("SEDAO deployed to:", sedao.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
