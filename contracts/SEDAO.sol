// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// TODO: implement openzeppelin Ownable
contract SEShareToken is ERC20 {
    address public owner;
    
    constructor() ERC20("7Energy Share Token", "7ES") {
        owner = msg.sender;
    }

    function mint(address account, uint256 amount) public {
        require(msg.sender == owner, "only owner can mint");
        _mint(account, amount);
    }
    
    function burn(address account, uint256 amount) public {
        require(msg.sender == owner, "only owner can burn");
        _burn(account, amount);
    }

    // skip allowance check for owner initiated transfers
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        if(msg.sender == owner) {
            _transfer(sender, recipient, amount);
            return true;    
        } else {
            // permission check done by default implementation
            return ERC20.transferFrom(sender, recipient, amount);
        }
    }

    // Token transfers aren't allowed by default, but governed by the contract owner
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual override {
        require(msg.sender == owner, "non-transferable");
        ERC20._transfer(sender, recipient, amount);
    }
}

// Simple implementation of a contract facilitating accounting of energy communities.
contract SEDAO {
    IERC20 public paymentToken;
    SEShareToken public shareToken;
    uint256 public admissionAmount;
    address public admin;
    mapping(address => bool) public isOracle;
    // timeframe after which a leaving member can redeem all shares
    uint256 public cooldownPeriod = 3600*24; // 1 day
    mapping(address => bool) public isMember;
    mapping(address => bool) public prefersShares;
    // timestamp at which a member left - reset after cooldown
    mapping(address => uint256) public leftTs;
    uint256 constant SHARE_PRICE_DENOM = 1E18;

    constructor(
        IERC20 paymentToken_, 
        uint256 initialAdmissionAmount_
    ) {
        admin = msg.sender;
        paymentToken = paymentToken_;
        admissionAmount = initialAdmissionAmount_;
        shareToken = new SEShareToken();
    }

    modifier onlyMember {
        require(isMember[msg.sender], "not a member");
        _;
    }

    modifier onlyAdmin {
        require(msg.sender == admin, "only admin");
        _;
    }

    modifier onlyOracle {
        require(isOracle[msg.sender], "not an oracle");
        _;
    }

    // amount of shares a member gets when joining
    function getAdmissionShareAmount() public view returns(uint256) {
        return admissionAmount * 1;
    }

    // min amount of shares required for retaining membership
    function getMinShareAmount() public view returns(uint256) {
        return getAdmissionShareAmount() / 2;
    }

    // returns true if the given account is a member holding the min amount of shares required
    function isSolventMember(address account) public view returns (bool) {
        return isMember[account] && shareToken.balanceOf(account) >= getMinShareAmount();
    }

    // in v1, the share price is just the relation between treasury and outstanding shares
    function getSharePrice() public view returns(uint256) {
        //require(shareToken.totalSupply() > 0, "no shares outstanding");
        if(shareToken.totalSupply() > 0) {
            return paymentToken.balanceOf(address(this)) * SHARE_PRICE_DENOM / shareToken.totalSupply();
        } else { // fallback to the price set for admission
            return admissionAmount * SHARE_PRICE_DENOM / getAdmissionShareAmount();
        }
    }

    event Joined(address indexed account, uint256 admissionPaymentAmount, uint256 admissionSharesAmount);
    // Allows anybody to pre-join the DAO by paying the admission fee and getting shares in return
    // Sender needs to ERC20.approve() beforehand
    // TODO: allow ERC777.send()
    function join() external {
        require(! isMember[msg.sender], "already a member");
        paymentToken.transferFrom(msg.sender, address(this), admissionAmount);
        shareToken.mint(msg.sender, getAdmissionShareAmount());
        isMember[msg.sender] = true;
        emit Joined(msg.sender, admissionAmount, getAdmissionShareAmount());
    }

    event BoughtShares(address indexed account, uint256 sharesAmount, uint256 paymentAmount);
    // Allows members to buy more shares
    function buyShares(uint256 sharesAmount) external onlyMember {
        paymentToken.transferFrom(msg.sender, address(this), sharesAmount * getSharePrice() / SHARE_PRICE_DENOM);
        shareToken.mint(msg.sender, sharesAmount);
        emit BoughtShares(msg.sender, sharesAmount, sharesAmount * getSharePrice() / SHARE_PRICE_DENOM);
    }

    event RedeemedShares(address indexed account, uint256 amount, uint256 paymentAmount);
    // Allows anybody to redeem shares for payment tokens
    // at least shares equivalent to the admission amount need to be left
    function redeemShares(uint256 sharesAmount) external {
        require(sharesAmount <= shareToken.balanceOf(msg.sender), "amount exceeds balance");
        if(shareToken.balanceOf(msg.sender) - sharesAmount < getMinShareAmount()) {
            if(isMember[msg.sender]) {
                revert("not enough shares left");
            } else if(leftTs[msg.sender] != 0) { // leaving member
                require(block.timestamp >= leftTs[msg.sender] + cooldownPeriod, "cooldown not over");
                leftTs[msg.sender] = 0; // cooldown over, reset
            }
        }
        
        uint256 paymentAmount = sharesAmount * getSharePrice() / SHARE_PRICE_DENOM;
        paymentToken.transfer(msg.sender, paymentAmount);
        shareToken.burn(msg.sender, sharesAmount);
        emit RedeemedShares(msg.sender, sharesAmount, paymentAmount);
    }

    event Left(address indexed account, uint256 sharesHeld);
    // allows members to leave. Shares can be redeemed after the cooldown period
    function leave() external onlyMember {
        leftTs[msg.sender] = block.timestamp;
        isMember[msg.sender] = false;
        emit Left(msg.sender, shareToken.balanceOf(msg.sender));
    }
    
    // not yet tested - don't use!
    event PrefersPayment(address indexed account);
    // allows producers to set their preference to getting rewarded with payment tokens
    function preferPayment() external onlyMember {
        prefersShares[msg.sender] = false;
        emit PrefersPayment(msg.sender);
    }

    // not yet tested - don't use!
    event PrefersShares(address indexed account);
    // allows producers to set their preference to getting rewarded with shares
    function preferShares() external onlyMember {
        prefersShares[msg.sender] = true;
        emit PrefersShares(msg.sender);
    }

    event Consumed(address indexed account, uint256 period, uint256 wh, uint256 price);
    event Produced(address indexed account, uint256 period, uint256 wh, uint256 price);
    // oracle provides a list of accounts to be updated for the given accounting period
    // account[], whDelta[], price
    // relies on the oracle not bankrupting the DAO - sum of delta shall always be zero
    // the oracle may split the operations into multiple batches
    // a positive whDelta means production, a negative one consumption
    function prosumed(uint256 period, address[] memory accounts, int256[] calldata whDeltas, uint256 whPrice) 
        external onlyOracle 
    {
        require(accounts.length == whDeltas.length, "bad params");
        for(uint256 i=0; i<accounts.length; i++) {
            int256 amountDelta = whDeltas[i]*int256(whPrice);
            if(amountDelta < 0) { // net consumer pays into treasury account
                uint256 paymentAmount = uint256(amountDelta * -1);
                try paymentToken.transferFrom(accounts[i], address(this), paymentAmount) {
                } catch (bytes memory /*reason*/) {
                    // on failed payment, an equivalent amount in shares is burned
                    // in order to compensate the treasury
                    // TODO: handle case of not enough shares left
                    shareToken.burn(accounts[i], paymentAmount * SHARE_PRICE_DENOM / getSharePrice());
                }
                emit Consumed(accounts[i], period, uint256(whDeltas[i] * -1), whPrice);
            } else if(amountDelta > 0) { // net producer gets paid by treasury account or in shares
                uint256 rewardAmount = uint256(amountDelta);
                if(prefersShares[msg.sender]) {
                    shareToken.mint(msg.sender, rewardAmount * SHARE_PRICE_DENOM / getSharePrice());
                } else {
                    paymentToken.transfer(accounts[i], rewardAmount);
                }
                emit Produced(accounts[i], period, uint256(whDeltas[i]), whPrice);
            } // else: ignore items with 0 delta
        }
    }

    event RemovedMember(address indexed account, uint256 sharesHeld);
    // allows the admin to remove a member. Cooldown period not applied in this case.
    function removeMember(address account) external onlyAdmin {
        if(isMember[account]) {
            isMember[account] = false;
            emit RemovedMember(account, shareToken.balanceOf(account));
        }
    }

    event AddedOracle(address indexed account);
    function addOracle(address account) external onlyAdmin {
        require(! isOracle[account], "already set");
        isOracle[account] = true;
        emit AddedOracle(account);
    }

    event RemovedOracle(address indexed account);
    function removeOracle(address account) external onlyAdmin {
        require(isOracle[account], "not set");
        isOracle[account] = false;
        emit RemovedOracle(account);
    }
}
