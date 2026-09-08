import { Client, PublicClient } from 'viem';
import Dec from 'decimal.js';
import { assetAmountInEth, assetAmountInWei, getAssetInfoByAddress } from '@defisaver/tokens';
import { getViemProvider, setViemBlockNumber } from '../services/viem';
import {
  AaveV4AccountData,
  AaveV4HistoricalBalance,
  AaveV4HistoricalBalanceContext,
  AaveV4HubAssetOnChainData,
  AaveV4HubOnChainData,
  AaveV4ReserveAssetData,
  AaveV4ReserveAssetOnChain,
  AaveV4SpokeData,
  AaveV4SpokeInfo,
  AaveV4UsedReserveAssets,
  EthAddress,
  EthereumProvider,
  IncentiveData,
  IncentiveKind,
  NetworkNumber,
  Blockish,
  PositionBalances,
} from '../types';
import { AaveV4ViewContractViem } from '../contracts';
import { getStakingApy, STAKING_ASSETS } from '../staking';
import {
  compareAddresses, isMaxUint, shortenAddress, wethToEth, wethToEthByAddress,
} from '../services/utils';
import { aaveV4GetAggregatedPositionData, calcUserRiskPremiumBps } from '../helpers/aaveV4Helpers';
import { findAaveV4SpokeByAddress, getAaveV4HubByAddress } from '../markets/aaveV4';
import { aprToApy } from '../moneymarket';
import { attachAaveV4MerklIncentives, getAaveV4MerkleCampaigns } from './merkl';

export * as lend from './lend';
export { getAaveV4MerkleCampaigns } from './merkl';

const fetchHubData = async (viewContract: ReturnType<typeof AaveV4ViewContractViem>, hubAddress: EthAddress, blockNumber: Blockish = 'latest'): Promise<AaveV4HubOnChainData> => {
  const hubData = await viewContract.read.getHubAllAssetsData([hubAddress], setViemBlockNumber(blockNumber));
  return {
    assets: hubData.reduce((acc: Record<number, AaveV4HubAssetOnChainData>, assetOnChainData) => {
      acc[assetOnChainData.assetId] = {
        assetId: assetOnChainData.assetId,
        drawnRate: assetOnChainData.drawnRate,
        liquidity: assetOnChainData.liquidity,
        liquidityFee: assetOnChainData.liquidityFee,
        swept: assetOnChainData.swept,
        totalDrawn: assetOnChainData.totalDrawn,
        totalDrawnShares: assetOnChainData.totalDrawnShares,
        totalPremiumShares: assetOnChainData.totalPremiumShares,
      };
      return acc;
    }, {}),
  };
};


