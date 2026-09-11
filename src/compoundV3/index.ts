import Dec from 'decimal.js';
import {
  assetAmountInEth, getAssetInfo, getAssetInfoByAddress,
} from '@defisaver/tokens';
import { Client, PublicClient } from 'viem';
import { CompV3ViewContractViem, getConfigContractAddress } from '../contracts';
import {
  CompoundV3AssetData, CompoundMarketData, CompoundV3AssetsData, CompoundV3UsedAssets, CompoundV3MarketsData, CompoundV3PositionData,
  CompoundHistoricalBalanceAsset, CompoundV3HistoricalBalance, CompoundV3HistoricalBalanceContext,
} from '../types';
import {
  Blockish, EthAddress, EthereumProvider, IncentiveKind, NetworkNumber, PositionBalances,
} from '../types/common';
import {
  getStakingApy, STAKING_ASSETS,
} from '../staking';
import {
  addToArrayIf, compareAddresses, ethToWeth, getEthAmountForDecimals, wethToEth,
} from '../services/utils';
import { ZERO_ADDRESS } from '../constants';
import { calculateBorrowingAssetLimit } from '../moneymarket';
import {
  formatBaseData, formatMarketData, getCompoundV3AggregatedData, getIncentiveApys,
} from '../helpers/compoundHelpers';
import { CompoundMarkets } from '../markets/compound';
import {
  getEthPrice, getCompPrice, getUSDCPrice, getWstETHPrice,
} from '../services/priceService';
import { getViemProvider, setViemBlockNumber } from '../services/viem';
import { attachCompoundV3MerklIncentives, getCompoundV3MerklOpportunities } from './merkl';

export { getCompoundV3MerklOpportunities, attachCompoundV3MerklIncentives } from './merkl';

const getSupportedAssetsAddressesForMarket = (selectedMarket: CompoundMarketData, network: NetworkNumber) => selectedMarket.collAssets.map(asset => getAssetInfo(ethToWeth(asset), network)).map(addr => addr.address.toLowerCase());

const getBaseAssetPriceFunction = (asset: string) => {
  switch (asset) {
    case 'wstETH':
      return getWstETHPrice;
    case 'ETH':
      return getEthPrice;
    default:
      return getUSDCPrice;
  }
};

export const _getCompoundV3MarketsData = async (provider: Client, network: NetworkNumber, selectedMarket: CompoundMarketData, defaultProvider: Client): Promise<CompoundV3MarketsData> => {
  const contract = CompV3ViewContractViem(provider, network);

  const [baseAssetPrice, compPrice, baseTokenInfo, collInfos, govInfo, merklOpportunities] = await Promise.all([
    getBaseAssetPriceFunction(selectedMarket.baseAsset)(defaultProvider),
    getCompPrice(defaultProvider),
    contract.read.getFullBaseTokenInfo([selectedMarket.baseMarketAddress]),
    contract.read.getFullCollInfos([selectedMarket.baseMarketAddress]),
    contract.read.getGovernanceInfoFull([selectedMarket.baseMarketAddress]),
    getCompoundV3MerklOpportunities(),
  ]);

  const { isSupplyPaused, isWithdrawPaused } = govInfo;

  const supportedAssetsAddresses = getSupportedAssetsAddressesForMarket(selectedMarket, network);

  const colls = collInfos
    .filter((coll: any) => supportedAssetsAddresses.includes(coll.tokenAddr.toLowerCase()))
    .map((coll: any) => formatMarketData(coll, network, baseAssetPrice, isSupplyPaused, isWithdrawPaused)) as CompoundV3AssetData[];

  for (const coll of colls) {
    if (STAKING_ASSETS.includes(coll.symbol)) {
      coll.supplyIncentives.push({
        apy: await getStakingApy(coll.symbol),
        token: coll.symbol,
        incentiveKind: IncentiveKind.Staking,
        description: `Native ${coll.symbol} yield.`,
      });
    }
  }
  const base = formatBaseData(baseTokenInfo, network, baseAssetPrice, isSupplyPaused, isWithdrawPaused);

  const payload: CompoundV3AssetsData = {};

  const baseObj = { ...base, ...(await getIncentiveApys(base, compPrice)) };
  attachCompoundV3MerklIncentives(baseObj, colls, selectedMarket.baseMarketAddress, network, merklOpportunities);
  const allAssets = [baseObj, ...colls];

  allAssets
    .sort((a, b) => {
      const aMarket = new Dec(a.price).times(a.totalSupply).toString();
      const bMarket = new Dec(b.price).times(b.totalSupply).toString();

      return new Dec(bMarket).minus(aMarket).toNumber();
    })
    .forEach((market, i) => {
      payload[market.symbol] = { ...market, sortIndex: i };
    });

  return {
    assetsData: payload, isMarketBorrowPaused: isWithdrawPaused, isMarketSupplyPaused: isSupplyPaused, isMarketWithdrawPaused: isWithdrawPaused,
  };
};

