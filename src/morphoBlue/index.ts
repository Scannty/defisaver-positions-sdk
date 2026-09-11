import Dec from 'decimal.js';
import { assetAmountInEth, getAssetInfoByAddress } from '@defisaver/tokens';
import { Client, PublicClient } from 'viem';
import {
  Blockish, EthAddress, EthereumProvider, HexString, IncentiveKind, MMUsedAssets, NetworkNumber, PositionBalances, MMAssetsData,
} from '../types/common';
import {
  DFSFeedRegistryContractViem, FeedRegistryContractViem, MorphoBlueViewContractViem, getConfigContractAddress,
} from '../contracts';
import {
  MorphoBlueAssetsData, MorphoBlueEarnData, MorphoBlueMarketData, MorphoBlueMarketInfo, MorphoBlueMarketRewards, MorphoBluePositionData,
  MorphoBlueHistoricalBalance, MorphoBlueHistoricalBalanceAsset, MorphoBlueHistoricalBalanceContext,
} from '../types';
import { USD_QUOTE, WAD, ZERO_ADDRESS } from '../constants';
import { calculateNetApy, getStakingApy, STAKING_ASSETS } from '../staking';
import {
  addToArrayIf, compareAddresses, getEthAmountForDecimals, isMainnetNetwork, wethToEth,
} from '../services/utils';
import {
  getBorrowRate, getMorphoBlueAggregatedPositionData, getRewardsForMarket, getSupplyRate,
} from '../helpers/morphoBlueHelpers';
import { getChainlinkAssetAddress } from '../services/priceService';
import { getViemProvider, setViemBlockNumber } from '../services/viem';

import { addMorphoBlueMerklOpportunitiesToMarketInfo, getMorphoBlueMerklOpportunities } from './merkl';

export {
  MorphoBlueMerklOpportunityType,
  addMorphoBlueMerklOpportunitiesToMarketInfo,
  getMorphoBlueMerklOpportunities,
  addMorphoBlueMerklRewardsToMarketInfo,
} from './merkl';

const HARDCODED_USD_STABLE_PRICE = '100000000'; // $1 with 8 decimals
// Loan tokens with no Chainlink registry feed that are treated as being worth exactly $1.
const HARDCODED_USD_STABLE_SYMBOLS = ['USDA', 'RLUSD'];

const getMorphoRewardIncentives = (apy: string) => [{
  token: 'MORPHO',
  apy,
  incentiveKind: IncentiveKind.Reward,
  description: 'Eligible for protocol-level MORPHO incentives.',
}];

export const addMorphoBlueRewardsToMarketInfo = (
  marketInfo: MorphoBlueMarketInfo,
  rewards: MorphoBlueMarketRewards,
): MorphoBlueMarketInfo => ({
  ...marketInfo,
  assetsData: {
    ...marketInfo.assetsData,
    [marketInfo.loanToken]: {
      ...marketInfo.assetsData[marketInfo.loanToken],
      supplyIncentives: [
        ...marketInfo.assetsData[marketInfo.loanToken].supplyIncentives.filter(({ token }) => token !== 'MORPHO'),
        ...getMorphoRewardIncentives(rewards.supplyApy),
      ],
      borrowIncentives: [
        ...marketInfo.assetsData[marketInfo.loanToken].borrowIncentives.filter(({ token }) => token !== 'MORPHO'),
        ...getMorphoRewardIncentives(rewards.borrowApy),
      ],
    },
  },
});