const formatReserveAsset = async (reserveAsset: AaveV4ReserveAssetOnChain, hubAsset: AaveV4HubAssetOnChainData, reserveId: number, oracleDecimals: number, network: NetworkNumber): Promise<AaveV4ReserveAssetData> => {
  const assetInfo = getAssetInfoByAddress(reserveAsset.underlying, network);
  // `@defisaver/tokens` returns a placeholder ('?', decimals NaN) when the underlying is not in the
  // tokens package. Flag it so consumers can render it read-only instead of feeding NaN into amounts.
  const isUnsupported = assetInfo.symbol === '?';
  const symbol = wethToEth(assetInfo.symbol);
  // The hub registry only provides display metadata — a hub missing from it (newly deployed by
  // Aave, SDK not yet updated) must not prevent the reserve from loading, so fall back to a
  // generated label instead of failing.
  const hubInfo = getAaveV4HubByAddress(network, reserveAsset.hub);

  const isStakingAsset = STAKING_ASSETS.includes(symbol);
  const supplyIncentives: IncentiveData[] = [];
  const borrowIncentives: IncentiveData[] = [];

  if (isStakingAsset) {
    const yieldApy = await getStakingApy(symbol, network as NetworkNumber);
    supplyIncentives.push({
      apy: yieldApy,
      token: symbol,
      incentiveKind: IncentiveKind.Staking,
      description: `Native ${symbol} yield.`,
    });
    if (reserveAsset.borrowable) {
      // When borrowing assets whose value increases over time
      borrowIncentives.push({
        apy: new Dec(yieldApy).mul(-1).toString(),
        token: symbol,
        incentiveKind: IncentiveKind.Reward,
        description: `Due to the native yield of ${symbol}, the value of the debt would increase over time.`,
      });
    }
  }

  const totalSuppliedRaw = reserveAsset.totalSupplied ?? 0;
  const totalDrawnRaw = reserveAsset.totalDrawn ?? 0;
  const totalPremiumRaw = reserveAsset.totalPremium ?? 0;
  const totalDebtRaw = reserveAsset.totalDebt ?? 0;
  const supplyCapRaw = reserveAsset.supplyCap ?? 0;
  const borrowCapRaw = reserveAsset.borrowCap ?? 0;

  /** @DEV Hub related calculations */
  const drawnRate = new Dec(hubAsset.drawnRate.toString()).div(new Dec(10).pow(27));
  const borrowApr = drawnRate.mul(100);
  const totalDrawn = new Dec(hubAsset.totalDrawn.toString());
  const liquidity = new Dec(hubAsset.liquidity.toString());
  const swept = new Dec(hubAsset.swept.toString());
  const hubUtilizationDenominator = totalDrawn.add(swept).add(liquidity);
  const hubUtilization = hubUtilizationDenominator.isZero() ? new Dec(0) : totalDrawn.div(hubUtilizationDenominator);
  const liquidityFee = new Dec(hubAsset.liquidityFee.toString()).div(new Dec(10).pow(4));
  const totalDrawnShares = new Dec(hubAsset.totalDrawnShares.toString());
  const totalPremiumShares = new Dec(hubAsset.totalPremiumShares.toString());
  const premiumMultiplier = totalDrawnShares.isZero() ? new Dec(1) : totalDrawnShares.add(totalPremiumShares).div(totalDrawnShares);
  const supplyApr = borrowApr.mul(hubUtilization).mul(premiumMultiplier).mul(new Dec(1).minus(liquidityFee));
  const utilization = hubUtilization.times(100).toString();

  // For unsupported assets `symbol` is '?' (decimals NaN in `@defisaver/tokens`), so the
  // symbol-based conversion would produce NaN. Fall back to the on-chain `decimals` so the reserve
  // still shows correct amounts (and feeds correct USD/ratio/liquidation math) in read-only mode.
  const toEth = (raw: string | number | bigint) => {
    const rawStr = raw.toString();
    if (isMaxUint(rawStr)) return rawStr;
    if (isUnsupported) return new Dec(rawStr || 0).div(new Dec(10).pow(reserveAsset.decimals)).toString();
    return assetAmountInEth(rawStr, symbol);
  };

  const hubLiquidityRaw = hubAsset.liquidity;
  const hubLiquidity = toEth(hubLiquidityRaw.toString());

  return ({
    symbol,
    decimals: reserveAsset.decimals,
    isUnsupported,
    underlying: reserveAsset.underlying,
    hub: hubInfo?.address ?? reserveAsset.hub,
    hubName: hubInfo?.label ?? `Hub ${shortenAddress(reserveAsset.hub)}`,
    assetId: reserveAsset.assetId,
    reserveId,
    paused: reserveAsset.paused,
    frozen: reserveAsset.frozen,
    borrowable: reserveAsset.borrowable,
    collateralRisk: new Dec(reserveAsset.collateralRisk).div(10000).toNumber(),
    collateralFactor: new Dec(reserveAsset.collateralFactor).div(10000).toNumber(),
    liquidationFee: new Dec(reserveAsset.liquidationFee).div(10000).toNumber(),
    maxLiquidationBonus: new Dec(reserveAsset.maxLiquidationBonus).div(10000).toNumber(),
    price: new Dec(reserveAsset.price).div(new Dec(10).pow(oracleDecimals)).toString(),
    totalSupplied: toEth(totalSuppliedRaw.toString()),
    totalDrawn: toEth(totalDrawnRaw.toString()),
    totalPremium: toEth(totalPremiumRaw.toString()),
    totalDebt: toEth(totalDebtRaw.toString()),
    supplyCap: toEth(supplyCapRaw.toString()),
    borrowCap: toEth(borrowCapRaw.toString()),
    spokeActive: reserveAsset.spokeActive,
    spokeHalted: reserveAsset.spokeHalted,
    drawnRate: drawnRate.toString(),
    borrowRate: aprToApy(borrowApr.toString()),
    supplyRate: aprToApy(supplyApr.toString()),
    supplyIncentives,
    borrowIncentives,
    canBeBorrowed: !isUnsupported && reserveAsset.spokeActive && !reserveAsset.spokeHalted && !reserveAsset.paused && !reserveAsset.frozen && reserveAsset.borrowable,
    canBeSupplied: !isUnsupported && reserveAsset.spokeActive && !reserveAsset.spokeHalted && !reserveAsset.paused && !reserveAsset.frozen,
    canBeWithdrawn: !isUnsupported && reserveAsset.spokeActive && !reserveAsset.spokeHalted && !reserveAsset.paused,
    canBePayBacked: !isUnsupported && reserveAsset.spokeActive && !reserveAsset.spokeHalted && !reserveAsset.paused,
    utilization,
    hubLiquidity,
    premiumMultiplier: premiumMultiplier.toString(),
    liquidityFee: liquidityFee.toString(),
  });
};

