import 'dotenv/config';

import * as sdk from '../src';

import { Blockish, EthereumProvider, NetworkNumber } from '../src/types/common';
import { getProvider } from './utils/getProvider';

const { assert } = require('chai');

describe('Aave v3', () => {
  let provider: EthereumProvider;
  let providerBase: EthereumProvider;
  let providerOpt: EthereumProvider;
  let providerArb: EthereumProvider;
  let providerLinea: EthereumProvider;
  let providerPlasma: EthereumProvider;
  before(async () => {
    provider = getProvider('RPC');
    providerOpt = getProvider('RPCOPT');
    providerBase = getProvider('RPCBASE');
    providerArb = getProvider('RPCARB');
    providerLinea = getProvider('RPCLINEA');
    providerPlasma = getProvider('RPCPLASMA');
  });

  const fetchMarketData = async (network: NetworkNumber, _provider: EthereumProvider, version = sdk.AaveVersions.AaveV3) => {
    const marketData = await sdk.aaveV3.getAaveV3MarketData(_provider, network, sdk.markets.AaveMarkets(network)[version] as sdk.AaveMarketInfo);
    // console.log(marketData);
    assert.containsAllKeys(marketData, ['assetsData']);
    for (const tokenData of Object.values(marketData.assetsData)) {
      const keys: (keyof typeof tokenData)[] = [
        'symbol', 'supplyRate', 'borrowRate', 'price', 'isSiloed', // ...
      ];
      assert.containsAllKeys(tokenData, keys);
      for (const key of keys) assert.isDefined(tokenData[key], `${key} is undefined for ${tokenData.symbol}`);
    }
    return marketData;
  };

  const fetchAccountData = async (network: NetworkNumber, _provider: EthereumProvider, marketData: sdk.AaveV3MarketData, version = sdk.AaveVersions.AaveV3) => {
    const accountData = await sdk.aaveV3.getAaveV3AccountData(_provider, network, '0xe4D0f8c53C7fE7717d5a68321eDA15D667E7d44C', { selectedMarket: sdk.markets.AaveMarkets(network)[version], assetsData: marketData.assetsData, eModeCategoriesData: marketData.eModeCategoriesData });
    console.log(accountData);
    assert.containsAllKeys(accountData, [
      'usedAssets', 'suppliedUsd', 'borrowedUsd', 'ratio', 'eModeCategories', // ...
    ]);
  };

  const fetchFullPositionData = async (network: NetworkNumber, _provider: EthereumProvider) => {
    const positionData = await sdk.aaveV3.getAaveV3FullPositionData(_provider, network, '0x9cCf93089cb14F94BAeB8822F8CeFfd91Bd71649', sdk.markets.AaveMarkets(network)[sdk.AaveVersions.AaveV3]);
    // console.log(positionData);
    assert.containsAllKeys(positionData, [
      'usedAssets', 'suppliedUsd', 'borrowedUsd', 'ratio', 'eModeCategories', // ...
    ]);
  };

  const fetchAccountBalances = async (network: NetworkNumber, _provider: EthereumProvider, blockNumber: Blockish) => {
    const balances = await sdk.aaveV3.getAaveV3AccountBalances(_provider, network, blockNumber, false, '0x9cCf93089cb14F94BAeB8822F8CeFfd91Bd71649');
    // console.log(balances);
    assert.containsAllKeys(balances, [
      'collateral', 'debt',
    ]);
  };

  // Ethereum

  it('can fetch apy after values data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const afterValues = await sdk.helpers.aaveHelpers.getApyAfterValuesEstimation(
      sdk.markets.AaveMarkets(network)[sdk.AaveVersions.AaveV3],
      [{ action: 'collateral', amount: '1000', asset: 'USDC' }],
      provider,
      network,
    );
  });

  it('can fetch market by market address for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const market = sdk.markets.getAaveV3MarketByMarketAddress('0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e', network);
  });

  it('can fetch market and account data for Lido Market Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const marketData = await fetchMarketData(network, provider, sdk.AaveVersions.AaveV3Lido);
    await fetchAccountData(network, provider, marketData, sdk.AaveVersions.AaveV3Lido);
  });

  it('can fetch market and account data for Etherfi Market Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const marketData = await fetchMarketData(network, provider, sdk.AaveVersions.AaveV3Etherfi);
    await fetchAccountData(network, provider, marketData, sdk.AaveVersions.AaveV3Etherfi);
  });

  it('can fetch market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const marketData = await fetchMarketData(network, provider);
    await fetchAccountData(network, provider, marketData);
  });

  it('can fetch full position data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    await fetchFullPositionData(network, provider);
  });

  it('can fetch latest account balances for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    await fetchAccountBalances(network, provider, 'latest');
  });

  it('can fetch past account balances for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    await fetchAccountBalances(network, provider, 18184392);
  });

  // Optimism

  it('can fetch market and account data for Optimism', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Opt;

    const marketData = await fetchMarketData(network, providerOpt);
    await fetchAccountData(network, providerOpt, marketData);
  });

  it('can fetch full position data for Optimism', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Opt;

    await fetchFullPositionData(network, providerOpt);
  });

  it('can fetch latest account balances for Optimism', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Opt;

    await fetchAccountBalances(network, providerOpt, 'latest');
  });

  it('can fetch past account balances for Optimism', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Opt;

    await fetchAccountBalances(network, providerOpt, 109851575);
  });

  // Arbitrum

  it('can fetch market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;

    const marketData = await fetchMarketData(network, providerArb);
    await fetchAccountData(network, providerArb, marketData);
  });

  it('can fetch full position data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;

    await fetchFullPositionData(network, providerArb);
  });

  it('can fetch latest account balances for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;

    await fetchAccountBalances(network, providerArb, 'latest');
  });

  it('can fetch past account balances for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;

    await fetchAccountBalances(network, providerArb, 130191171);
  });

  // Base

  it('can fetch market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;

    const marketData = await fetchMarketData(network, providerBase);
    await fetchAccountData(network, providerBase, marketData);
  });

  it('can fetch full position data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;

    await fetchFullPositionData(network, providerBase);
  });

  it('can fetch latest account balances for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;

    await fetchAccountBalances(network, providerBase, 'latest');
  });

  it('can fetch past account balances for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;

    await fetchAccountBalances(network, providerBase, 4256022);
  });

  // Linea

  it('can fetch market and account data for Linea', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Linea;

    const marketData = await fetchMarketData(network, providerLinea);
    await fetchAccountData(network, providerLinea, marketData);
  });

  it('can fetch full position data for Linea', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Linea;

    await fetchFullPositionData(network, providerLinea);
  });

  it('can fetch latest account balances for Linea', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Linea;

    await fetchAccountBalances(network, providerLinea, 'latest');
  });

  it('can fetch past account balances for Linea', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Linea;

    await fetchAccountBalances(network, providerLinea, 22819963);
  });

  // Plasma

  it('can fetch market and account data for Plasma', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Plasma;

    const marketData = await fetchMarketData(network, providerPlasma);
    await fetchAccountData(network, providerPlasma, marketData);
  });

  it('can fetch full position data for Plasma', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Plasma;

    await fetchFullPositionData(network, providerPlasma);
  });

  it('can fetch latest account balances for Plasma', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Plasma;

    await fetchAccountBalances(network, providerPlasma, 'latest');
  });

  it('can fetch past account balances for Plasma', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Plasma;

    await fetchAccountBalances(network, providerPlasma, 1880800);
  });

  // Historical balances. Every fixture is pinned to a fixed block, so both the amounts and the
  // prices behind them are immutable — these assertions are reproducible, not time-dependent.
  // They need an archive RPC.
  describe('historical balance', () => {
    // Same address and block as 'can fetch past account balances for Ethereum' above, so this
    // reuses a fixture the suite already depends on having a position at that block.
    const HISTORY_USER = '0x9cCf93089cb14F94BAeB8822F8CeFfd91Bd71649' as sdk.EthAddress;
    const HISTORY_BLOCK = 18184392;
    // Aave v3 went live on Ethereum in Jan 2023 (~block 16.5M); nothing existed here.
    const PRE_MARKET_BLOCK = 15000000;

    const ethMarket = () => sdk.markets.AaveMarkets(NetworkNumber.Eth)[sdk.AaveVersions.AaveV3] as sdk.AaveMarketInfo;

    // Both paths read the same reserves and price them off the same oracle, so they should agree to
    // well within rounding. Compare on value rather than on the decimal string, so an unrelated
    // precision change doesn't fail this — a real mismatch is still far outside this tolerance.
    const assertUsdMatches = (actual: string, expected: string, label: string) => {
      assert.closeTo(Number(actual), Number(expected), Math.abs(Number(expected)) * 1e-9, label);
    };

    it('matches getAaveV3AccountData at a historical block', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const market = ethMarket();

      const historical = await sdk.aaveV3.getAaveV3HistoricalBalance(provider, network, market, HISTORY_USER, HISTORY_BLOCK);

      const marketData = await sdk.aaveV3.getAaveV3MarketData(provider, network, market, HISTORY_BLOCK);
      const accountData = await sdk.aaveV3.getAaveV3AccountData(provider, network, HISTORY_USER, {
        selectedMarket: market,
        assetsData: marketData.assetsData,
        eModeCategoriesData: marketData.eModeCategoriesData,
      }, HISTORY_BLOCK);

      // Guard against the comparison going vacuous if the fixture ever loses its position.
      assert.isAbove(Number(historical.suppliedUsd), 0, 'fixture has no supply at this block');
      assert.isAbove(Number(historical.borrowedUsd), 0, 'fixture has no debt at this block');

      // A divergence here most likely means the position holds an asset that is in the market's
      // on-chain reserve list but not in `market.assets`, which the historical path iterates.
      assertUsdMatches(historical.suppliedUsd, accountData.suppliedUsd, 'suppliedUsd');
      // Covers the stable + variable debt summation, which has no equivalent in the v4 path.
      assertUsdMatches(historical.borrowedUsd, accountData.borrowedUsd, 'borrowedUsd');
      assert.equal(historical.block, HISTORY_BLOCK);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
    });

    it('resolves aToken and debt token addresses for the market', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      const reserveTokens = await sdk.aaveV3.getAaveV3ReserveTokenAddresses(provider, network, ethMarket());
      const entries = Object.values(reserveTokens);
      assert.isNotEmpty(entries);

      entries.forEach((entry) => {
        // A dropped read leaves the symbol out entirely rather than yielding a zero address, so
        // assert on shape here and on completeness below.
        assert.match(entry.aTokenAddress, /^0x[0-9a-fA-F]{40}$/, `${entry.symbol} aToken`);
        assert.match(entry.variableDebtTokenAddress, /^0x[0-9a-fA-F]{40}$/, `${entry.symbol} variableDebtToken`);
        assert.notEqual(entry.aTokenAddress.toLowerCase(), entry.underlyingAddress.toLowerCase(), `${entry.symbol} aToken should differ from underlying`);
        assert.notEqual(entry.aTokenAddress.toLowerCase(), entry.variableDebtTokenAddress.toLowerCase(), `${entry.symbol} aToken should differ from debt token`);
      });

      // The historical path only sees assets present in this mapping, so a silently dropped
      // reserve would under-report every point built from it. Name the missing symbols so a config
      // drift (asset listed in config but not on-chain) is distinguishable from a read failure.
      const missing = ethMarket().assets.filter((symbol) => !reserveTokens[symbol]);
      assert.isEmpty(missing, `unresolved reserves: ${missing.join(', ')}`);
    });

    it('returns zeros for an address with no position', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      const historical = await sdk.aaveV3.getAaveV3HistoricalBalance(provider, network, ethMarket(), '0x000000000000000000000000000000000000dEaD' as sdk.EthAddress, HISTORY_BLOCK);
      assert.equal(historical.suppliedUsd, '0');
      assert.equal(historical.borrowedUsd, '0');
      assert.equal(historical.netUsd, '0');
      assert.equal(historical.block, HISTORY_BLOCK);
    });

    it('produces the same result with and without prefetched reserve tokens', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const market = ethMarket();

      const reserveTokens = await sdk.aaveV3.getAaveV3ReserveTokenAddresses(provider, network, market);

      const withTokens = await sdk.aaveV3.getAaveV3HistoricalBalance(provider, network, market, HISTORY_USER, HISTORY_BLOCK, reserveTokens);
      const withoutTokens = await sdk.aaveV3.getAaveV3HistoricalBalance(provider, network, market, HISTORY_USER, HISTORY_BLOCK);
      assert.deepEqual(withTokens, withoutTokens);
    });

    it('throws rather than reporting $0 for a block before the market existed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      // The caller renders a gap in the chart from the throw; a $0 point here would instead draw a
      // believable crash to zero for every position that predates the market.
      let threw = false;
      let result;
      try {
        result = await sdk.aaveV3.getAaveV3HistoricalBalance(provider, network, ethMarket(), HISTORY_USER, PRE_MARKET_BLOCK);
      } catch (e) { threw = true; }
      assert.isTrue(threw, `expected a throw, got ${JSON.stringify(result)}`);
    });
  });
});