export const getCompoundV3MarketsData = async (provider: EthereumProvider, network: NetworkNumber, selectedMarket: CompoundMarketData, defaultProvider: EthereumProvider): Promise<CompoundV3MarketsData> => _getCompoundV3MarketsData(getViemProvider(provider, network), network, selectedMarket, getViemProvider(defaultProvider, network));

export const EMPTY_COMPOUND_V3_DATA = {
  usedAssets: {},
  suppliedUsd: '0',
  borrowedUsd: '0',
  borrowLimitUsd: '0',
  leftToBorrowUsd: '0',
  ratio: '0',
  minRatio: '0',
  netApy: '0',
  incentiveUsd: '0',
  totalInterestUsd: '0',
  isSubscribedToAutomation: false,
  automationResubscribeRequired: false,
  isAllowed: false,
  lastUpdated: Date.now(),
  exposure: 'N/A',
};

export const EMPTY_USED_ASSET = {
  isSupplied: false,
  isBorrowed: false,
  supplied: '0',
  suppliedUsd: '0',
  borrowed: '0',
  borrowedUsd: '0',
  symbol: '',
  collateral: true,
  debt: '0',
};

export const _getCompoundV3AccountBalances = async (provider: Client, network: NetworkNumber, block: Blockish, addressMapping: boolean, address: EthAddress, marketAddress: EthAddress): Promise<PositionBalances> => {
  let balances: PositionBalances = {
    collateral: {},
    debt: {},
  };

  if (!address) {
    return balances;
  }

  const market = Object.values(CompoundMarkets(network)).find((m) => (
    m.baseMarketAddress
    && m.baseMarketAddress !== ZERO_ADDRESS
    && m.baseMarketAddress.toLowerCase() === marketAddress.toLowerCase()
  ));

  if (!market) throw new Error(`Unsupported Compound V3 market address ${marketAddress} on network ${network}`);

  const loanInfoContract = CompV3ViewContractViem(provider, network, block);
  const loanInfo = await loanInfoContract.read.getLoanData([market.baseMarketAddress, address], setViemBlockNumber(block));
  const baseAssetInfo = getAssetInfo(wethToEth(market.baseAsset), network);

  balances = {
    collateral: {
      [addressMapping ? baseAssetInfo.address.toLowerCase() : baseAssetInfo.symbol]: loanInfo.depositAmount.toString(),
    },
    debt: {
      [addressMapping ? baseAssetInfo.address.toLowerCase() : baseAssetInfo.symbol]: loanInfo.borrowAmount.toString(),
    },
  };

  loanInfo.collAddr.forEach((coll: string, i: number): void => {
    const symbol = wethToEth(getAssetInfoByAddress(coll, network).symbol);
    balances = {
      ...balances,
      collateral: {
        ...balances.collateral,
        [addressMapping ? getAssetInfo(symbol, network).address.toLowerCase() : symbol]: loanInfo.collAmounts[i].toString(),
      },
    };
  });

  return balances;
};