export async function _getAaveV4SpokeData(provider: Client, network: NetworkNumber, market: AaveV4SpokeInfo, blockNumber: 'latest' | number = 'latest'): Promise<AaveV4SpokeData> {
  const viewContract = AaveV4ViewContractViem(provider, network, blockNumber);

  const hubsData: Record<string, AaveV4HubOnChainData> = {};
  const loadHubData = async (hubAddress: EthAddress) => {
    hubsData[hubAddress.toLowerCase()] = await fetchHubData(viewContract, hubAddress, blockNumber);
  };

  // market.hubs is only a prefetch hint (lets known hubs load in parallel with the spoke data), so
  // failures are tolerated here — any hub the reserves actually reference is (re)fetched below.
  const [spokeData, merklCampaigns] = await Promise.all([
    viewContract.read.getSpokeDataFull([market.address], setViemBlockNumber(blockNumber)),
    getAaveV4MerkleCampaigns(network),
    ...market.hubs.map((hubAddress) => loadHubData(hubAddress).catch(() => {})),
  ]);

  // The on-chain reserves are the source of truth for which hubs the spoke uses — fetch any hub
  // the prefetch didn't cover, so an asset listed from a hub unknown to the SDK can't break the spoke.
  const missingHubs = [...new Set(spokeData[1].map((reserveAsset: AaveV4ReserveAssetOnChain) => reserveAsset.hub.toLowerCase() as EthAddress))]
    .filter((hubAddress) => !hubsData[hubAddress]);
  await Promise.all(missingHubs.map(loadHubData));

  const reserveAssetsArray = (await Promise.all(spokeData[1].map(async (reserveAssetOnChain: AaveV4ReserveAssetOnChain, index: number) => {
    const hubAsset = hubsData[reserveAssetOnChain.hub.toLowerCase()]?.assets[reserveAssetOnChain.assetId];
    // A reserve whose hub-side asset data can't be resolved is skipped instead of failing the
    // whole spoke (position math degrades for that one asset only).
    if (!hubAsset) return null;
    return formatReserveAsset(reserveAssetOnChain, hubAsset, index, +spokeData[0].oracleDecimals.toString(), network);
  }))).filter((asset): asset is AaveV4ReserveAssetData => asset !== null);

  const enrichedAssets = reserveAssetsArray.map((asset) => attachAaveV4MerklIncentives(asset, market.address, merklCampaigns));

  return {
    assetsData: enrichedAssets.reduce((acc: Record<string, AaveV4ReserveAssetData>, reserveAsset: AaveV4ReserveAssetData) => {
      acc[`${reserveAsset.symbol}-${reserveAsset.reserveId}`] = reserveAsset;
      return acc;
    }, {}),
    oracle: spokeData[0].oracle,
    oracleDecimals: +spokeData[0].oracleDecimals.toString(),
    address: market.address,
  };
}

export async function getAaveV4SpokeData(provider: EthereumProvider, network: NetworkNumber, spoke: AaveV4SpokeInfo, blockNumber: 'latest' | number = 'latest'): Promise<AaveV4SpokeData> {
  return _getAaveV4SpokeData(getViemProvider(provider, network), network, spoke, blockNumber);
}

