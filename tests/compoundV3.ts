import 'dotenv/config';

import * as sdk from '../src';

import {
  Blockish, EthAddress, EthereumProvider, NetworkNumber,
} from '../src/types/common';
import { getProvider } from './utils/getProvider';
import { ZERO_ADDRESS } from '../src/constants';

const { assert } = require('chai');

describe('Compound v3', () => {
  let provider: EthereumProvider;
  let providerBase: EthereumProvider;
  let providerOpt: EthereumProvider;
  let providerArb: EthereumProvider;
  before(async () => {
    provider = getProvider('RPC');
    providerOpt = getProvider('RPCOPT');
    providerBase = getProvider('RPCBASE');
    providerArb = getProvider('RPCARB');
  });

  const fetchMarketData = async (network: NetworkNumber, _provider: EthereumProvider, selectedMarket: sdk.CompoundMarketData) => {
    const marketData = await sdk.compoundV3.getCompoundV3MarketsData(_provider, network, selectedMarket, provider);
    assert.containsAllKeys(marketData, ['assetsData']);
    for (const tokenData of Object.values(marketData.assetsData)) {
      const keys: (keyof typeof tokenData)[] = [
        'symbol', 'supplyRate', 'borrowRate', 'price', // ...
      ];
      assert.containsAllKeys(tokenData, keys);
      for (const key of keys) assert.isDefined(tokenData[key], `${key} is undefined for ${tokenData.symbol}`);
    }
    return marketData;
  };

  const fetchAccountData = async (network: NetworkNumber, _provider: EthereumProvider, marketData: sdk.CompoundV3MarketsData, selectedMarket: sdk.CompoundMarketData) => {
    const accountData = await sdk.compoundV3.getCompoundV3AccountData(_provider, network, '0x8f02A8ecD8734381795FF251360DBf1730Cb46E6', ZERO_ADDRESS, { selectedMarket, assetsData: marketData.assetsData });
    // console.log(accountData);
    assert.containsAllKeys(accountData, [
      'usedAssets', 'suppliedUsd', 'borrowedUsd', 'ratio', // ...
    ]);
  };

  const fetchFullPositionData = async (network: NetworkNumber, _provider: EthereumProvider, selectedMarket: sdk.CompoundMarketData) => {
    const positionData = await sdk.compoundV3.getCompoundV3FullPositionData(_provider, network, '0x9cCf93089cb14F94BAeB8822F8CeFfd91Bd71649', ZERO_ADDRESS, selectedMarket, provider);
    // console.log(positionData);
    assert.containsAllKeys(positionData, [
      'usedAssets', 'suppliedUsd', 'borrowedUsd', 'ratio', // ...
    ]);
  };

  const fetchAccountBalances = async (network: NetworkNumber, _provider: EthereumProvider, blockNumber: Blockish, marketAddr: EthAddress) => {
    const balances = await sdk.compoundV3.getCompoundV3AccountBalances(_provider, network, blockNumber, false, '0x9cCf93089cb14F94BAeB8822F8CeFfd91Bd71649', marketAddr);
    // console.log(balances);
    assert.containsAllKeys(balances, [
      'collateral', 'debt',
    ]);
  };

  // Ethereum

  it('can fetch market and account data for ETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3ETH];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch full position data for ETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3ETH];

    await fetchFullPositionData(network, provider, selectedMarket);
  });

  it('can fetch market and account data for USDC Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDC];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch full position data for USDC Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDC];

    await fetchFullPositionData(network, provider, selectedMarket);
  });

  it('can fetch market and account data for USDT Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDT];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch full position data for USDT Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDT];

    await fetchFullPositionData(network, provider, selectedMarket);
  });

  it('can fetch market and account data for wstETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3wstETH];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch full position data for wstETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3wstETH];

    await fetchFullPositionData(network, provider, selectedMarket);
  });

  it('can fetch market and account data for wstETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDS];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch full position data for wstETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDS];

    await fetchFullPositionData(network, provider, selectedMarket);
  });

  it('can fetch latest account balances for ETH Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    await fetchAccountBalances(network, provider, 'latest', '0xa17581a9e3356d9a858b789d68b4d866e593ae94');
  });

  it('can fetch past account balances for USDC Market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    await fetchAccountBalances(network, provider, 18000000, '0xc3d688B66703497DAA19211EEdff47f25384cdc3');
  });

  // Arbitrum

  it('can fetch market and account data for ETH Market on Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3ETH];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });

  it('can fetch market and account data for USDT Market on Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDT];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });

  it('can fetch market and account data for USDC Market on Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDC];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });

  // Optimism

  it('can fetch market and account data for ETH Market on Optimism', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Opt;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3ETH];

    const marketData = await fetchMarketData(network, providerOpt, selectedMarket);
    await fetchAccountData(network, providerOpt, marketData, selectedMarket);
  });

  it('can fetch market and account data for USDT Market on Optimism', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Opt;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDT];

    const marketData = await fetchMarketData(network, providerOpt, selectedMarket);
    await fetchAccountData(network, providerOpt, marketData, selectedMarket);
  });

  // Base

  it('can fetch market and account data for ETH Market on Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3ETH];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch full position data for ETH Market on Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3ETH];

    await fetchFullPositionData(network, providerBase, selectedMarket);
  });

  it('can fetch market and account data for USDbC Market on Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDbC];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch full position data for USDC Market on Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDbC];

    await fetchFullPositionData(network, providerBase, selectedMarket);
  });

  it('can fetch latest account balances for ETH Market on Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;

    await fetchAccountBalances(network, providerBase, 'latest', '0x46e6b214b524310239732D51387075E0e70970bf');
  });

  it('can fetch market and account data for USDS Market on Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.CompoundMarkets(network)[sdk.CompoundVersions.CompoundV3USDS];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  // Historical balances. Every fixture is pinned to a fixed block, so both the amounts and the
  // prices behind them are immutable — these assertions are reproducible, not time-dependent.
  // They need an archive RPC.
  describe('historical balance', () => {
    // cUSDCv3 went live at 15331586; the oldest CompV3View this SDK knows about is at 15520449.
    // Blocks in between are exactly what the View-based path cannot serve and this path can.
    const CUSDC_V3_DEPLOY_BLOCK = 15331586;
    const OLDEST_COMP_V3_VIEW_BLOCK = 15520449;
    const PRE_VIEW_BLOCK = 15450000;
    const PRE_VIEW_USER = '0xcfc50541c3dEaf725ce738EF87Ace2Ad778Ba0C5' as sdk.EthAddress;
    // A USDC-market position the View can also read, so the two paths can be compared.
    const USDC_USER = '0x8f02A8ecD8734381795FF251360DBf1730Cb46E6' as sdk.EthAddress;
    const USDC_BLOCK = 20000000;
    // The ETH and wstETH markets quote their price feeds in the base asset rather than in USD, so
    // they exercise the Chainlink conversion the stablecoin markets never touch.
    const ETH_MARKET_USER = '0xf03852F5123E6c10F53c6ec976AC79a66982d020' as sdk.EthAddress;
    const WSTETH_MARKET_USER = '0x5d5Cec405c4655cb1C26C4285181E51D41252314' as sdk.EthAddress;
    const NON_USD_MARKET_BLOCK = 23500000;

    const market = (version: sdk.CompoundVersions, networkId = NetworkNumber.Eth) => sdk.markets.CompoundMarkets(networkId)[version];
    const usdcMarket = () => market(sdk.CompoundVersions.CompoundV3USDC);

    /**
     * The amounts are the risky half of a point — the USD figures are just a multiplication on top —
     * and the View reads the same Comet at the same block by a different route, so it is the one
     * independent check available. `getCompoundV3AccountData` cannot be pinned to a block, so it
     * can't stand in for this.
     */
    const assertAmountsMatchView = async (selectedMarket: sdk.CompoundMarketData, address: sdk.EthAddress, block: number, historical: sdk.CompoundV3HistoricalBalance) => {
      const balances = await sdk.compoundV3.getCompoundV3AccountBalances(provider, NetworkNumber.Eth, block, false, address, selectedMarket.baseMarketAddress);
      assert.isNotEmpty(historical.assets, 'fixture holds no position at this block');
      historical.assets.forEach((asset) => {
        if (asset.supplied !== '0') assert.equal(balances.collateral?.[asset.symbol], asset.supplied, `${asset.symbol} supplied`);
        if (asset.borrowed !== '0') assert.equal(balances.debt?.[asset.symbol], asset.borrowed, `${asset.symbol} borrowed`);
      });
    };

    it('reads a position from before any known CompV3View was deployed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      assert.isBelow(PRE_VIEW_BLOCK, OLDEST_COMP_V3_VIEW_BLOCK);
      assert.isAbove(PRE_VIEW_BLOCK, CUSDC_V3_DEPLOY_BLOCK);

      const historical = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, usdcMarket(), PRE_VIEW_USER, PRE_VIEW_BLOCK);

      // 74411 COMP, 889.5 ETH and 100542 LINK against a 3.09M USDC borrow, at Sept 2022 prices
      // (ETH ~$1554, COMP ~$46, LINK ~$6.60). Pinned rather than merely non-zero: at a fixed block
      // these are immutable, and a wrong divisor anywhere in the chain moves them by orders of
      // magnitude while still leaving them positive.
      assert.closeTo(Number(historical.suppliedUsd), 5490647, 5490647 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 3091856, 3091856 * 0.005);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
      assert.equal(historical.block, PRE_VIEW_BLOCK);

      // The View genuinely cannot serve this block — that is the whole reason this path exists.
      let viewFailed = false;
      try {
        await sdk.compoundV3.getCompoundV3AccountBalances(provider, network, PRE_VIEW_BLOCK, false, PRE_VIEW_USER, usdcMarket().baseMarketAddress);
      } catch (e) { viewFailed = true; }
      assert.isTrue(viewFailed, 'expected CompV3View to be unreadable before its deployment block');
    });

    it('matches the View amounts in a USD-quoted market', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = usdcMarket();

      const historical = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, selectedMarket, USDC_USER, USDC_BLOCK);
      await assertAmountsMatchView(selectedMarket, USDC_USER, USDC_BLOCK, historical);

      // A USDC market quotes its feeds in USD already, so the scalar is just USDC's own peg.
      assert.closeTo(Number(historical.baseAssetUsdPrice), 1, 0.02);
      // 3521 UNI at ~$9.90 against a 24607 USDC borrow, June 2024.
      assert.closeTo(Number(historical.suppliedUsd), 34874, 34874 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 24608, 24608 * 0.005);
      // The base asset is borrowed here, so none of the supply is base and all of it is collateral.
      assert.equal(historical.suppliedCollateralUsd, historical.suppliedUsd);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
    });

    it('converts an ETH-quoted market to USD', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = market(sdk.CompoundVersions.CompoundV3ETH);

      const historical = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, selectedMarket, ETH_MARKET_USER, NON_USD_MARKET_BLOCK);
      await assertAmountsMatchView(selectedMarket, ETH_MARKET_USER, NON_USD_MARKET_BLOCK, historical);

      // ETH was ~$4546 at this block. Without the Chainlink leg every figure here would come out in
      // ETH and read as single-digit dollars, so pin the scalar rather than only the totals.
      assert.closeTo(Number(historical.baseAssetUsdPrice), 4545.64, 1);
      // 3.009 WBTC at ~$122.7k against a 55.36 ETH borrow. The collateral leg is priced by a
      // WBTC/ETH feed, so it only lands here if the conversion is applied to collateral too.
      assert.closeTo(Number(historical.suppliedUsd), 369190, 369190 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 251637, 251637 * 0.005);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
    });

    it('converts a wstETH-quoted market to USD', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = market(sdk.CompoundVersions.CompoundV3wstETH);

      const historical = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, selectedMarket, WSTETH_MARKET_USER, NON_USD_MARKET_BLOCK);
      await assertAmountsMatchView(selectedMarket, WSTETH_MARKET_USER, NON_USD_MARKET_BLOCK, historical);

      // wstETH is ETH priced through the staking rate, ~1.215 ETH at this block. A conversion that
      // dropped the rate leg would land on the ETH price instead, which this tolerance excludes.
      assert.closeTo(Number(historical.baseAssetUsdPrice), 5521.71, 2);
      // 170.4 rsETH against a 131.2 wstETH borrow.
      assert.closeTo(Number(historical.suppliedUsd), 817291, 817291 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 724654, 724654 * 0.005);
    });

    it('returns zeros for an address with no position', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      const historical = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, usdcMarket(), '0x000000000000000000000000000000000000dEaD' as sdk.EthAddress, USDC_BLOCK);
      assert.equal(historical.suppliedUsd, '0');
      assert.equal(historical.borrowedUsd, '0');
      assert.equal(historical.netUsd, '0');
      assert.isEmpty(historical.assets);
      assert.equal(historical.block, USDC_BLOCK);
    });

    it('produces the same result with and without a prefetched context', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = usdcMarket();

      const context = await sdk.compoundV3.getCompoundV3HistoricalBalanceContext(provider, network, selectedMarket);
      assert.isAbove(context.numAssets, 0);
      assert.isAbove(context.baseDecimals, 0);
      // Read from the base feed rather than assumed, so just sanity-check it — pinning the value
      // here would re-introduce the hardcoded divisor the implementation deliberately avoids.
      assert.isAbove(context.priceFeedDecimals, 0);

      const withContext = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, selectedMarket, USDC_USER, USDC_BLOCK, context);
      const withoutContext = await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, selectedMarket, USDC_USER, USDC_BLOCK);
      assert.deepEqual(withContext, withoutContext);
    });

    it('rejects a context built for a different market', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      // Reusing one context across a multi-market loop would otherwise read the context's market and
      // label the result with the loop's market.
      const context = await sdk.compoundV3.getCompoundV3HistoricalBalanceContext(provider, network, market(sdk.CompoundVersions.CompoundV3ETH));

      let message = '';
      try {
        await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, usdcMarket(), USDC_USER, USDC_BLOCK, context);
      } catch (e) { message = (e as Error).message; }
      assert.include(message, 'context is for market');
    });

    it('throws rather than reporting $0 for a block before the market existed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = usdcMarket();
      const context = await sdk.compoundV3.getCompoundV3HistoricalBalanceContext(provider, network, selectedMarket);

      // The caller renders a gap in the chart from the throw; a $0 point here would instead draw a
      // believable crash to zero for every position that predates the market.
      let message = '';
      try {
        await sdk.compoundV3.getCompoundV3HistoricalBalance(provider, network, selectedMarket, PRE_VIEW_USER, CUSDC_V3_DEPLOY_BLOCK - 1000, context);
      } catch (e) { message = (e as Error).message; }
      assert.include(message, 'all balance reads failed');
    });
  });
});