export const getCompoundV3AccountBalances = async (provider: EthereumProvider, network: NetworkNumber, block: Blockish, addressMapping: boolean, address: EthAddress, marketAddress: EthAddress): Promise<PositionBalances> => _getCompoundV3AccountBalances(getViemProvider(provider, network), network, block, addressMapping, address, marketAddress);

/**
 * Historical net-balance helpers that bypass the CompV3View contract.
 *
 * The View contract (and therefore `getCompoundV3AccountData` / `getCompoundV3AccountBalances`) can
 * only be queried from its deployment block onwards. On mainnet the oldest configured CompV3View
 * sits at block 15520449 while cUSDCv3 went live at 15331586 — a ~190k block window of real
 * position history the View can't reach, and every market listed later has the same gap against
 * whichever View version predates it. The Comet itself exposes accrued, asset-denominated user
 * getters plus the prices it liquidates against, so reading it directly reaches back to the
 * market's own deployment. Used to build a position balance-history chart.
 *
 * Failure policy: every point is either fully priced or throws. A partially-read point would render
 * as a believable dip in the chart rather than as a gap, which is worse than no point at all, so any
 * read that fails for an asset that provably existed at the block is surfaced as an error.
 *
 * Cost: two multicalls per point. The collateral list and its price feeds are read *at the block*
 * instead of cached from head, because Compound governance both appends collaterals and swaps price
 * feeds — the same asset is priced by different feeds in different markets, and the CAPO/SVR feeds
 * replaced earlier ones — so a chart spanning such a change has to price each point with the feed
 * that was actually configured then.
 */

// Minimal Comet ABI. `getPrice` returns the feed's raw answer, quoted in the market's numéraire.
const COMET_ABI = [
  {
    inputs: [], name: 'baseToken', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [], name: 'baseTokenPriceFeed', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [], name: 'numAssets', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'i', type: 'uint8' }],
    name: 'getAssetInfo',
    outputs: [{
      components: [
        { name: 'offset', type: 'uint8' },
        { name: 'asset', type: 'address' },
        { name: 'priceFeed', type: 'address' },
        { name: 'scale', type: 'uint64' },
        { name: 'borrowCollateralFactor', type: 'uint64' },
        { name: 'liquidateCollateralFactor', type: 'uint64' },
        { name: 'liquidationFactor', type: 'uint64' },
        { name: 'supplyCap', type: 'uint128' },
      ],
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'priceFeed', type: 'address' }], name: 'getPrice', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }], name: 'borrowBalanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }, { name: 'asset', type: 'address' }], name: 'collateralBalanceOf', outputs: [{ type: 'uint128' }], stateMutability: 'view', type: 'function',
  },
] as const;