export async function _getAaveV4AccountData(provider: Client, network: NetworkNumber, spokeData: AaveV4SpokeData, address: EthAddress, blockNumber: 'latest' | number = 'latest'): Promise<AaveV4AccountData> {
  const viewContract = AaveV4ViewContractViem(provider, network, blockNumber);

  const loanData = await viewContract.read.getLoanData([spokeData.address, address], setViemBlockNumber(blockNumber));

  const healthFactorFromContract = new Dec(loanData.healthFactor.toString());
  const healthFactor = isMaxUint(healthFactorFromContract.toString()) ? 'Infinity' : healthFactorFromContract.div(1e18).toString();
  const usedAssets = loanData.reserves.reduce((acc: AaveV4UsedReserveAssets, usedReserveAsset) => {
    const assetInfo = getAssetInfoByAddress(usedReserveAsset.underlying, network);
    const isUnsupported = assetInfo.symbol === '?';
    const symbol = wethToEth(assetInfo.symbol);
    const identifier = `${symbol}-${+usedReserveAsset.reserveId.toString()}`;
    const reserveData = spokeData.assetsData[identifier];
    const price = reserveData?.price ?? '0';
    // For unsupported assets the symbol-based conversion yields NaN, so use the on-chain decimals
    // from the reserve data instead. If the reserve is missing entirely we can't convert, so fall
    // back to '0' and keep the entry read-only.
    const toEth = (raw: string) => {
      if (isMaxUint(raw)) return raw;
      if (!reserveData) return '0';
      if (isUnsupported) return new Dec(raw || 0).div(new Dec(10).pow(reserveData.decimals)).toString();
      return assetAmountInEth(raw, reserveData.symbol);
    };
    const supplied = toEth(usedReserveAsset.supplied.toString());
    const drawn = toEth(usedReserveAsset.drawn.toString());
    const premium = toEth(usedReserveAsset.premium.toString());
    const borrowed = toEth(usedReserveAsset.totalDebt.toString());
    acc[identifier] = {
      symbol: reserveData?.symbol ?? symbol,
      hubName: reserveData?.hubName ?? '',
      assetId: reserveData?.assetId ?? 0,
      reserveId: +usedReserveAsset.reserveId.toString(),
      supplied,
      suppliedUsd: new Dec(supplied).mul(price).toString(),
      drawn,
      drawnUsd: new Dec(drawn).mul(price).toString(),
      premium,
      premiumUsd: new Dec(premium).mul(price).toString(),
      borrowed,
      borrowedUsd: new Dec(borrowed).mul(price).toString(),
      isSupplied: !new Dec(supplied).eq(0),
      isBorrowed: usedReserveAsset.isBorrowing,
      collateral: usedReserveAsset.isUsingAsCollateral,
      collateralFactor: new Dec(usedReserveAsset.collateralFactor).div(10000).toNumber(),
      isUnsupported: isUnsupported || !reserveData,
    };
    return acc;
  }, {});

  const aggregated = aaveV4GetAggregatedPositionData({
    usedAssets,
    assetsData: spokeData.assetsData,
    network,
    useUserCollateralFactor: true,
  });

  const riskPremiumBps = calcUserRiskPremiumBps(usedAssets, spokeData.assetsData);

  return {
    ...aggregated,
    usedAssets,
    healthFactor,
    riskPremiumBps,
  };
}

/**
 * Lightweight existence check for Loan Shifter / UI discovery.
 * Reads only `getLoanData(spoke, user)` and returns whether any reserve has
 * non-zero supplied or debt, avoiding full spoke/market data fetches.
 */
export const _getAaveV4AccountHasAnyBalance = async (
  provider: Client,
  network: NetworkNumber,
  block: Blockish,
  address: EthAddress,
  spokeAddress: EthAddress,
): Promise<boolean> => {
  if (!address || !spokeAddress) return false;

  const blockNumber = block === 'latest' ? 'latest' : Number(block);
  const viewContract = AaveV4ViewContractViem(provider, network, blockNumber);

  const loanData = await viewContract.read.getLoanData([spokeAddress, address], setViemBlockNumber(blockNumber));
  const reserves = loanData?.reserves || [];

  return reserves.some((reserveAsset) => {
    const suppliedRaw = reserveAsset?.supplied?.toString?.() ?? reserveAsset?.supplied ?? '0';
    const debtRaw = reserveAsset?.totalDebt?.toString?.() ?? reserveAsset?.totalDebt ?? '0';
    return new Dec(suppliedRaw).gt(0) || new Dec(debtRaw).gt(0);
  });
};