async function getMorphoBlueMarketDataInternal(
  provider: Client,
  network: NetworkNumber,
  selectedMarket: MorphoBlueMarketData,
): Promise<MorphoBlueMarketInfo> {
  const {
    loanToken, collateralToken, oracle, irm, lltv, oracleType,
  } = selectedMarket;

  const lltvInWei = new Dec(lltv).mul(WAD).toString();
  const loanTokenInfo = getAssetInfoByAddress(loanToken, network);
  const collateralTokenInfo = getAssetInfoByAddress(collateralToken, network);

  const loanTokenFeedAddress = getChainlinkAssetAddress(loanTokenInfo.symbol, network);

  const morphoBlueViewContract = MorphoBlueViewContractViem(provider, network);

  let marketInfo;
  let loanTokenPrice;
  const isHardcodedUsdStable = HARDCODED_USD_STABLE_SYMBOLS.includes(loanTokenInfo.symbol);
  const isMainnet = isMainnetNetwork(network);
  if (isMainnet) {
    const feedRegistryContract = FeedRegistryContractViem(provider, NetworkNumber.Eth);
    const [_loanTokenPrice, _marketInfo] = await Promise.all([
      isHardcodedUsdStable ? Promise.resolve(HARDCODED_USD_STABLE_PRICE) : feedRegistryContract.read.latestAnswer([loanTokenFeedAddress, USD_QUOTE]),
      morphoBlueViewContract.read.getMarketInfoNotTuple([loanToken, collateralToken, oracle, irm, BigInt(lltvInWei)]),
    ]);
    marketInfo = _marketInfo;
    loanTokenPrice = _loanTokenPrice;
  } else {
    // Currently only base network is supported
    const feedRegistryContract = DFSFeedRegistryContractViem(provider, network);

    const [loanTokenPriceRound, _marketInfo] = await Promise.all([
      isHardcodedUsdStable ? Promise.resolve([0, HARDCODED_USD_STABLE_PRICE]) // Normalize to match the expected object structure
        : feedRegistryContract.read.latestRoundData([loanTokenFeedAddress, USD_QUOTE]),
      morphoBlueViewContract.read.getMarketInfoNotTuple([loanToken, collateralToken, oracle, irm, BigInt(lltvInWei)]),
    ]);
    marketInfo = _marketInfo;
    loanTokenPrice = loanTokenPriceRound[1].toString();
  }

  const supplyRate = getSupplyRate(marketInfo.totalSupplyAssets.toString(), marketInfo.totalBorrowAssets.toString(), marketInfo.borrowRate.toString(), marketInfo.fee.toString());
  const compoundedBorrowRate = getBorrowRate(marketInfo.borrowRate.toString(), marketInfo.totalBorrowShares.toString());
  const utillization = new Dec(marketInfo.totalBorrowAssets.toString()).div(marketInfo.totalSupplyAssets.toString()).mul(100).toString();

  const oracleScaleFactor = new Dec(36).add(loanTokenInfo.decimals).sub(collateralTokenInfo.decimals).toString();
  const oracleScale = new Dec(10).pow(oracleScaleFactor).toString();

  const scale = new Dec(10).pow(loanTokenInfo.decimals).toString();

  const oracleRate = new Dec(marketInfo.oracle.toString()).div(oracleScale).toString();
  const assetsData: MorphoBlueAssetsData = {};
  assetsData[wethToEth(loanTokenInfo.symbol)] = {
    symbol: wethToEth(loanTokenInfo.symbol),
    address: loanToken,
    price: new Dec(loanTokenPrice).div(1e8).toString(),
    supplyRate,
    borrowRate: compoundedBorrowRate,
    totalSupply: new Dec(marketInfo.totalSupplyAssets.toString()).div(scale).toString(),
    totalBorrow: new Dec(marketInfo.totalBorrowAssets.toString()).div(scale).toString(),
    canBeSupplied: true,
    canBeBorrowed: true,
    supplyIncentives: [],
    borrowIncentives: [],
  };

  assetsData[wethToEth(collateralTokenInfo.symbol)] = {
    symbol: wethToEth(collateralTokenInfo.symbol),
    address: collateralToken,
    price: new Dec(assetsData[wethToEth(loanTokenInfo.symbol)].price).mul(oracleRate).toString(),
    supplyRate: '0',
    borrowRate: '0',
    canBeSupplied: true,
    canBeBorrowed: false,
    supplyIncentives: [],
    borrowIncentives: [],
  };
  if (STAKING_ASSETS.includes(collateralTokenInfo.symbol)) {
    assetsData[collateralTokenInfo.symbol].supplyIncentives = [{
      apy: await getStakingApy(collateralTokenInfo.symbol),
      token: collateralTokenInfo.symbol,
      incentiveKind: IncentiveKind.Staking,
      description: `Native ${collateralTokenInfo.symbol} yield.`,
    }];
  }

  return {
    id: marketInfo.id,
    fee: new Dec(marketInfo.fee.toString()).div(WAD).toString(),
    loanToken: wethToEth(loanTokenInfo.symbol),
    collateralToken: wethToEth(collateralTokenInfo.symbol),
    utillization,
    oracle: oracleRate,
    oracleType,
    lltv: new Dec(lltv).toString(),
    minRatio: new Dec(1).div(lltv).mul(100).toString(),
    assetsData,
  };
}

export async function _getMorphoBlueMarketData(provider: Client, network: NetworkNumber, selectedMarket: MorphoBlueMarketData): Promise<MorphoBlueMarketInfo> {
  const [marketInfo, rewards, merklOpportunities] = await Promise.all([
    getMorphoBlueMarketDataInternal(provider, network, selectedMarket),
    getRewardsForMarket(selectedMarket.marketId, network).catch((error) => {
      console.error(error);
      return { supplyApy: '0', borrowApy: '0' };
    }),
    getMorphoBlueMerklOpportunities(),
  ]);

  return addMorphoBlueMerklOpportunitiesToMarketInfo(
    addMorphoBlueRewardsToMarketInfo(marketInfo, rewards),
    selectedMarket,
    network,
    merklOpportunities,
  );
}

export function _getMorphoBluePortfolioMarketData(provider: Client, network: NetworkNumber, selectedMarket: MorphoBlueMarketData): Promise<MorphoBlueMarketInfo> {
  return getMorphoBlueMarketDataInternal(provider, network, selectedMarket);
}

export async function getMorphoBlueMarketData(provider: EthereumProvider, network: NetworkNumber, selectedMarket: MorphoBlueMarketData): Promise<MorphoBlueMarketInfo> {
  return _getMorphoBlueMarketData(getViemProvider(provider, network), network, selectedMarket);
}

export function getMorphoBluePortfolioMarketData(provider: EthereumProvider, network: NetworkNumber, selectedMarket: MorphoBlueMarketData): Promise<MorphoBlueMarketInfo> {
  return _getMorphoBluePortfolioMarketData(getViemProvider(provider, network), network, selectedMarket);
}

export const getMorphoBluePositionDataWithMarketInfo = (
  data: MorphoBluePositionData,
  marketInfo: MorphoBlueMarketInfo,
): MorphoBluePositionData => ({
  ...data,
  ...getMorphoBlueAggregatedPositionData({
    usedAssets: data.usedAssets,
    assetsData: marketInfo.assetsData,
    marketInfo,
  }),
});

