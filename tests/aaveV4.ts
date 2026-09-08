import 'dotenv/config';

import { getAssetInfo } from '@defisaver/tokens';
import * as sdk from '../src';

import { Blockish, EthereumProvider, NetworkNumber } from '../src';
import { getProvider } from './utils/getProvider';
import { getAaveV4UnderlyingFromReserveId } from '../src/aaveV4';
import { compareAddresses } from '../src/services/utils';

const { assert } = require('chai');

describe('Aave v4', () => {
  let provider: EthereumProvider;
  before(async () => {
    provider = getProvider('RPC');
  });

  const fetchSpokeData = async (network: NetworkNumber, _provider: EthereumProvider, version = sdk.AaveV4SpokesType.AaveV4MainSpoke) => {
    const marketData = await sdk.aaveV4.getAaveV4SpokeData(_provider, network, sdk.markets.AaveV4Spokes(network)[version] as sdk.AaveV4SpokeInfo);
    // console.log(marketData);
    return marketData;
  };

  const fetchAccountData = async (network: NetworkNumber, _provider: EthereumProvider, spokeData: sdk.AaveV4SpokeData) => {
    const accountData = await sdk.aaveV4.getAaveV4AccountData(_provider, network, spokeData, '0x57cc7f1aFA33411D2411549c15a2D2BAcf316709');
    console.log(accountData);
    return accountData;
  };

  const fetchAccountBalances = async (network: NetworkNumber, _provider: EthereumProvider, blockNumber: Blockish) => {
    const mainSpoke = sdk.markets.AaveV4Spokes(network)[sdk.AaveV4SpokesType.AaveV4MainSpoke];
    const balances = await sdk.aaveV4.getAaveV4AccountBalances(
      _provider,
      network,
      blockNumber,
      false,
      '0x57cc7f1aFA33411D2411549c15a2D2BAcf316709',
      mainSpoke.address,
    );
    assert.containsAllKeys(balances, ['collateral', 'debt']);
    return balances;
  };

  // Ethereum

  it('can fetch market and account data for Main Spoke Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const marketData = await fetchSpokeData(network, provider, sdk.AaveV4SpokesType.AaveV4MainSpoke);
    await fetchAccountData(network, provider, marketData);
  });

  it('can fetch account balances for Main Spoke Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    await fetchAccountBalances(network, provider, 'latest');
  });

  it('can fetch spoke data with hubs missing from the configured hubs list', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    // Aave can list an asset from a hub the SDK doesn't know yet — every hub must be
    // discoverable from the on-chain reserves alone, so an empty hint list must still work
    const mapleSpoke = sdk.markets.AaveV4Spokes(network)[sdk.AaveV4SpokesType.AaveV4USDGMapleSpoke];
    const spokeWithoutHubs = { ...mapleSpoke, hubs: [] };
    const marketData = await sdk.aaveV4.getAaveV4SpokeData(provider, network, spokeWithoutHubs as sdk.AaveV4SpokeInfo);
    const assets = Object.values(marketData.assetsData);
    assert.isNotEmpty(assets);
    assets.forEach((asset) => {
      assert.isNotEmpty(asset.hubName);
      assert.isNotEmpty(asset.hub);
    });
  });

  it('can fetch asset from reserveId', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    // gold spoke
    const goldSpoke = sdk.markets.AaveV4Spokes(network)[sdk.AaveV4SpokesType.AaveV4GoldSpoke];
    const XAUtReserveId = 0;
    const assetAddress = await getAaveV4UnderlyingFromReserveId(provider, network, goldSpoke.address, XAUtReserveId);
    // console.log(compareAddresses(assetAddress, getAssetInfo('XAUt', network).address));
  });

  it('can fetch apy afters Main Spoke Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const marketData = await fetchSpokeData(network, provider, sdk.AaveV4SpokesType.AaveV4MainSpoke);
    const apyAfters = await sdk.helpers.aaveV4Helpers.getAaveV4ApyAfterValuesEstimation(sdk.markets.AaveV4Spokes(network)[sdk.AaveV4SpokesType.AaveV4MainSpoke] as sdk.AaveV4SpokeInfo, marketData.assetsData, [{ action: 'borrow', amount: '100000', asset: 'USDC-7' }], provider, network);
    // console.log(apyAfters);
  });
  // Historical balances. All fixtures are pinned to fixed blocks, so both the amounts and the
  // prices behind them are immutable — these assertions are reproducible, not time-dependent.
  // They need an archive RPC.
  describe('historical balance', () => {
    // AaveV4View was deployed at 25144919; the Aave v4 spokes went live at 24720899. Blocks in
    // between are exactly what the View-based path cannot serve and this path can.
    const AAVE_V4_VIEW_DEPLOY_BLOCK = 25144919;
    const MAIN_SPOKE_DEPLOY_BLOCK = 24720899;
    const HISTORY_USER = '0x1368f026630e7b7eec9083a6488920621fbea2e2' as sdk.EthAddress;
    const POST_VIEW_BLOCK = 25200000;
    const PRE_VIEW_BLOCK = 24901500;

    const mainSpoke = (network: NetworkNumber) => sdk.markets.AaveV4Spokes(network)[sdk.AaveV4SpokesType.AaveV4MainSpoke] as sdk.AaveV4SpokeInfo;

    // The two paths reach the same USD figure by different arithmetic (View arithmetic vs. spoke
    // getters priced off the oracle), so compare on value with a relative tolerance rather than on
    // the decimal string — an unrelated precision change shouldn't fail this.
    const assertUsdMatches = (actual: string, expected: string, label: string) => {
      assert.closeTo(Number(actual), Number(expected), Math.abs(Number(expected)) * 1e-9, label);
    };

    it('matches getAaveV4AccountData at a block both paths can read', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const spoke = mainSpoke(network);

      const historical = await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, HISTORY_USER, POST_VIEW_BLOCK);

      const spokeData = await sdk.aaveV4.getAaveV4SpokeData(provider, network, spoke, POST_VIEW_BLOCK);
      const accountData = await sdk.aaveV4.getAaveV4AccountData(provider, network, spokeData, HISTORY_USER, POST_VIEW_BLOCK);

      // Guard against the comparison going vacuous if the fixture ever loses its position.
      assert.isAbove(Number(historical.suppliedUsd), 0);
      assert.isAbove(Number(historical.borrowedUsd), 0);
      assert.isAbove(Number(historical.suppliedCollateralUsd), 0);

      assertUsdMatches(historical.suppliedUsd, accountData.suppliedUsd, 'suppliedUsd');
      assertUsdMatches(historical.borrowedUsd, accountData.borrowedUsd, 'borrowedUsd');
      // `isUsingAsCollateral` comes from getUserReserveStatus here and from the View there — the
      // one field of this shape that could be silently wrong without moving the totals.
      assertUsdMatches(historical.suppliedCollateralUsd, accountData.suppliedCollateralUsd, 'suppliedCollateralUsd');
      assertUsdMatches(historical.drawnUsd, accountData.drawnUsd, 'drawnUsd');
      assertUsdMatches(historical.premiumUsd, accountData.premiumUsd, 'premiumUsd');
      assert.equal(historical.block, POST_VIEW_BLOCK);
      assert.equal(historical.spoke.toLowerCase(), spoke.address.toLowerCase());
    });

    it('reads a position from before AaveV4View was deployed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const spoke = mainSpoke(network);
      assert.isBelow(PRE_VIEW_BLOCK, AAVE_V4_VIEW_DEPLOY_BLOCK);
      assert.isAbove(PRE_VIEW_BLOCK, MAIN_SPOKE_DEPLOY_BLOCK);

      const historical = await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, HISTORY_USER, PRE_VIEW_BLOCK);

      assert.isAbove(Number(historical.suppliedUsd), 0);
      assert.isAbove(Number(historical.borrowedUsd), 0);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);

      // The View genuinely cannot serve this block — that is the whole reason this path exists.
      let viewFailed = false;
      try {
        await sdk.aaveV4.getAaveV4SpokeData(provider, network, spoke, PRE_VIEW_BLOCK);
      } catch (e) { viewFailed = true; }
      assert.isTrue(viewFailed, 'expected AaveV4View to be unreadable before its deployment block');
    });

    it('throws rather than reporting $0 for a block before the spoke existed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const spoke = mainSpoke(network);
      const context = await sdk.aaveV4.getAaveV4HistoricalBalanceContext(provider, network, spoke);

      let message = '';
      try {
        await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, HISTORY_USER, MAIN_SPOKE_DEPLOY_BLOCK - 1000, context);
      } catch (e) { message = (e as Error).message; }
      assert.include(message, 'all balance reads failed');
    });

    it('returns zeros for an address with no position', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const spoke = mainSpoke(network);

      const historical = await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, '0x000000000000000000000000000000000000dEaD' as sdk.EthAddress, POST_VIEW_BLOCK);
      assert.equal(historical.suppliedUsd, '0');
      assert.equal(historical.borrowedUsd, '0');
      assert.equal(historical.netUsd, '0');
    });

    it('produces the same result with and without a prefetched context', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const spoke = mainSpoke(network);

      const context = await sdk.aaveV4.getAaveV4HistoricalBalanceContext(provider, network, spoke);
      assert.isNotEmpty(context.reserves);
      // Read from the oracle rather than assumed, so just sanity-check it — pinning the value here
      // would re-introduce the hardcoded divisor the implementation deliberately avoids.
      assert.isAbove(context.oracleDecimals, 0);

      const withContext = await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, HISTORY_USER, POST_VIEW_BLOCK, context);
      const withoutContext = await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, HISTORY_USER, POST_VIEW_BLOCK);
      assert.deepEqual(withContext, withoutContext);
    });

    it('rejects a context built for a different spoke', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const spoke = mainSpoke(network);
      const otherSpoke = sdk.markets.AaveV4Spokes(network)[sdk.AaveV4SpokesType.AaveV4LidoSpoke] as sdk.AaveV4SpokeInfo;

      // Reusing one context across a multi-spoke loop would otherwise read the context's spoke and
      // label the result with the loop's spoke.
      const context = await sdk.aaveV4.getAaveV4HistoricalBalanceContext(provider, network, otherSpoke);

      let message = '';
      try {
        await sdk.aaveV4.getAaveV4HistoricalBalance(provider, network, spoke, HISTORY_USER, POST_VIEW_BLOCK, context);
      } catch (e) { message = (e as Error).message; }
      assert.include(message, 'context is for spoke');
    });
  });
});