export async function getAaveV4AccountData(provider: EthereumProvider, network: NetworkNumber, marketData: AaveV4SpokeData, address: EthAddress, blockNumber: 'latest' | number = 'latest'): Promise<any> {
  return _getAaveV4AccountData(getViemProvider(provider, network), network, marketData, address, blockNumber);
}

export const _getAaveV4AccountBalances = async (
  provider: Client,
  network: NetworkNumber,
  block: Blockish,
  addressMapping: boolean,
  address: EthAddress,
  spokeAddress: EthAddress,
  spokeData?: AaveV4SpokeData,
): Promise<PositionBalances> => {
  const balances: PositionBalances = {
    collateral: {},
    debt: {},
  };

  if (!address || !spokeAddress) {
    return balances;
  }

  const blockNumber = block === 'latest' ? 'latest' : Number(block);
  let resolvedSpokeData = spokeData;
  if (!resolvedSpokeData) {
    const spokeInfo = findAaveV4SpokeByAddress(network, spokeAddress);
    if (!spokeInfo) {
      return balances;
    }
    resolvedSpokeData = await _getAaveV4SpokeData(provider, network, spokeInfo, blockNumber);
  }

  const accountData = await _getAaveV4AccountData(provider, network, resolvedSpokeData, address, blockNumber);
  const finalSpokeData = resolvedSpokeData;

  Object.entries(accountData.usedAssets).forEach(([key, asset]) => {
    const reserveData = finalSpokeData.assetsData[key];
    if (!reserveData) return;

    const balanceKey = addressMapping
      ? wethToEthByAddress(reserveData.underlying, network).toLowerCase()
      : wethToEth(asset.symbol);

    if (asset.isSupplied && new Dec(asset.supplied || 0).gt(0)) {
      balances.collateral![balanceKey] = assetAmountInWei(asset.supplied, asset.symbol);
    }
    if (asset.isBorrowed && new Dec(asset.borrowed || 0).gt(0)) {
      balances.debt![balanceKey] = assetAmountInWei(asset.borrowed, asset.symbol);
    }
  });

  return balances;
};

export const getAaveV4AccountBalances = async (
  provider: EthereumProvider,
  network: NetworkNumber,
  block: Blockish,
  addressMapping: boolean,
  address: EthAddress,
  spokeAddress: EthAddress,
  spokeData?: AaveV4SpokeData,
): Promise<PositionBalances> => _getAaveV4AccountBalances(
  getViemProvider(provider, network),
  network,
  block,
  addressMapping,
  address,
  spokeAddress,
  spokeData,
);

/**
 * Historical net-balance helpers that bypass the AaveV4View contract.
 *
 * The View contract (and therefore `getAaveV4AccountData` / `getAaveV4AccountBalances`) can only be
 * queried from its deployment block onwards. On mainnet that is block 25144919, while the Aave v4
 * hubs and spokes went live at 24720899 — a ~59 day window of real position history the View can't
 * reach. The Spoke itself exposes accrued, asset-denominated user getters (no share math to redo
 * client-side), so reading those directly reaches back to the spoke's own deployment and costs
 * 1 multicall per point. Used to build a position balance-history chart.
 *
 * Failure policy: every point is either fully priced or throws. A partially-read point would render
 * as a believable dip in the chart rather than as a gap, which is worse than no point at all, so any
 * read that fails for a reserve that provably existed at the block is surfaced as an error.
 */