// Minimal Chainlink aggregator ABI, for the markets whose Comet prices aren't already in USD.
const CHAINLINK_ABI = [
  {
    inputs: [], name: 'latestAnswer', outputs: [{ type: 'int256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * What a market's price feeds are quoted in. A Comet quotes every feed — base and collateral — in
 * one numéraire, and that numéraire is not always USD: the stablecoin markets quote in USD, so the
 * base token's own feed already *is* its USD price and the Comet is self-sufficient. The ETH and
 * wstETH markets instead quote in the base asset itself and pin their base feed to a constant 1.0,
 * so those need one extra Chainlink read to convert the whole point. This is the same split the
 * head path makes in `getBaseAssetPriceFunction`, for the same reason.
 *
 * A base asset missing from here throws rather than defaulting to USD: guessing wrong would report
 * ETH- or BTC-denominated numbers as dollars, off by three orders of magnitude and plausible enough
 * to go unnoticed on a chart. Adding a market means adding its base asset here.
 */
const BASE_ASSET_QUOTE: Record<string, 'usd' | 'ETH' | 'wstETH'> = {
  USDC: 'usd',
  'USDC.e': 'usd',
  USDbC: 'usd',
  USDT: 'usd',
  USDS: 'usd',
  ETH: 'ETH',
  wstETH: 'wstETH',
};

/**
 * Reads the parts of a market that don't move: its base token, that token's decimals, and the
 * decimals every price feed in the market shares. Fetch once and reuse across all history points.
 */
export const _getCompoundV3HistoricalBalanceContext = async (provider: Client, network: NetworkNumber, selectedMarket: CompoundMarketData): Promise<CompoundV3HistoricalBalanceContext> => {
  const marketAddress = selectedMarket.baseMarketAddress;
  if (!marketAddress || marketAddress === ZERO_ADDRESS) throw new Error(`CompoundV3 historical balance: market ${selectedMarket.value} has no address on network ${network}`);

  const [baseTokenRes, baseDecimalsRes, baseFeedRes, numAssetsRes] = await (provider as PublicClient).multicall({
    contracts: [
      { address: marketAddress, abi: COMET_ABI, functionName: 'baseToken' },
      { address: marketAddress, abi: COMET_ABI, functionName: 'decimals' },
      { address: marketAddress, abi: COMET_ABI, functionName: 'baseTokenPriceFeed' },
      { address: marketAddress, abi: COMET_ABI, functionName: 'numAssets' },
    ],
    allowFailure: true,
  });

  if (baseTokenRes.status !== 'success' || baseDecimalsRes.status !== 'success' || numAssetsRes.status !== 'success') throw new Error(`CompoundV3 historical balance: could not read market ${marketAddress}`);
  if (baseFeedRes.status !== 'success') throw new Error(`CompoundV3 historical balance: could not read base price feed for market ${marketAddress}`);

  // The Comet's constructor rejects any price feed whose decimals differ from the rest, so one read
  // covers the whole market. Read it rather than assume 8 — the Aave v3 history helper hardcodes
  // its divisor and that is the one thing there worth not copying.
  const priceFeedDecimals = await (provider as PublicClient).readContract({
    address: baseFeedRes.result as EthAddress, abi: CHAINLINK_ABI, functionName: 'decimals',
  });

  return {
    marketAddress,
    baseToken: baseTokenRes.result as EthAddress,
    baseSymbol: wethToEth(selectedMarket.baseAsset),
    baseDecimals: Number(baseDecimalsRes.result),
    priceFeedDecimals: Number(priceFeedDecimals),
    numAssets: Number(numAssetsRes.result),
  };
};

export const getCompoundV3HistoricalBalanceContext = async (provider: EthereumProvider, network: NetworkNumber, selectedMarket: CompoundMarketData): Promise<CompoundV3HistoricalBalanceContext> => _getCompoundV3HistoricalBalanceContext(getViemProvider(provider, network, { batch: { multicall: true } }), network, selectedMarket);

/**
 * Computes a user's Compound v3 balance in one market at a historical block, without touching the
 * CompV3View contract. Pass `context` (from getCompoundV3HistoricalBalanceContext) to avoid
 * refetching the market's immutables for every point.
 */
export const _getCompoundV3HistoricalBalance = async (
  provider: Client,
  network: NetworkNumber,
  selectedMarket: CompoundMarketData,
  address: EthAddress,
  block: number,
  context?: CompoundV3HistoricalBalanceContext,
): Promise<CompoundV3HistoricalBalance> => {
  const marketAddress = selectedMarket.baseMarketAddress;
  const empty: CompoundV3HistoricalBalance = {
    block,
    market: marketAddress,
    suppliedUsd: '0',
    suppliedCollateralUsd: '0',
    borrowedUsd: '0',
    netUsd: '0',
    baseAssetUsdPrice: '0',
    assets: [],
  };
  if (!address) return empty;

  const quote = BASE_ASSET_QUOTE[selectedMarket.baseAsset];
  if (!quote) throw new Error(`CompoundV3 historical balance: unknown price denomination for base asset ${selectedMarket.baseAsset}`);

  const ctx = context || await _getCompoundV3HistoricalBalanceContext(provider, network, selectedMarket);
  // A context built for another market would be read instead of `selectedMarket` while the result is
  // labelled with `selectedMarket` — easy to do when looping markets for a chart and reusing one.
  if (!compareAddresses(ctx.marketAddress, marketAddress)) throw new Error(`CompoundV3 historical balance: context is for market ${ctx.marketAddress}, not ${marketAddress}`);
  const blockNumber = BigInt(block);

  // Round one establishes what the market looked like at `block`: how many collaterals it had, which
  // they were and which feeds priced them, plus the user's base supply and debt. The head count
  // bounds the probe; ids at or past the block's own count revert and are skipped.
  const assetIds = Array.from({ length: ctx.numAssets }, (_, i) => i);
  const marketContracts: any[] = [
    { address: marketAddress, abi: COMET_ABI, functionName: 'numAssets' },
    { address: marketAddress, abi: COMET_ABI, functionName: 'baseTokenPriceFeed' },
    {
      address: marketAddress, abi: COMET_ABI, functionName: 'balanceOf', args: [address],
    },
    {
      address: marketAddress, abi: COMET_ABI, functionName: 'borrowBalanceOf', args: [address],
    },
    ...assetIds.map((i) => ({
      address: marketAddress, abi: COMET_ABI, functionName: 'getAssetInfo', args: [i],
    })),
  ];

  const marketResults = await (provider as PublicClient).multicall({ contracts: marketContracts, allowFailure: true, blockNumber });

  const MARKET_PREFIX_CALLS = 4;

  // The Comet had no code at `block` (or the archive node couldn't serve it) — a gap, not a real
  // $0 balance, so throw and let the caller render it as one.
  const numAssetsRes = marketResults[0];
  if (numAssetsRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: all balance reads failed at block ${block}`);
  const numAssetsAtBlock = Number(numAssetsRes.result);
  // The probe is bounded by the head count, so a higher count here means a collateral was dropped
  // since and the probe would silently skip whatever now sits past the end of the list.
  if (numAssetsAtBlock > ctx.numAssets) throw new Error(`CompoundV3 historical balance: market had ${numAssetsAtBlock} collaterals at block ${block} but only ${ctx.numAssets} now`);

  const baseFeedRes = marketResults[1];
  const baseSuppliedRes = marketResults[2];
  const baseBorrowedRes = marketResults[3];
  if (baseFeedRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: could not read base price feed at block ${block}`);
  if (baseSuppliedRes?.status !== 'success' || baseBorrowedRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: base balance read failed at block ${block}`);

  const collaterals = assetIds.slice(0, numAssetsAtBlock).map((i) => {
    const res = marketResults[MARKET_PREFIX_CALLS + i];
    // The id is below the block's own count, so this read was expected to succeed. Dropping it would
    // quietly remove that collateral from the point.
    if (res?.status !== 'success' || !res.result) throw new Error(`CompoundV3 historical balance: could not read collateral ${i} at block ${block}`);
    const info = res.result as { asset: EthAddress, priceFeed: EthAddress, scale: bigint };
    return { address: info.asset, priceFeed: info.priceFeed, scale: info.scale.toString() };
  });

  // Round two prices what round one found. `collateralBalanceOf` is a plain mapping read, so it is
  // safe to call for every collateral configured at the block, held or not.
  const ethFeedAddress = quote === 'usd' ? '' : getConfigContractAddress('ETHPriceFeed', network, block);
  const wstEthFeedAddress = quote === 'wstETH' ? getConfigContractAddress('WstETHPriceFeed', network, block) : '';
  if (quote !== 'usd' && !ethFeedAddress) throw new Error(`CompoundV3 historical balance: no ETH price feed configured on network ${network}`);
  if (quote === 'wstETH' && !wstEthFeedAddress) throw new Error(`CompoundV3 historical balance: no wstETH price feed configured on network ${network}`);

  const priceContracts: any[] = [
    {
      address: marketAddress, abi: COMET_ABI, functionName: 'getPrice', args: [baseFeedRes.result],
    },
    ...collaterals.flatMap((coll) => ([
      {
        address: marketAddress, abi: COMET_ABI, functionName: 'collateralBalanceOf', args: [address, coll.address],
      },
      {
        address: marketAddress, abi: COMET_ABI, functionName: 'getPrice', args: [coll.priceFeed],
      },
    ])),
    ...addToArrayIf(quote !== 'usd',
      { address: ethFeedAddress, abi: CHAINLINK_ABI, functionName: 'latestAnswer' },
      { address: ethFeedAddress, abi: CHAINLINK_ABI, functionName: 'decimals' }),
    ...addToArrayIf(quote === 'wstETH',
      { address: wstEthFeedAddress, abi: CHAINLINK_ABI, functionName: 'latestRoundData' },
      { address: wstEthFeedAddress, abi: CHAINLINK_ABI, functionName: 'decimals' }),
  ];

  const priceResults = await (provider as PublicClient).multicall({ contracts: priceContracts, allowFailure: true, blockNumber });

  const basePriceRes = priceResults[0];
  if (basePriceRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: no base price at block ${block}`);

  const priceDivisor = new Dec(10).pow(ctx.priceFeedDecimals);

  // The scalar that turns a price quoted in this market's numéraire into USD: one dollar for the
  // USD-quoted markets, and the base asset's own USD price for the ETH and wstETH ones. Read from
  // Chainlink at the same block on the same network, so an L2 point is never priced off a mainnet
  // block number the way the head path's `defaultProvider` would be.
  const readNumeraireUsdPrice = () => {
    if (quote === 'usd') return new Dec(1);
    const feedOffset = 1 + (collaterals.length * 2);
    const ethRes = priceResults[feedOffset];
    const ethDecimalsRes = priceResults[feedOffset + 1];
    if (ethRes?.status !== 'success' || ethDecimalsRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: no ETH price at block ${block}`);
    // Every feed here is read for its decimals rather than assumed to have 8, the same way the
    // context reads the Comet's — a silently rescaled feed would move the whole point.
    const ethPrice = new Dec(getEthAmountForDecimals((ethRes.result as bigint).toString(), Number(ethDecimalsRes.result)));
    if (quote === 'ETH') return ethPrice;
    const rateRes = priceResults[feedOffset + 2];
    const rateDecimalsRes = priceResults[feedOffset + 3];
    if (rateRes?.status !== 'success' || rateDecimalsRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: no wstETH rate at block ${block}`);
    const rate = getEthAmountForDecimals((rateRes.result as any[])[1].toString(), Number(rateDecimalsRes.result));
    return ethPrice.mul(rate);
  };

  const numeraireUsdPrice = readNumeraireUsdPrice();
  if (numeraireUsdPrice.lte(0)) throw new Error(`CompoundV3 historical balance: non-positive base asset price at block ${block}`);
  const toUsdPrice = (raw: bigint) => new Dec(raw.toString()).div(priceDivisor).mul(numeraireUsdPrice);
  const baseAssetUsdPrice = toUsdPrice(basePriceRes.result as bigint);

  const assets: CompoundHistoricalBalanceAsset[] = [];
  let suppliedUsd = new Dec(0);
  let suppliedCollateralUsd = new Dec(0);
  let borrowedUsd = new Dec(0);

  // The base asset is either supplied or borrowed, never both, and Compound v3 does not lend
  // against it — hence its absence from `suppliedCollateralUsd`.
  const baseSupplied = (baseSuppliedRes.result as bigint).toString();
  const baseBorrowed = (baseBorrowedRes.result as bigint).toString();
  if (baseSupplied !== '0' || baseBorrowed !== '0') {
    const baseDivisor = new Dec(10).pow(ctx.baseDecimals);
    const baseSuppliedUsd = new Dec(baseSupplied).div(baseDivisor).mul(baseAssetUsdPrice);
    const baseBorrowedUsd = new Dec(baseBorrowed).div(baseDivisor).mul(baseAssetUsdPrice);
    suppliedUsd = suppliedUsd.add(baseSuppliedUsd);
    borrowedUsd = borrowedUsd.add(baseBorrowedUsd);
    assets.push({
      symbol: ctx.baseSymbol,
      address: ctx.baseToken,
      supplied: baseSupplied,
      suppliedUsd: baseSuppliedUsd.toString(),
      borrowed: baseBorrowed,
      borrowedUsd: baseBorrowedUsd.toString(),
      isCollateral: false,
    });
  }

  collaterals.forEach((coll, i) => {
    const balanceRes = priceResults[1 + (i * 2)];
    const priceRes = priceResults[2 + (i * 2)];
    // The collateral provably existed at `block`, so both reads were expected to succeed. Defaulting
    // either to 0 would drop a real balance and report the shortfall as a genuine number.
    if (balanceRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: balance read failed for ${coll.address} at block ${block}`);
    const supplied = (balanceRes.result as bigint).toString();
    if (supplied === '0') return;
    if (priceRes?.status !== 'success') throw new Error(`CompoundV3 historical balance: no price for ${coll.address} at block ${block}`);

    // Amounts use the Comet's own `scale` rather than `assetAmountInEth`, so a collateral missing
    // from `@defisaver/tokens` still converts correctly instead of yielding NaN.
    const assetSuppliedUsd = new Dec(supplied).div(coll.scale).mul(toUsdPrice(priceRes.result as bigint));
    suppliedUsd = suppliedUsd.add(assetSuppliedUsd);
    suppliedCollateralUsd = suppliedCollateralUsd.add(assetSuppliedUsd);
    assets.push({
      symbol: wethToEth(getAssetInfoByAddress(coll.address, network).symbol),
      address: coll.address,
      supplied,
      suppliedUsd: assetSuppliedUsd.toString(),
      borrowed: '0',
      borrowedUsd: '0',
      isCollateral: true,
    });
  });

  if (!assets.length) return { ...empty, baseAssetUsdPrice: baseAssetUsdPrice.toString() };

  return {
    block,
    market: marketAddress,
    suppliedUsd: suppliedUsd.toString(),
    suppliedCollateralUsd: suppliedCollateralUsd.toString(),
    borrowedUsd: borrowedUsd.toString(),
    netUsd: suppliedUsd.minus(borrowedUsd).toString(),
    baseAssetUsdPrice: baseAssetUsdPrice.toString(),
    assets,
  };
};

export const getCompoundV3HistoricalBalance = async (
  provider: EthereumProvider,
  network: NetworkNumber,
  selectedMarket: CompoundMarketData,
  address: EthAddress,
  block: number,
  context?: CompoundV3HistoricalBalanceContext,
): Promise<CompoundV3HistoricalBalance> => _getCompoundV3HistoricalBalance(getViemProvider(provider, network, { batch: { multicall: true } }), network, selectedMarket, address, block, context);

export const _getCompoundV3AccountData = async (
  provider: Client,
  network: NetworkNumber,
  address: EthAddress,
  proxyAddress: EthAddress,
  extractedState: ({
    selectedMarket: CompoundMarketData,
    assetsData: CompoundV3AssetsData,
  }),
): Promise<CompoundV3PositionData> => {
  if (!address) throw new Error('No address provided');
  const {
    selectedMarket, assetsData,
  } = extractedState;

  let payload = {
    ...EMPTY_COMPOUND_V3_DATA,
    lastUpdated: Date.now(),
  };

  const contract = CompV3ViewContractViem(provider, network);


  const [loanData, isAllowed] = await Promise.all([
    contract.read.getLoanData([selectedMarket.baseMarketAddress, address]),
    contract.read.isAllowed([selectedMarket.baseMarketAddress, address, (proxyAddress || ZERO_ADDRESS)]),
  ]);

  const usedAssets: CompoundV3UsedAssets = {};

  const baseAssetInfo = getAssetInfo(selectedMarket.baseAsset);
  const baseAssetSymbol = wethToEth(selectedMarket.baseAsset);
  usedAssets[baseAssetSymbol] = { ...EMPTY_USED_ASSET, symbol: baseAssetSymbol, collateral: false };
  if (loanData.depositAmount.toString() !== '0') {
    usedAssets[baseAssetSymbol].isSupplied = true;
    usedAssets[baseAssetSymbol].supplied = assetAmountInEth(loanData.depositAmount.toString(), baseAssetInfo.symbol);
    usedAssets[baseAssetSymbol].suppliedUsd = new Dec(assetAmountInEth(loanData.depositValue.toString(), baseAssetInfo.symbol)).mul(assetsData[baseAssetSymbol].price).toString();
  }
  if (loanData.borrowAmount.toString() !== '0') {
    usedAssets[baseAssetSymbol].isBorrowed = true;
    usedAssets[baseAssetSymbol].borrowed = assetAmountInEth(loanData.borrowAmount.toString(), baseAssetInfo.symbol);
    usedAssets[baseAssetSymbol].borrowedUsd = new Dec(
      assetAmountInEth(loanData.borrowValue.toString(), baseAssetInfo.symbol),
    )
      .mul(assetsData[baseAssetSymbol].price)
      .toString();
  }
  const supportedAssetsAddresses = getSupportedAssetsAddressesForMarket(selectedMarket, network);

  loanData.collAddr.forEach((coll: string, i: number): void => {
    // not filtering collAddr because there is no way of knowing how to filter loanData.collAmounts
    if (!supportedAssetsAddresses.includes(coll.toLowerCase())) return;
    const assetInfo = getAssetInfoByAddress(coll, network);
    const symbol = wethToEth(assetInfo.symbol);
    const supplied = assetAmountInEth(loanData.collAmounts[i].toString(), symbol);
    const isSupplied = supplied !== '0';
    const price = assetsData[symbol].price;
    const suppliedUsd = new Dec(supplied).mul(price).toString();
    usedAssets[symbol] = {
      ...usedAssets[symbol],
      borrowed: '0',
      borrowedUsd: '0',
      isSupplied,
      supplied,
      suppliedUsd,
      isBorrowed: false,
      symbol,
      collateral: true,
    };
  });

  payload = {
    ...payload,
    usedAssets,
    ...getCompoundV3AggregatedData({
      usedAssets, assetsData, network, selectedMarket,
    }),
    isAllowed,
  };

  // Calculate borrow limits per asset
  Object.values(payload.usedAssets).forEach((item: any) => {
    if (item.isBorrowed) {
      // eslint-disable-next-line no-param-reassign
      item.limit = calculateBorrowingAssetLimit(item.borrowedUsd, payload.borrowLimitUsd);
    }
  });

  return payload;
};

export const getCompoundV3AccountData = async (
  provider: EthereumProvider,
  network: NetworkNumber,
  address: EthAddress,
  proxyAddress: EthAddress,
  extractedState: ({
    selectedMarket: CompoundMarketData,
    assetsData: CompoundV3AssetsData,
  }),
): Promise<CompoundV3PositionData> => _getCompoundV3AccountData(getViemProvider(provider, network), network, address, proxyAddress, extractedState);

export const getCompoundV3FullPositionData = async (provider: EthereumProvider, network: NetworkNumber, address: EthAddress, proxyAddress: EthAddress, selectedMarket: CompoundMarketData, defaultProvider: EthereumProvider): Promise<CompoundV3PositionData> => {
  const marketData = await getCompoundV3MarketsData(provider, network, selectedMarket, defaultProvider);
  const positionData = await getCompoundV3AccountData(provider, network, address, proxyAddress, { selectedMarket, assetsData: marketData.assetsData });
  return positionData;
};