export const getMorphoEarnDataWithMarketInfo = (data: MorphoBlueEarnData, marketInfo: MorphoBlueMarketInfo): MorphoBlueEarnData => {
  const loanTokenInfo = marketInfo.assetsData[marketInfo.loanToken];
  const usedAssets: MMUsedAssets = {
    [marketInfo.loanToken]: {
      symbol: loanTokenInfo.symbol,
      supplied: data.amount,
      borrowed: '0',
      isSupplied: new Dec(data.amount).gt(0),
      isBorrowed: false,
      collateral: false,
      suppliedUsd: data.amountUsd,
      borrowedUsd: '0',
    },
  };

  return {
    ...data,
    apy: calculateNetApy({ usedAssets, assetsData: marketInfo.assetsData as unknown as MMAssetsData }).netApy,
  };
};

export function getMorphoBlueMarketRewards(
  network: NetworkNumber,
  selectedMarket: MorphoBlueMarketData,
): Promise<MorphoBlueMarketRewards> {
  return getRewardsForMarket(selectedMarket.marketId, network);
}

export const _getMorphoBlueAccountBalances = async (provider: Client, network: NetworkNumber, block: Blockish, addressMapping: boolean, address: EthAddress, selectedMarket: MorphoBlueMarketData): Promise<PositionBalances> => {
  let balances: PositionBalances = {
    collateral: {},
    debt: {},
  };

  if (!address) {
    return balances;
  }

  const viewContract = MorphoBlueViewContractViem(provider, network, block);
  const {
    loanToken, collateralToken, oracle, irm, lltv,
  } = selectedMarket;
  const lltvInWei = BigInt(new Dec(lltv).mul(WAD).toString());
  const marketObject = {
    loanToken, collateralToken, oracle, irm, lltv: lltvInWei,
  };

  const loanInfo = await viewContract.read.getUserInfo([marketObject, address], setViemBlockNumber(block));
  const loanTokenInfo = getAssetInfoByAddress(selectedMarket.loanToken, network);
  const collateralTokenInfo = getAssetInfoByAddress(selectedMarket.collateralToken, network);

  balances = {
    collateral: {
      [addressMapping ? collateralTokenInfo.address.toLowerCase() : wethToEth(collateralTokenInfo.symbol)]: assetAmountInEth(loanInfo.collateral.toString(), collateralTokenInfo.symbol),
    },
    debt: {
      [addressMapping ? loanTokenInfo.address.toLowerCase() : wethToEth(loanTokenInfo.symbol)]: assetAmountInEth(loanInfo.borrowedInAssets.toString(), loanTokenInfo.symbol),
    },
  };

  return balances;
};

export const getMorphoBlueAccountBalances = async (
  provider: EthereumProvider,
  network: NetworkNumber,
  block: Blockish,
  addressMapping: boolean,
  address: EthAddress,
  selectedMarket: MorphoBlueMarketData,
): Promise<PositionBalances> => _getMorphoBlueAccountBalances(getViemProvider(provider, network), network, block, addressMapping, address, selectedMarket);

/**
 * Historical net-balance helpers that bypass the MorphoBlueView contract.
 *
 * The View (and therefore `getMorphoBlueAccountData` / `getMorphoBlueAccountBalances`) can only be
 * queried from its deployment block onwards. On mainnet the oldest MorphoBlueView this SDK knows
 * about sits at block 18976639 while the Morpho Blue singleton went live at 18883124 — two weeks of
 * real position history the View cannot reach for the markets Morpho launched with, and later
 * networks start their View later still. Morpho itself is a singleton whose storage getters reach
 * back to its own deployment, so reading them directly covers the whole history. Used to build a
 * position balance-history chart.
 *
 * Failure policy: every point is either fully priced or throws. A partially-read point would render
 * as a believable dip in the chart rather than as a gap, which is worse than no point at all, so any
 * read that fails for something that provably existed at the block is surfaced as an error.
 *
 * Cost: one multicall per point for an address with no position in the market, two for one with a
 * position. Nothing is cached from head except `idToMarketParams`, which Morpho writes once in
 * `createMarket` and never again.
 */

/**
 * Minimal Morpho Blue singleton ABI. `market` and `position` are the compiler-generated getters for
 * the two storage mappings, so they return the raw state: shares rather than assets for both sides
 * of the loan token, and totals last accrued at `market.lastUpdate` rather than at the block read.
 */
const MORPHO_BLUE_ABI = [
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'market',
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }, { name: 'user', type: 'address' }],
    name: 'position',
    outputs: [
      { name: 'supplyShares', type: 'uint256' },
      { name: 'borrowShares', type: 'uint128' },
      { name: 'collateral', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'idToMarketParams',
    outputs: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Minimal IRM ABI. `borrowRateView` is the read-only twin of the rate Morpho charges when it accrues.
const MORPHO_IRM_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: 'marketParams',
        type: 'tuple',
      },
      {
        components: [
          { name: 'totalSupplyAssets', type: 'uint128' },
          { name: 'totalSupplyShares', type: 'uint128' },
          { name: 'totalBorrowAssets', type: 'uint128' },
          { name: 'totalBorrowShares', type: 'uint128' },
          { name: 'lastUpdate', type: 'uint128' },
          { name: 'fee', type: 'uint128' },
        ],
        name: 'market',
        type: 'tuple',
      },
    ],
    name: 'borrowRateView',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Minimal Morpho oracle ABI. `price` quotes one whole collateral token in loan-token base units,
 * scaled by 1e(36 + loanTokenDecimals - collateralTokenDecimals) — never in USD, which is why every
 * point needs the loan token's own USD price on top.
 */
