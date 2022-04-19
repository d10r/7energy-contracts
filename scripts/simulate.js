const fs = require("fs");
const CSVParser = require("csv-parse/sync");

// importing ethers from hardhat gives us added convenience like getContractFactory() and outsourced RPC mgmt
const { ethers } = require("hardhat");

const FILENAME = process.env.FILENAME || "data/sim.csv";
const SLOT_DURATION = process.env.SLOT_DURATION || 2; // seconds
const INITIAL_PAYMENT_TOKENS = process.env.INITIAL_PAYMENT_TOKENS || "250";
const KWH_PRICE = process.env.KWH_PRICE || "0.2";
const APPROVAL_AMOUNT = ethers.utils.parseUnits("800");

let sedao, paymentToken, shareToken;
let admin, oracle, members;

async function deploySEDAO(signer) {
    SEDAO = await ethers.getContractFactory("SEDAO");
    PaymentToken = await ethers.getContractFactory("PaymentTokenMock");
    SEShareToken = await ethers.getContractFactory("SEShareToken");

    console.log("deploying paymentToken...");
    paymentToken = await PaymentToken.deploy(ethers.utils.parseUnits("150000"));
    await paymentToken.deployTransaction.wait();

    for(let m of members) {
        await (await paymentToken.transfer(m.address, ethers.utils.parseUnits(INITIAL_PAYMENT_TOKENS))).wait()
    }
  
    //console.log(`paymentToken: ${paymentToken.address}`);
    const admissionAmount = ethers.utils.parseUnits("50");
    console.log("deploying sedao...");
    sedao = await SEDAO.deploy(paymentToken.address, admissionAmount);
    await sedao.deployTransaction.wait();
    console.log("sedao deployTx: ", sedao.deployTransaction.hash);
    shareToken = SEShareToken.attach(await sedao.shareToken());
    await(await sedao.addOracle(oracle.address)).wait();
    
    console.log(`SEDAO deployed at ${sedao.address}, paymentToken at ${paymentToken.address}, shareToken at ${shareToken.address}`);
}

async function prepareDevnetSigners() {
    // create accounts
    [admin, oracle, ...members] = await ethers.getSigners(16);
    
    members.slice(0,1).forEach(async m =>
        await admin.sendTransaction({to: m.address, value: ethers.utils.parseUnits("0.1")})
    );
}

async function prepareTestnetSigners(nrMembers, provider) {
    // addr of #0: 0xe37d37ed26fa71a64e95d60b41cba2445271de1e
    // PK of #0: f4e0ee3eda687acaca69ff73b6a2f846a02eff10e3af21915df9d9e9be8a2a38
    const mnemonic = process.env.MNEMONIC || "tail measure goose give muffin orange dune rose panther salon green warrior";

//    [ admin ] = await ethers.getSigners(1);
    
    admin = ethers.Wallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0").connect(provider);
    oracle = ethers.Wallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/1").connect(provider);

    members = [];
    
    for(let i=0; i < nrMembers; i++) {
        members.push(ethers.Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${10+i}`).connect(provider));
    }
    
    console.log(`admin: ${admin.address}, oracle: ${oracle.address}`);
    
    // fund all accounts with native coins
    await admin.sendTransaction({to: oracle.address, value: ethers.utils.parseUnits("0.1")});
    
    // init to current nonce of admin acc
    let nonce = await provider.getTransactionCount(admin.address) + 1;
    console.log("admin initial nonce: ", nonce);
    const MIN_MEMBER_BAL = ethers.utils.parseUnits("0.05");
    for(let m of members) {
        const memberBalance = await m.getBalance();
        console.log(`bal of ${m.address}: ${memberBalance.toString()}`);
        if(memberBalance.lt(MIN_MEMBER_BAL)) {
            console.log("funding member ", m.address);
            // add nonce - do only if not yet funded
            await admin.sendTransaction({to: m.address, value: ethers.utils.parseUnits("0.1"), nonce: nonce++});
        }
    }
}

async function getBalances(accounts) {
    const accBals = await Promise.all(accounts.map(async acc => {
        return {
            account: acc.address,
            paymentTokens: (await paymentToken.balanceOf(acc.address)).toString(),
            shareTokens: (await shareToken.balanceOf(acc.address)).toString()
        }
    }));
    await accBals.forEach(a =>
        console.log(`${a.account}: pt ${ethers.utils.formatUnits(a.paymentTokens)}, st ${ethers.utils.formatUnits(a.shareTokens)}`)
    );
    return accBals;
}


// main
(async () => {
    let report = [];
    
    // read data
    const csvStr = fs.readFileSync(FILENAME, "utf-8");
    const slots = CSVParser.parse(csvStr/*, {columns: true}*/);
    
    console.log("network: ", hre.network.name);
    if(hre.network.name === "hardhat") {
        console.log("initializing for devnet");
        await prepareDevnetSigners();
    } else {
        console.log("initializing for testnet");
        await prepareTestnetSigners(14, hre.ethers.provider);
    }

    console.log("admin: ", admin.address);
    
    // init DAO (instantiate or deploy)
    await deploySEDAO();
    
    // fund them if needed (testnet)
    
    // members approve and join the DAO
    for(let m of members) {
        console.log(`member ${m.address} approve and join...`);
        // wait for execution in order to make sure the nonce is increased before the next tx
        await (await paymentToken.connect(m).approve(sedao.address, APPROVAL_AMOUNT)).wait();
        await sedao.connect(m).join();
        console.log(`member ${m.address} joined`);
    }
    
    // prosume for all members and slots
    let slotCnt = 0;
    // first row without first column
    const headers = slots[0].slice(1);
    // headers are numbered from 1 onwards
    const accounts = headers.map(e => members.map(m => m.address)[e-1]);
    console.log("accounts: ", accounts);
    const whPrice = ethers.utils.parseUnits((Number(KWH_PRICE) / 1000).toString());
    for(let slot of slots.slice(1)) {
        slotCnt++; // start with 1
        const whDeltas = slot
            .slice(1) // remove slot column
            .map(v => Math.floor(-v*1000)); // invert in order to have negative values for consumption
        console.log(`slot ${slotCnt} deltas: ${whDeltas}, whPrice ${whPrice.toString()}`);
        
        await sedao.connect(oracle).prosumed(slotCnt, accounts, whDeltas, whPrice);
        
        //const balances = await getBalances(members);
        //console.log("balances: ", JSON.stringify(balances, null, 2));
        
        const accBals = await getBalances(members);
        report.push({
            slot: slotCnt,
            balances: accBals
        });
        
        // artificial slowdown
        await new Promise(resolve => setTimeout(resolve, SLOT_DURATION*1000));
    }
    fs.writeFileSync("sim_report.json", JSON.stringify(report, null, 2));
})();
