require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
    },
    kovan: {
      url: "https://kovan-rpc.lab10.io",
      // 0x38EEcBc486111D9B0DD85Eeb9512AF214705617A
      accounts: ["0x542bef32d5d1c2dbe83316f83c2ae7c8e8298d9db11b0d2020c74dbf56518647"]
    }
  },
  solidity: "0.8.13",
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};
