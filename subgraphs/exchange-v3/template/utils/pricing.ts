/* eslint-disable prefer-const */
import { ONE_BD, ZERO_BD, ZERO_BI } from "./constants";
import { Bundle, Pool, Token } from "../generated/schema";
import { BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import { exponentToBigDecimal, safeDiv, safeDivInt } from "./index";

// prettier-ignore
const WETH_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c".toLowerCase();
// prettier-ignore
// const USDC_WETH_03_POOL = "0x36696169c63e42cd08ce11f5deebbcebae652050";
const USDC_WETH_03_POOL = "0x2D774731D831cC3c6A1000fD8F4cefdCD256f955".toLowerCase();

const STABLE_IS_TOKEN0 = "false" as string;

// token where amounts should contribute to tracked volume and liquidity
// usually tokens that many tokens are paired with s
// prettier-ignore
// export let WHITELIST_TOKENS: string[] = "0x5aea5775959fbc2557cc8789bc1bf90a239d9a91,0x493257fd37edb34451f62edf8d2a0c418852ba4c,0x2039bb4116b4efc145ec4f0e2ea75012d6c0f181,0x3355df6d4c9c3035724fd0e3914de96a5a83aaf4,0xbbeb516fb02a01611cbbe0453fe3c580d7281011,0x32fd44bb869620c0ef993754c8a00be67c464806,0x703b52f2b28febcb60e1372858af5b18849fe867,0x3a287a06c66f9e95a56327185ca2bdf5f031cecd,0x4b9eb6c0b6ea15176bbf62841c6b2a8a398cb656,0x8e86e46278518efc1c5ced245cba2c7e3ef11557".split(",");
export let WHITELIST_TOKENS: string[] = [
  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "0x55d398326f99059fF775485246999027B3197955",
  "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
].map<string>((v: string) => v.toLowerCase());

// prettier-ignore
let STABLE_COINS: string[] = [
  // "0x493257fd37edb34451f62edf8d2a0c418852ba4c",
  // "0x3355df6d4c9c3035724fd0e3914de96a5a83aaf4",
  // "0x2039bb4116b4efc145ec4f0e2ea75012d6c0f181",
  // "0x4b9eb6c0b6ea15176bbf62841c6b2a8a398cb656",
  // "0x8e86e46278518efc1c5ced245cba2c7e3ef11557",

  "0x55d398326f99059fF775485246999027B3197955",
  "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
].map<string>((v: string) => v.toLowerCase());

let MINIMUM_ETH_LOCKED = BigDecimal.fromString("5");

let Q192 = BigInt.fromI32(2).pow(192);
export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt, token0: Token, token1: Token): BigDecimal[] {
  let num = sqrtPriceX96.times(sqrtPriceX96);
  log.warning(">>>>>> SQRT Num {}", [num.toString()]);

  let qnom = BigInt.fromI32(2).pow(192);
  let denom = Q192;
  log.warning(">>>>>> SQRT Denom {}, Q:{}", [denom.toString(), qnom.toString()]);

  let div = num.div(denom);
  let times = div.times(token0.decimals);
  let price1 = times.div(token1.decimals);

  log.warning(">>>>>> SQRT Price1:{}, Div:{}, Times:{}", [price1.toString(), div.toString(), times.toString()]);

  let price0 = safeDivInt(BigInt.fromString("1"), price1);
  log.warning(">>>>>> SQRT Price0:{}", [price0.toString()]);

  return [BigDecimal.fromString(price0.toString()), BigDecimal.fromString(price1.toString())];
}

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  // let usdcPool = Pool.load(USDC_WETH_03_POOL); // dai is token0
  // let usdcPool = Pool.loadInBlock("34944652"); // dai is token0

  let usdcPool = Pool.load(USDC_WETH_03_POOL);

  if (usdcPool !== null) {
    log.warning("**** Loaded Pool Price 0: {} - 1: {} ? Stable: {}, Pool: {}", [
      usdcPool.token0Price.toString(),
      usdcPool.token1Price.toString(),
      STABLE_IS_TOKEN0,
      usdcPool.id,
    ]);
    if (STABLE_IS_TOKEN0 === "true") {
      return usdcPool.token0Price;
    }
    return usdcPool.token1Price;
  } else {
    log.warning("**** Could Not Load Pool Price!", []);
    return ZERO_BD;
  }
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD;
  }
  let whiteList = token.whitelistPools;
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityETH = ZERO_BD;
  let priceSoFar = ZERO_BD;
  let bundle = Bundle.load("1");
  if (bundle === null) {
    log.warning("**** Could Not Load Bundle", []);
    return BigDecimal.fromString("0");
  }

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  if (STABLE_COINS.indexOf(token.id) >= 0) {
    priceSoFar = safeDiv(ONE_BD, bundle.ethPriceUSD);
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      let poolAddress = whiteList[i];
      let pool = Pool.load(poolAddress);
      if (pool === null) {
        log.warning("**** Could Not Load Pool", []);
        return BigDecimal.fromString("0");
      }

      if (pool.liquidity.gt(ZERO_BI)) {
        if (pool.token0 == token.id) {
          // whitelist token is token1
          let token1 = Token.load(pool.token1);
          if (token1 === null) {
            log.warning("**** Could Not Load Token 1", []);
            return BigDecimal.fromString("0");
          }

          // get the derived ETH in pool
          let ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH);
          if (
            ethLocked.gt(largestLiquidityETH) &&
            (ethLocked.gt(MINIMUM_ETH_LOCKED) || WHITELIST_TOKENS.indexOf(pool.token0) >= 0)
          ) {
            largestLiquidityETH = ethLocked;
            // token1 per our token * Eth per token1
            priceSoFar = pool.token1Price.times(token1.derivedETH as BigDecimal);
          }
        }
        if (pool.token1 == token.id) {
          let token0 = Token.load(pool.token0);
          if (token0 === null) {
            log.warning("**** Could Not Load Token ", []);
            return BigDecimal.fromString("0");
          }

          // get the derived ETH in pool
          let ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH);
          if (
            ethLocked.gt(largestLiquidityETH) &&
            (ethLocked.gt(MINIMUM_ETH_LOCKED) || WHITELIST_TOKENS.indexOf(pool.token1) >= 0)
          ) {
            largestLiquidityETH = ethLocked;
            // token0 per our token * ETH per token0
            priceSoFar = pool.token0Price.times(token0.derivedETH as BigDecimal);
          }
        }
      }
    }
  }
  return priceSoFar; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load("1");
  if (bundle === null) {
    log.warning("**** Could Not Load Bundle", []);
    return BigDecimal.fromString("0");
  }

  let price0USD = token0.derivedETH.times(bundle.ethPriceUSD);
  let price1USD = token1.derivedETH.times(bundle.ethPriceUSD);

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    return tokenAmount0.times(price0USD).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    return tokenAmount1.times(price1USD).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountETH(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let derivedETH0 = token0.derivedETH;
  let derivedETH1 = token1.derivedETH;

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    return tokenAmount0.times(derivedETH0).plus(tokenAmount1.times(derivedETH1));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    return tokenAmount0.times(derivedETH0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    return tokenAmount1.times(derivedETH1).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD;
}

export class AmountType {
  eth: BigDecimal;
  usd: BigDecimal;
  ethUntracked: BigDecimal;
  usdUntracked: BigDecimal;
}

export function getAdjustedAmounts(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): AmountType {
  let derivedETH0 = token0.derivedETH;
  let derivedETH1 = token1.derivedETH;
  let bundle = Bundle.load("1");
  if (bundle === null) {
    log.warning("**** Could Not Load Bundle", []);
    return {
      eth: BigDecimal.fromString("0"),
      usd: BigDecimal.fromString("0"),
      ethUntracked: BigDecimal.fromString("0"),
      usdUntracked: BigDecimal.fromString("0"),
    };
  }

  let eth = ZERO_BD;
  let ethUntracked = tokenAmount0.times(derivedETH0).plus(tokenAmount1.times(derivedETH1));

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    eth = ethUntracked;
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    eth = tokenAmount0.times(derivedETH0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.indexOf(token0.id) < 0 && WHITELIST_TOKENS.indexOf(token1.id) >= 0) {
    eth = tokenAmount1.times(derivedETH1).times(BigDecimal.fromString("2"));
  }

  // Define USD values based on ETH derived values.
  log.warning("++++++ BUNDLE ADJ ID:{}, Price:{}", [bundle.id, bundle.ethPriceUSD.toString()]);
  let usd = eth.times(bundle.ethPriceUSD);
  let usdUntracked = ethUntracked.times(bundle.ethPriceUSD);

  return { eth, usd, ethUntracked, usdUntracked };
}
