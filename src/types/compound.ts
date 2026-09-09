import {
  EthAddress,
  HistoricalBalance,
  LeverageType,
  MMAssetData,
  MMPositionData,
  MMUsedAsset,
  NetworkNumber,
} from './common';

export enum CompoundVersions {
  'CompoundV2' = 'v2',
  'CompoundV3USDC' = 'v3-USDC',
  'CompoundV3USDCe' = 'v3-USDC.e',
  'CompoundV3ETH' = 'v3-ETH',
  'CompoundV3USDbC' = 'v3-USDbC',
  'CompoundV3USDT' = 'v3-USDT',
  'CompoundV3USDS' = 'v3-USDS',
  'CompoundV3wstETH' = 'v3-wstETH',
}

export enum CompoundVersionType {
  V2 = 'v2',
  V3 = 'v3',
}

export interface CompoundBulkerOptions {
  supply: number | string,
  withdraw: number | string,
}

export interface CompoundMarketData {
  chainIds: NetworkNumber[],
  label: string,
  shortLabel: string,
  value: CompoundVersions,
  baseAsset: string,
  collAssets: readonly string[],
  baseMarket: string,
  baseMarketAddress: EthAddress,
  secondLabel: string,
  bulkerName: string,
  bulkerAddress: EthAddress,
  bulkerOptions: CompoundBulkerOptions,
  // icon: Function,
}

export interface CompoundUsedAsset extends MMUsedAsset {
  collateral: boolean,
  limit?: string,
}

export interface CompoundV2UsedAsset extends CompoundUsedAsset {
}
export interface CompoundV3UsedAsset extends CompoundUsedAsset {
}

export interface CompoundUsedAssets<T> {
  [token: string]: T,
}

export type CompoundV2UsedAssets = CompoundUsedAssets<CompoundV2UsedAsset>;
export type CompoundV3UsedAssets = CompoundUsedAssets<CompoundV3UsedAsset>;

export interface CompoundAssetData extends MMAssetData {
  supplyCapAlternative?: string,
  totalSupplyAlternative?: string,
  sortIndex?: number,
}

export interface CompoundV2AssetData extends CompoundAssetData {
}
export interface CompoundV3AssetData extends CompoundAssetData {
  borrowCollateralFactor: string,
  liquidateCollateralFactor: string,
  liquidationFactor: string,
  minDebt: string,
  supplyReserved: string,
  liquidationRatio: string,
  supplyCap: string,
  priceInBaseAsset: string,
  canBeWithdrawn: boolean,
}

export interface CompoundAssetsData<T> {
  [token: string]: T
}
export type CompoundV2AssetsData = CompoundAssetsData<CompoundV2AssetData>;
export type CompoundV3AssetsData = CompoundAssetsData<CompoundV3AssetData>;

export type CompoundMarketsData<T> = { assetsData: T };
export type CompoundV2MarketsData = CompoundMarketsData<CompoundV2AssetsData>;
export type CompoundV3MarketsData = CompoundMarketsData<CompoundV3AssetsData> & { isMarketSupplyPaused: boolean, isMarketWithdrawPaused: boolean, isMarketBorrowPaused: boolean };

export interface BaseAdditionalAssetData {
  totalBorrow: string,
  utilization: string,
  marketLiquidity: string,
  rewardSupplySpeed: string,
  rewardBorrowSpeed: string,
  minDebt: string,
  isBase: boolean,
}

export interface CompoundAggregatedPositionData {
  suppliedUsd: string,
  suppliedCollateralUsd: string,
  borrowedUsd: string,
  borrowLimitUsd: string,
  liquidationLimitUsd: string,
  leftToBorrowUsd: string,
  ratio: string,
  collRatio: string,
  netApy: string,
  incentiveUsd: string,
  totalInterestUsd: string,
  liqRatio: string,
  liqPercent: string,
  leveragedType: LeverageType,
  leveragedAsset?: string,
  currentVolatilePairRatio?: string,
  liquidationPrice?: string,
  minRatio: string,
  debtTooLow: boolean,
  minDebt: string,
  minCollRatio: string,
  collLiquidationRatio: string,
  exposure: string,
}

export interface CompoundPositionData extends MMPositionData {
  ratio: string,
  minRatio: string,
  suppliedUsd: string,
  borrowedUsd: string,
  borrowLimitUsd: string,
  incentiveUsd: string,
  totalInterestUsd: string,
  isSubscribedToAutomation?: boolean,
  automationResubscribeRequired?: boolean,
}

export interface CompoundV2PositionData extends CompoundPositionData {
  usedAssets: CompoundV2UsedAssets,
}

export interface CompoundV3PositionData extends CompoundPositionData {
  usedAssets: CompoundV3UsedAssets,
}

/**
 * One asset of a historical point. `supplied` and `borrowed` are raw underlying amounts (wei), the
 * same unit `getCompoundV3AccountBalances` returns, so a point can be checked against the View at
 * the same block. `symbol` is best-effort and never used for math.
 */
export interface CompoundHistoricalBalanceAsset {
  symbol: string,
  address: EthAddress,
  supplied: string,
  suppliedUsd: string,
  borrowed: string,
  borrowedUsd: string,
  isCollateral: boolean,
}

/**
 * Per-market data needed to price a historical Compound v3 position. Only genuinely immutable
 * values live here — the collateral list and price feeds are read per point, because governance
 * rotates both and a chart spanning such a change must stay correct.
 */
export interface CompoundV3HistoricalBalanceContext {
  marketAddress: EthAddress,
  baseToken: EthAddress,
  baseSymbol: string,
  /** Base token decimals as reported by the Comet, independent of `@defisaver/tokens`. */
  baseDecimals: number,
  /** Decimals of every price feed in the market; the Comet's constructor enforces one value. */
  priceFeedDecimals: number,
  /** Collateral count at head, the upper bound for the per-point probe. */
  numAssets: number,
}

export interface CompoundV3HistoricalBalance extends HistoricalBalance {
  market: EthAddress,
  /** Only the collateral; excludes a base-asset deposit, which Compound v3 cannot borrow against. */
  suppliedCollateralUsd: string,
  /** USD price of the market's base asset at the block, the scalar that converts the whole point. */
  baseAssetUsdPrice: string,
  assets: CompoundHistoricalBalanceAsset[],
}