const MORPHO_ORACLE_ABI = [
  {
    inputs: [], name: 'price', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
] as const;

const ERC20_DECIMALS_ABI = [
  {
    inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
] as const;

// Minimal Chainlink FeedRegistry ABI (mainnet only), for the loan token's USD price at the block.
const FEED_REGISTRY_ABI = [
  {
    inputs: [{ name: 'base', type: 'address' }, { name: 'quote', type: 'address' }], name: 'latestAnswer', outputs: [{ type: 'int256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'base', type: 'address' }, { name: 'quote', type: 'address' }], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
] as const;

// The DFS registry stands in for the Chainlink one on the networks that have no FeedRegistry. It
// exposes no `decimals`, hence the extra hop through `getFeed` to the aggregator behind it.
const DFS_FEED_REGISTRY_ABI = [
  {
    inputs: [{ name: 'base', type: 'address' }, { name: 'quote', type: 'address' }],
    name: 'latestRoundData',
    outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'base', type: 'address' }, { name: 'quote', type: 'address' }], name: 'getFeed', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function',
  },
] as const;

const CHAINLINK_AGGREGATOR_ABI = [
  {
    inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
] as const;

// Interest accrues to the block being read, so the point needs that block's timestamp. Taking it
// from Multicall3 keeps it inside the same batched call instead of costing a second round trip.
const MULTICALL3_ABI = [
  {
    inputs: [], name: 'getCurrentBlockTimestamp', outputs: [{ name: 'timestamp', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
] as const;

// Taken from the chain viem was configured with rather than added as another constant: the batched
// reads below already go through Multicall3, so a chain without one cannot serve a point at all.
const getMulticall3Address = (provider: Client, network: NetworkNumber): HexString => {
  const address = (provider as PublicClient).chain?.contracts?.multicall3?.address;
  if (!address) throw new Error(`MorphoBlue historical balance: no Multicall3 deployment known for network ${network}`);
  return address;
};

/**
 * Morpho's fixed-point conventions, from its MathLib and SharesMathLib. The share↔asset products
 * below run to ~60 significant digits, past decimal.js's configured 50, so the accrual is done in
 * BigInt to stay exact — an approximation here would silently disagree with what Morpho itself
 * would report for the same block.
 */
const MORPHO_WAD = BigInt(WAD);
const MORPHO_VIRTUAL_SHARES = BigInt(1e6);
const MORPHO_VIRTUAL_ASSETS = BigInt(1);

const mulDivDown = (x: bigint, y: bigint, d: bigint) => (x * y) / d;
const mulDivUp = (x: bigint, y: bigint, d: bigint) => ((x * y) + d - BigInt(1)) / d;
const toAssetsDown = (shares: bigint, totalAssets: bigint, totalShares: bigint) => mulDivDown(shares, totalAssets + MORPHO_VIRTUAL_ASSETS, totalShares + MORPHO_VIRTUAL_SHARES);
const toAssetsUp = (shares: bigint, totalAssets: bigint, totalShares: bigint) => mulDivUp(shares, totalAssets + MORPHO_VIRTUAL_ASSETS, totalShares + MORPHO_VIRTUAL_SHARES);
const toSharesDown = (assets: bigint, totalAssets: bigint, totalShares: bigint) => mulDivDown(assets, totalShares + MORPHO_VIRTUAL_SHARES, totalAssets + MORPHO_VIRTUAL_ASSETS);

// Third-order Taylor expansion of the compounded rate, matching MathLib.wTaylorCompounded exactly.
const wTaylorCompounded = (rate: bigint, elapsed: bigint) => {
  const firstTerm = rate * elapsed;
  const secondTerm = mulDivDown(firstTerm, firstTerm, BigInt(2) * MORPHO_WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, BigInt(3) * MORPHO_WAD);
  return firstTerm + secondTerm + thirdTerm;
};

interface MorphoMarketState {
  totalSupplyAssets: bigint,
  totalSupplyShares: bigint,
  totalBorrowAssets: bigint,
  totalBorrowShares: bigint,
  lastUpdate: bigint,
  fee: bigint,
}

/**
 * Rolls the stored market totals forward to `timestamp`, reproducing MorphoBalancesLib's
 * `expectedMarketBalances`. `market(id)` returns the totals as of the last interaction with the
 * market, which can be hours or days before the block being read on a quiet market; converting
 * shares against those stale totals understates every position by the interest since.
 */
const accrueMarketState = (market: MorphoMarketState, borrowRate: bigint, timestamp: bigint): MorphoMarketState => {
  const elapsed = timestamp - market.lastUpdate;
  if (elapsed <= BigInt(0) || market.totalBorrowAssets === BigInt(0)) return market;

  const interest = mulDivDown(market.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed), MORPHO_WAD);
  const totalBorrowAssets = market.totalBorrowAssets + interest;
  const totalSupplyAssets = market.totalSupplyAssets + interest;
  let { totalSupplyShares } = market;

  // A non-zero market fee mints the fee recipient new supply shares out of the interest, diluting
  // every other supplier's share of the pot. Skipping it would overstate their balance.
  if (market.fee !== BigInt(0)) {
    const feeAmount = mulDivDown(interest, market.fee, MORPHO_WAD);
    totalSupplyShares += toSharesDown(feeAmount, totalSupplyAssets - feeAmount, totalSupplyShares);
  }

  return {
    ...market, totalSupplyAssets, totalSupplyShares, totalBorrowAssets,
  };
};

/**
 * Reads the market parameters and the token decimals behind them. Morpho sets `idToMarketParams` in
 * `createMarket` and has no code path that writes it again, so the whole set is immutable and safe
 * to fetch once at head and reuse for every history point.
 */
export const _getMorphoBlueHistoricalBalanceContext = async (provider: Client, network: NetworkNumber, selectedMarket: MorphoBlueMarketData): Promise<MorphoBlueHistoricalBalanceContext> => {
  const { marketId } = selectedMarket;

  // The singleton's address comes from the View rather than a new hardcoded per-network constant;
  // the View exists at head on every network this SDK supports Morpho on.
  const morpho = await MorphoBlueViewContractViem(provider, network).read.MORPHO_BLUE_ADDRESS() as EthAddress;
  if (!morpho || morpho === ZERO_ADDRESS) throw new Error(`MorphoBlue historical balance: no Morpho Blue address on network ${network}`);

  const [paramsRes, loanDecimalsRes, collDecimalsRes] = await (provider as PublicClient).multicall({
    contracts: [
      {
        address: morpho, abi: MORPHO_BLUE_ABI, functionName: 'idToMarketParams', args: [marketId as HexString],
      },
      { address: selectedMarket.loanToken, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' },
      { address: selectedMarket.collateralToken, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' },
    ],
    allowFailure: true,
  });

  if (paramsRes.status !== 'success') throw new Error(`MorphoBlue historical balance: could not read market ${marketId} on network ${network}`);
  const [loanToken, collateralToken, oracle, irm, lltv] = paramsRes.result;
  if (compareAddresses(loanToken, ZERO_ADDRESS)) throw new Error(`MorphoBlue historical balance: market ${marketId} does not exist on network ${network}`);
  if (loanDecimalsRes.status !== 'success' || collDecimalsRes.status !== 'success') throw new Error(`MorphoBlue historical balance: could not read token decimals for market ${marketId}`);

  // The market id is a hash of these five values, so a config entry that disagrees with the chain is
  // describing a different market than the one the id resolves to — priced with the wrong oracle.
  const lltvInWei = new Dec(selectedMarket.lltv).mul(WAD).toString();
  const configMatches = compareAddresses(loanToken, selectedMarket.loanToken)
    && compareAddresses(collateralToken, selectedMarket.collateralToken)
    && compareAddresses(oracle, selectedMarket.oracle)
    && compareAddresses(irm, selectedMarket.irm)
    && lltv.toString() === lltvInWei;
  if (!configMatches) throw new Error(`MorphoBlue historical balance: market ${marketId} on chain does not match its config entry`);

  const loanTokenSymbol = wethToEth(getAssetInfoByAddress(loanToken, network).symbol);
  const collateralTokenSymbol = wethToEth(getAssetInfoByAddress(collateralToken, network).symbol);

  // Pegged loan tokens with no registry feed are priced at $1, the same exception the head path
  // makes. Anything else with no known symbol has no feed to look up and would otherwise be priced
  // off an undefined address, so fail here rather than at the first point.
  const isHardcodedUsdStable = HARDCODED_USD_STABLE_SYMBOLS.includes(loanTokenSymbol);
  if (!isHardcodedUsdStable && loanTokenSymbol === '?') throw new Error(`MorphoBlue historical balance: no USD price feed known for loan token ${loanToken}`);
  const loanTokenFeedBase = isHardcodedUsdStable ? '' : getChainlinkAssetAddress(loanTokenSymbol, network);
  if (!isHardcodedUsdStable && !loanTokenFeedBase) throw new Error(`MorphoBlue historical balance: no USD price feed known for loan token ${loanTokenSymbol} on network ${network}`);

  return {
    marketId,
    morpho,
    loanToken,
    collateralToken,
    oracle,
    irm,
    lltv: lltv.toString(),
    loanTokenDecimals: Number(loanDecimalsRes.result),
    collateralTokenDecimals: Number(collDecimalsRes.result),
    loanTokenSymbol,
    collateralTokenSymbol,
    loanTokenFeedBase,
  };
};

export const getMorphoBlueHistoricalBalanceContext = async (provider: EthereumProvider, network: NetworkNumber, selectedMarket: MorphoBlueMarketData): Promise<MorphoBlueHistoricalBalanceContext> => _getMorphoBlueHistoricalBalanceContext(getViemProvider(provider, network, { batch: { multicall: true } }), network, selectedMarket);

/**
 * Computes a user's Morpho Blue balance in one market at a historical block, without touching the
 * MorphoBlueView contract. Pass `context` (from getMorphoBlueHistoricalBalanceContext) to avoid
 * refetching the market's immutables for every point.
 */
export const _getMorphoBlueHistoricalBalance = async (
  provider: Client,
  network: NetworkNumber,
  selectedMarket: MorphoBlueMarketData,
  address: EthAddress,
  block: number,
  context?: MorphoBlueHistoricalBalanceContext,
): Promise<MorphoBlueHistoricalBalance> => {
  const { marketId } = selectedMarket;
  const empty: MorphoBlueHistoricalBalance = {
    block,
    marketId,
    suppliedUsd: '0',
    suppliedCollateralUsd: '0',
    borrowedUsd: '0',
    netUsd: '0',
    loanTokenUsdPrice: '0',
    collateralTokenUsdPrice: '0',
    assets: [],
  };
  if (!address) return empty;

  const ctx = context || await _getMorphoBlueHistoricalBalanceContext(provider, network, selectedMarket);
  // A context built for another market would be read instead of `selectedMarket` while the result is
  // labelled with `selectedMarket` — easy to do when looping markets for a chart and reusing one.
  if (ctx.marketId.toLowerCase() !== marketId.toLowerCase()) throw new Error(`MorphoBlue historical balance: context is for market ${ctx.marketId}, not ${marketId}`);
  const blockNumber = BigInt(block);

  const isMainnet = isMainnetNetwork(network);
  const needsFeed = !!ctx.loanTokenFeedBase;
  const feedRegistry = needsFeed ? getConfigContractAddress(isMainnet ? 'FeedRegistry' : 'DFSFeedRegistry', network, block) : '';
  if (needsFeed && !feedRegistry) throw new Error(`MorphoBlue historical balance: no price feed registry configured on network ${network}`);
  const feedBase = ctx.loanTokenFeedBase as HexString;

  // Round one reads the market state, the user's raw position and the block's timestamp, plus
  // whichever of the feed registry's shapes this network uses — none of that depends on the others.
  const stateContracts: any[] = [
    {
      address: ctx.morpho, abi: MORPHO_BLUE_ABI, functionName: 'market', args: [marketId as HexString],
    },
    {
      address: ctx.morpho, abi: MORPHO_BLUE_ABI, functionName: 'position', args: [marketId as HexString, address],
    },
    { address: getMulticall3Address(provider, network), abi: MULTICALL3_ABI, functionName: 'getCurrentBlockTimestamp' },
    // The feed's decimals are read at the block, not cached at head: a registry re-pointed at a
    // differently scaled aggregator would otherwise rescale the whole chart's earlier points.
    ...addToArrayIf(needsFeed && isMainnet, {
      address: feedRegistry, abi: FEED_REGISTRY_ABI, functionName: 'decimals', args: [feedBase, USD_QUOTE],
    }),
    ...addToArrayIf(needsFeed && !isMainnet, {
      address: feedRegistry, abi: DFS_FEED_REGISTRY_ABI, functionName: 'getFeed', args: [feedBase, USD_QUOTE],
    }),
  ];

  const stateResults = await (provider as PublicClient).multicall({ contracts: stateContracts, allowFailure: true, blockNumber });

  const marketRes = stateResults[0];
  const positionRes = stateResults[1];
  const timestampRes = stateResults[2];
  // Morpho had no code at `block` (or the archive node could not serve it) — a gap, not a real $0
  // balance, so throw and let the caller render it as one.
  if (marketRes?.status !== 'success' || positionRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: market or position read failed at block ${block}`);
  if (timestampRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: could not read block timestamp at block ${block}`);

  const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = marketRes.result as bigint[];
  // `createMarket` stamps `lastUpdate` with the creation timestamp and nothing can clear it, so a
  // zero here means the market did not exist yet. Reporting $0 would draw every pre-creation point
  // as a real balance of nothing rather than as the gap it is.
  if (lastUpdate === BigInt(0)) throw new Error(`MorphoBlue historical balance: market ${marketId} did not exist at block ${block}`);

  const marketState: MorphoMarketState = {
    totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee,
  };
  const [supplyShares, borrowShares, collateral] = positionRes.result as bigint[];

  // The DFS registry has no `decimals`, so its aggregator has to be resolved before it can be asked
  // for one. A registry that could not be read at all is a gap, not a price of zero.
  const dfsFeedRes = stateResults[3];
  if (needsFeed && !isMainnet && dfsFeedRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: no USD feed registered for ${ctx.loanTokenSymbol} at block ${block}`);

  // Nothing to price, and the market provably existed at this block, so this zero is real.
  if (supplyShares === BigInt(0) && borrowShares === BigInt(0) && collateral === BigInt(0)) return empty;

  const timestamp = timestampRes.result as bigint;
  const marketParams = {
    loanToken: ctx.loanToken, collateralToken: ctx.collateralToken, oracle: ctx.oracle, irm: ctx.irm, lltv: BigInt(ctx.lltv),
  };
  // The same guards `accrueMarketState` applies, hoisted so the IRM is only read when its rate is
  // actually used: with no IRM, nothing borrowed, or no time since `lastUpdate`, the interest is zero
  // either way. Reading it anyway would cost a call on every point of a market that never borrows and
  // would turn a reverting IRM into a gap for a point that needs no rate at all.
  const needsRate = !compareAddresses(ctx.irm, ZERO_ADDRESS)
    && totalBorrowAssets !== BigInt(0)
    && timestamp > lastUpdate
    && (supplyShares !== BigInt(0) || borrowShares !== BigInt(0));
  // Collateral is held as a raw amount rather than as shares, so a position without any needs no
  // oracle read at all — and some market oracles revert on assets that have since been retired.
  const needsOracle = collateral !== BigInt(0);

  const priceContracts: any[] = [];
  const rateIndex = needsRate ? priceContracts.push({
    address: ctx.irm, abi: MORPHO_IRM_ABI, functionName: 'borrowRateView', args: [marketParams, marketState],
  }) - 1 : -1;
  const oracleIndex = needsOracle ? priceContracts.push({ address: ctx.oracle, abi: MORPHO_ORACLE_ABI, functionName: 'price' }) - 1 : -1;
  const answerIndex = needsFeed ? priceContracts.push(isMainnet
    ? {
      address: feedRegistry, abi: FEED_REGISTRY_ABI, functionName: 'latestAnswer', args: [feedBase, USD_QUOTE],
    }
    : {
      address: feedRegistry, abi: DFS_FEED_REGISTRY_ABI, functionName: 'latestRoundData', args: [feedBase, USD_QUOTE],
    }) - 1 : -1;
  const dfsDecimalsIndex = needsFeed && !isMainnet ? priceContracts.push({
    address: dfsFeedRes?.result, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'decimals',
  }) - 1 : -1;

  const priceResults = await (provider as PublicClient).multicall({ contracts: priceContracts, allowFailure: true, blockNumber });

  let borrowRate = BigInt(0);
  if (needsRate) {
    const rateRes = priceResults[rateIndex];
    if (rateRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: could not read borrow rate for market ${marketId} at block ${block}`);
    borrowRate = rateRes.result as bigint;
  }

  const accrued = accrueMarketState(marketState, borrowRate, timestamp);
  const suppliedInAssets = toAssetsDown(supplyShares, accrued.totalSupplyAssets, accrued.totalSupplyShares);
  const borrowedInAssets = toAssetsUp(borrowShares, accrued.totalBorrowAssets, accrued.totalBorrowShares);

  // The loan token's USD price scales every leg of the point, the collateral one included, because
  // the market oracle only quotes collateral in loan-token terms. Read block-pinned on this same
  // network, so an L2 point is never priced off a mainnet block number.
  const readLoanTokenUsdPrice = () => {
    if (!needsFeed) return new Dec(1);
    const answerRes = priceResults[answerIndex];
    if (answerRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: no USD price for ${ctx.loanTokenSymbol} at block ${block}`);
    const answer = (isMainnet ? answerRes.result : (answerRes.result as any[])[1]) as bigint;
    if (isMainnet) {
      const decimalsRes = stateResults[3];
      if (decimalsRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: no USD feed decimals for ${ctx.loanTokenSymbol} at block ${block}`);
      return new Dec(getEthAmountForDecimals(answer.toString(), Number(decimalsRes.result)));
    }
    const decimalsRes = priceResults[dfsDecimalsIndex];
    if (decimalsRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: no USD feed decimals for ${ctx.loanTokenSymbol} at block ${block}`);
    return new Dec(getEthAmountForDecimals(answer.toString(), Number(decimalsRes.result)));
  };

  const loanTokenUsdPrice = readLoanTokenUsdPrice();
  if (loanTokenUsdPrice.lte(0)) throw new Error(`MorphoBlue historical balance: non-positive ${ctx.loanTokenSymbol} price at block ${block}`);

  const loanScale = new Dec(10).pow(ctx.loanTokenDecimals);
  const collateralScale = new Dec(10).pow(ctx.collateralTokenDecimals);

  let collateralTokenUsdPrice = new Dec(0);
  if (needsOracle) {
    const oracleRes = priceResults[oracleIndex];
    // The user provably held collateral at this block, so this read was expected to succeed and a
    // missing price would drop the whole collateral leg out of an otherwise plausible-looking point.
    if (oracleRes?.status !== 'success') throw new Error(`MorphoBlue historical balance: no oracle price for market ${marketId} at block ${block}`);
    // ORACLE_PRICE_SCALE, spelled out from the decimals the tokens report rather than assumed.
    const oracleScale = new Dec(10).pow(new Dec(36).add(ctx.loanTokenDecimals).sub(ctx.collateralTokenDecimals).toString());
    collateralTokenUsdPrice = new Dec((oracleRes.result as bigint).toString()).div(oracleScale).mul(loanTokenUsdPrice);
  }

  const assets: MorphoBlueHistoricalBalanceAsset[] = [];
  const loanSuppliedUsd = new Dec(suppliedInAssets.toString()).div(loanScale).mul(loanTokenUsdPrice);
  const loanBorrowedUsd = new Dec(borrowedInAssets.toString()).div(loanScale).mul(loanTokenUsdPrice);
  const suppliedCollateralUsd = new Dec(collateral.toString()).div(collateralScale).mul(collateralTokenUsdPrice);

  if (suppliedInAssets !== BigInt(0) || borrowedInAssets !== BigInt(0)) {
    assets.push({
      symbol: ctx.loanTokenSymbol,
      address: ctx.loanToken,
      supplied: suppliedInAssets.toString(),
      suppliedUsd: loanSuppliedUsd.toString(),
      borrowed: borrowedInAssets.toString(),
      borrowedUsd: loanBorrowedUsd.toString(),
      isCollateral: false,
    });
  }
  if (collateral !== BigInt(0)) {
    assets.push({
      symbol: ctx.collateralTokenSymbol,
      address: ctx.collateralToken,
      supplied: collateral.toString(),
      suppliedUsd: suppliedCollateralUsd.toString(),
      borrowed: '0',
      borrowedUsd: '0',
      isCollateral: true,
    });
  }

  const suppliedUsd = loanSuppliedUsd.add(suppliedCollateralUsd);

  return {
    block,
    marketId,
    suppliedUsd: suppliedUsd.toString(),
    suppliedCollateralUsd: suppliedCollateralUsd.toString(),
    borrowedUsd: loanBorrowedUsd.toString(),
    netUsd: suppliedUsd.minus(loanBorrowedUsd).toString(),
    loanTokenUsdPrice: loanTokenUsdPrice.toString(),
    collateralTokenUsdPrice: collateralTokenUsdPrice.toString(),
    assets,
  };
};

export const getMorphoBlueHistoricalBalance = async (
  provider: EthereumProvider,
  network: NetworkNumber,
  selectedMarket: MorphoBlueMarketData,
  address: EthAddress,
  block: number,
  context?: MorphoBlueHistoricalBalanceContext,
): Promise<MorphoBlueHistoricalBalance> => _getMorphoBlueHistoricalBalance(getViemProvider(provider, network, { batch: { multicall: true } }), network, selectedMarket, address, block, context);

export async function _getMorphoBlueAccountData(provider: Client, network: NetworkNumber, account: EthAddress, selectedMarket: MorphoBlueMarketData, marketInfo: MorphoBlueMarketInfo): Promise<MorphoBluePositionData> {
  const {
    loanToken, collateralToken, oracle, irm, lltv,
  } = selectedMarket;
  const lltvInWei = new Dec(lltv).mul(WAD).toString();
  const viewContract = MorphoBlueViewContractViem(provider, network);
  const loanInfo = (await viewContract.read.getUserInfo([
    {
      loanToken, collateralToken, oracle, irm, lltv: BigInt(lltvInWei),
    },
    account]));
  const usedAssets: MMUsedAssets = {};

  const loanTokenInfo = marketInfo.assetsData[marketInfo.loanToken];
  const loanTokenSupplied = assetAmountInEth(loanInfo.suppliedInAssets.toString(), marketInfo.loanToken);
  const loanTokenBorrowed = assetAmountInEth(loanInfo.borrowedInAssets.toString(), marketInfo.loanToken);
  usedAssets[marketInfo.loanToken] = {
    symbol: loanTokenInfo.symbol,
    supplied: loanTokenSupplied,
    borrowed: loanTokenBorrowed,
    isSupplied: new Dec(loanInfo.suppliedInAssets.toString()).gt(0),
    isBorrowed: new Dec(loanInfo.borrowedInAssets.toString()).gt(0),
    collateral: false,
    suppliedUsd: new Dec(loanTokenSupplied).mul(loanTokenInfo.price).toString(),
    borrowedUsd: new Dec(loanTokenBorrowed).mul(loanTokenInfo.price).toString(),
  };

  const collateralTokenInfo = marketInfo.assetsData[marketInfo.collateralToken];
  const collateralTokenSupplied = assetAmountInEth(loanInfo.collateral.toString(), marketInfo.collateralToken);
  usedAssets[marketInfo.collateralToken] = {
    symbol: collateralTokenInfo.symbol,
    supplied: collateralTokenSupplied,
    borrowed: '0',
    isSupplied: new Dec(loanInfo.collateral.toString()).gt(0),
    isBorrowed: false,
    collateral: true,
    suppliedUsd: new Dec(collateralTokenSupplied).mul(collateralTokenInfo.price).toString(),
    borrowedUsd: '0',
  };

  return {
    supplyShares: loanInfo.supplyShares.toString(),
    borrowShares: loanInfo.borrowShares.toString(),
    usedAssets,
    ...getMorphoBlueAggregatedPositionData({ usedAssets, assetsData: marketInfo.assetsData, marketInfo }),
  };
}

export async function getMorphoBlueAccountData(provider: EthereumProvider, network: NetworkNumber, account: EthAddress, selectedMarket: MorphoBlueMarketData, marketInfo: MorphoBlueMarketInfo): Promise<MorphoBluePositionData> {
  return _getMorphoBlueAccountData(getViemProvider(provider, network), network, account, selectedMarket, marketInfo);
}

export async function getMorphoEarn(provider: Client, network: NetworkNumber, account: EthAddress, selectedMarket: MorphoBlueMarketData, marketInfo: MorphoBlueMarketInfo): Promise<MorphoBlueEarnData> {
  const {
    loanToken, collateralToken, oracle, irm, lltv,
  } = selectedMarket;
  const lltvInWei = new Dec(lltv).mul(WAD).toString();

  const viewContract = MorphoBlueViewContractViem(provider, network);
  const loanInfo = (await viewContract.read.getUserInfo([
    {
      loanToken, collateralToken, oracle, irm, lltv: BigInt(lltvInWei),
    },
    account]));

  const loanTokenInfo = marketInfo.assetsData[marketInfo.loanToken];
  const loanTokenSupplied = assetAmountInEth(loanInfo.suppliedInAssets.toString(), marketInfo.loanToken);
  const loanTokenSuppliedUsd = new Dec(loanTokenSupplied).mul(loanTokenInfo.price).toString();
  return getMorphoEarnDataWithMarketInfo({
    apy: '0',
    amount: loanTokenSupplied,
    amountUsd: loanTokenSuppliedUsd,
  }, marketInfo);
}