// Minimal Aave v4 Spoke ABI. `type ReserveFlags is uint8` so the Reserve tuple decodes as plain uint8.
const AAVE_V4_SPOKE_ABI = [
  {
    inputs: [], name: 'getReserveCount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [], name: 'ORACLE', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'reserveId', type: 'uint256' }],
    name: 'getReserve',
    outputs: [{
      components: [
        { name: 'underlying', type: 'address' },
        { name: 'hub', type: 'address' },
        { name: 'assetId', type: 'uint16' },
        { name: 'decimals', type: 'uint8' },
        { name: 'collateralRisk', type: 'uint24' },
        { name: 'flags', type: 'uint8' },
        { name: 'dynamicConfigKey', type: 'uint32' },
      ],
      type: 'tuple',
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'reserveId', type: 'uint256' }, { name: 'user', type: 'address' }],
    name: 'getUserSuppliedAssets',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'reserveId', type: 'uint256' }, { name: 'user', type: 'address' }],
    name: 'getUserTotalDebt',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'reserveId', type: 'uint256' }, { name: 'user', type: 'address' }],
    name: 'getUserDebt',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }], // (drawn, premium)
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'reserveId', type: 'uint256' }, { name: 'user', type: 'address' }],
    name: 'getUserReserveStatus',
    outputs: [{ type: 'bool' }, { type: 'bool' }], // (isUsingAsCollateral, isBorrowing)
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Minimal Aave v4 AaveOracle ABI. Prices are keyed by reserveId, not by underlying address.
const AAVE_V4_ORACLE_ABI = [
  {
    inputs: [{ name: 'reserveId', type: 'uint256' }], name: 'getReservePrice', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
] as const;

/**
 * Fetches the reserve list and oracle for a spoke. Reserve ids are append-only and the Spoke's
 * ORACLE is immutable, so this is read at head once and reused across all history points.
 */
export const _getAaveV4HistoricalBalanceContext = async (provider: Client, network: NetworkNumber, spoke: AaveV4SpokeInfo): Promise<AaveV4HistoricalBalanceContext> => {
  const spokeAddress = spoke.address as EthAddress;

  const [reserveCountRes, oracleRes] = await (provider as PublicClient).multicall({
    contracts: [
      { address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getReserveCount' },
      { address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'ORACLE' },
    ],
    allowFailure: true,
  });

  if (reserveCountRes.status !== 'success') throw new Error(`AaveV4 historical balance: could not read reserve count for spoke ${spokeAddress}`);
  if (oracleRes.status !== 'success') throw new Error(`AaveV4 historical balance: could not read oracle for spoke ${spokeAddress}`);

  const reserveCount = Number(reserveCountRes.result);
  const oracle = oracleRes.result as EthAddress;
  const reserveIds = Array.from({ length: reserveCount }, (_, i) => i);

  // Mixed-ABI multicalls don't infer as a heterogeneous tuple, hence the `any[]` on the call list.
  const metaContracts: any[] = [
    // The Spoke constructor pins oracle decimals to 8, but read it rather than assume it — the
    // v3 history helper hardcodes its divisor and that is the one thing worth not copying.
    { address: oracle, abi: AAVE_V4_ORACLE_ABI, functionName: 'decimals' },
    ...reserveIds.map((reserveId) => ({
      address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getReserve', args: [BigInt(reserveId)],
    })),
  ];

  const results = await (provider as PublicClient).multicall({ contracts: metaContracts, allowFailure: true });

  const [oracleDecimalsRes, ...reserveResults] = results;
  if (oracleDecimalsRes.status !== 'success') throw new Error(`AaveV4 historical balance: could not read oracle decimals for spoke ${spokeAddress}`);

  // Every id below the count exists at head, so a failed read here is a genuine failure. Dropping
  // it would quietly remove that reserve from every history point built on this context.
  const failedIds = reserveIds.filter((_, i) => reserveResults[i].status !== 'success' || !reserveResults[i].result);
  if (failedIds.length) throw new Error(`AaveV4 historical balance: could not read reserves ${failedIds.join(', ')} for spoke ${spokeAddress}`);

  const reserves = reserveResults.map((res, i) => {
    const reserve = res.result as { underlying: EthAddress, decimals: number };
    return { reserveId: reserveIds[i], underlying: reserve.underlying, decimals: Number(reserve.decimals) };
  });

  if (!reserves.length) throw new Error(`AaveV4 historical balance: no reserves found for spoke ${spokeAddress}`);

  return {
    spokeAddress, oracle, oracleDecimals: Number(oracleDecimalsRes.result), reserves,
  };
};

export const getAaveV4HistoricalBalanceContext = async (provider: EthereumProvider, network: NetworkNumber, spoke: AaveV4SpokeInfo): Promise<AaveV4HistoricalBalanceContext> => _getAaveV4HistoricalBalanceContext(getViemProvider(provider, network, { batch: { multicall: true } }), network, spoke);

/**
 * Computes a user's Aave v4 net USD balance (supplied - borrowed) on one spoke at a historical
 * block, without touching the AaveV4View contract. Pass `context` (from
 * getAaveV4HistoricalBalanceContext) to avoid refetching the reserve list for every point.
 */
export const _getAaveV4HistoricalBalance = async (
  provider: Client,
  network: NetworkNumber,
  spoke: AaveV4SpokeInfo,
  address: EthAddress,
  block: number,
  context?: AaveV4HistoricalBalanceContext,
): Promise<AaveV4HistoricalBalance> => {
  const empty: AaveV4HistoricalBalance = {
    block,
    spoke: spoke.address as EthAddress,
    suppliedUsd: '0',
    suppliedCollateralUsd: '0',
    borrowedUsd: '0',
    drawnUsd: '0',
    premiumUsd: '0',
    netUsd: '0',
  };
  if (!address) return empty;

  const ctx = context || await _getAaveV4HistoricalBalanceContext(provider, network, spoke);
  const { spokeAddress, oracle, reserves } = ctx;
  // A context built for another spoke would be read instead of `spoke` while the result is labelled
  // with `spoke` — easy to do when looping spokes for a chart and reusing one context.
  if (!compareAddresses(spoke.address, spokeAddress)) throw new Error(`AaveV4 historical balance: context is for spoke ${spokeAddress}, not ${spoke.address}`);
  const blockNumber = BigInt(block);

  // One multicall for the whole point. The two leading calls establish what was actually readable at
  // `block`: `getReserveCount` bounds the reserve ids that existed then (ids are append-only), and
  // `ORACLE` confirms the cached head-read oracle was already the one in use. Then, per reserve, the
  // user's supply, total debt, debt split, collateral flag and price.
  const contracts = [
    {
      address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getReserveCount' as const,
    },
    {
      address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'ORACLE' as const,
    },
    ...reserves.flatMap((reserve) => {
      const args = [BigInt(reserve.reserveId), address] as const;
      return [
        {
          address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getUserSuppliedAssets' as const, args,
        },
        {
          address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getUserTotalDebt' as const, args,
        },
        {
          address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getUserDebt' as const, args,
        },
        {
          address: spokeAddress, abi: AAVE_V4_SPOKE_ABI, functionName: 'getUserReserveStatus' as const, args,
        },
        {
          address: oracle, abi: AAVE_V4_ORACLE_ABI, functionName: 'getReservePrice' as const, args: [BigInt(reserve.reserveId)] as const,
        },
      ];
    }),
  ];

  const results = await (provider as PublicClient).multicall({ contracts, allowFailure: true, blockNumber });

  const PREFIX_CALLS = 2;
  const CALLS_PER_RESERVE = 5;

  // The spoke had no code at `block` (or the archive node couldn't serve it) — a gap, not a real
  // $0 balance, so throw and let the caller render it as one.
  const reserveCountRes = results[0];
  if (reserveCountRes?.status !== 'success') throw new Error(`AaveV4 historical balance: all balance reads failed at block ${block}`);
  const reserveCountAtBlock = Number(reserveCountRes.result);

  // The cached oracle is read at head. If the spoke were ever to point somewhere else at `block`,
  // every price here would be silently wrong, so fail loudly instead of trusting the immutable.
  const oracleAtBlockRes = results[1];
  if (oracleAtBlockRes?.status !== 'success') throw new Error(`AaveV4 historical balance: could not read oracle at block ${block}`);
  if (!compareAddresses(oracleAtBlockRes.result as string, oracle)) throw new Error(`AaveV4 historical balance: spoke used oracle ${oracleAtBlockRes.result} at block ${block}, not the cached ${oracle}`);

  // Amounts use the Spoke's own decimals rather than `assetAmountInEth`, so a reserve whose
  // underlying is missing from `@defisaver/tokens` still converts correctly instead of yielding NaN.
  const toEth = (raw: string, decimals: number) => (isMaxUint(raw) ? '0' : new Dec(raw || 0).div(new Dec(10).pow(decimals)).toString());

  const activeAssets = reserves.map((reserve, i) => {
    // `reserves` comes from head, so ids at or beyond the count are reserves added after `block`.
    // Their reads are expected to fail and they held no balance then.
    if (reserve.reserveId >= reserveCountAtBlock) return null;

    const offset = PREFIX_CALLS + (i * CALLS_PER_RESERVE);
    const suppliedRes = results[offset];
    const borrowedRes = results[offset + 1];
    // The reserve provably existed at `block`, so these were readable. Defaulting a failure to '0'
    // would drop a real balance out of the totals and report the shortfall as a genuine number.
    if (suppliedRes?.status !== 'success' || borrowedRes?.status !== 'success') throw new Error(`AaveV4 historical balance: balance read failed for reserve ${reserve.reserveId} at block ${block}`);

    const supplied = toEth((suppliedRes.result as bigint).toString(), reserve.decimals);
    const borrowed = toEth((borrowedRes.result as bigint).toString(), reserve.decimals);
    if (new Dec(supplied).eq(0) && new Dec(borrowed).eq(0)) return null;

    // The user holds a real position in this reserve, so the rest of its reads must have succeeded
    // too — a missing debt split, collateral flag or price would skew the point without a trace.
    const debtSplitRes = results[offset + 2];
    const statusRes = results[offset + 3];
    const priceRes = results[offset + 4];
    if (debtSplitRes?.status !== 'success' || statusRes?.status !== 'success') throw new Error(`AaveV4 historical balance: incomplete read for reserve ${reserve.reserveId} at block ${block}`);
    if (priceRes?.status !== 'success') throw new Error(`AaveV4 historical balance: no price for reserve ${reserve.reserveId} at block ${block}`);

    const [drawnRaw, premiumRaw] = debtSplitRes.result as [bigint, bigint];

    return {
      supplied,
      borrowed,
      drawn: toEth(drawnRaw.toString(), reserve.decimals),
      premium: toEth(premiumRaw.toString(), reserve.decimals),
      isCollateral: (statusRes.result as [boolean, boolean])[0],
      price: (priceRes.result as bigint).toString(),
    };
  }).filter((a): a is NonNullable<typeof a> => a !== null);

  if (!activeAssets.length) return empty;

  let suppliedUsd = new Dec(0);
  let suppliedCollateralUsd = new Dec(0);
  let borrowedUsd = new Dec(0);
  let drawnUsd = new Dec(0);
  let premiumUsd = new Dec(0);

  activeAssets.forEach((a) => {
    const priceUsd = new Dec(a.price).div(new Dec(10).pow(ctx.oracleDecimals));
    const suppliedAssetUsd = new Dec(a.supplied).mul(priceUsd);
    suppliedUsd = suppliedUsd.add(suppliedAssetUsd);
    if (a.isCollateral) suppliedCollateralUsd = suppliedCollateralUsd.add(suppliedAssetUsd);
    borrowedUsd = borrowedUsd.add(new Dec(a.borrowed).mul(priceUsd));
    drawnUsd = drawnUsd.add(new Dec(a.drawn).mul(priceUsd));
    premiumUsd = premiumUsd.add(new Dec(a.premium).mul(priceUsd));
  });

  return {
    block,
    spoke: spokeAddress,
    suppliedUsd: suppliedUsd.toString(),
    suppliedCollateralUsd: suppliedCollateralUsd.toString(),
    borrowedUsd: borrowedUsd.toString(),
    drawnUsd: drawnUsd.toString(),
    premiumUsd: premiumUsd.toString(),
    netUsd: suppliedUsd.minus(borrowedUsd).toString(),
  };
};

export const getAaveV4HistoricalBalance = async (
  provider: EthereumProvider,
  network: NetworkNumber,
  spoke: AaveV4SpokeInfo,
  address: EthAddress,
  block: number,
  context?: AaveV4HistoricalBalanceContext,
): Promise<AaveV4HistoricalBalance> => _getAaveV4HistoricalBalance(getViemProvider(provider, network, { batch: { multicall: true } }), network, spoke, address, block, context);

const _getAaveV4UnderlyingFromReserveId = async (provider: Client, network: NetworkNumber, spoke: EthAddress, reserveId: number): Promise<any> => {
  const viewContract = AaveV4ViewContractViem(provider, network);

  const reserveData = await viewContract.read.getReserveData([spoke, BigInt(reserveId)]);

  return reserveData.underlying;
};

export async function getAaveV4UnderlyingFromReserveId(provider: EthereumProvider, network: NetworkNumber, spoke: EthAddress, reserveId: number): Promise<any> {
  return _getAaveV4UnderlyingFromReserveId(getViemProvider(provider, network), network, spoke, reserveId);
}