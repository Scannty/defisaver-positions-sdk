import 'dotenv/config';
import Dec from 'decimal.js';

import * as sdk from '../src';

import {
  Blockish, EthAddress, EthereumProvider, NetworkNumber,
} from '../src/types/common';
import { getProvider } from './utils/getProvider';

const { assert } = require('chai');


describe('Morpho Blue', () => {
  let provider: EthereumProvider;
  let providerBase: EthereumProvider;
  let providerArb: EthereumProvider;

  before(async () => {
    provider = getProvider('RPC');
    providerBase = getProvider('RPCBASE');
    providerArb = getProvider('RPCARB');
  });

  const fetchMarketData = async (network: NetworkNumber, _provider: EthereumProvider, selectedMarket: sdk.MorphoBlueMarketData) => {
    const marketData = await sdk.morphoBlue.getMorphoBlueMarketData(_provider, network, selectedMarket);
    // console.log(marketData);
    assert.containsAllKeys(marketData, ['assetsData', 'oracle', 'utillization']);
    for (const tokenData of Object.values(marketData.assetsData)) {
      const keys: (keyof typeof tokenData)[] = [
        'symbol', 'supplyRate', 'borrowRate', 'price', // ...
      ];
      assert.containsAllKeys(tokenData, keys);
      for (const key of keys) assert.isDefined(tokenData[key], `${key} is undefined for ${tokenData.symbol}`);
    }
    return marketData;
  };

  const fetchAccountData = async (network: NetworkNumber, _provider: EthereumProvider, marketData: sdk.MorphoBlueMarketInfo, selectedMarket: sdk.MorphoBlueMarketData) => {
    const accountData = await sdk.morphoBlue.getMorphoBlueAccountData(
      _provider,
      network,
      '0x199666178740df61638b5fcd188eae70180cc8e8',
      selectedMarket,
      marketData,
    );
    // console.log(accountData);
    assert.containsAllKeys(accountData, [
      'usedAssets', 'suppliedUsd', 'borrowedUsd', 'ltv', // ...
    ]);
  };

  const fetchAccountBalances = async (network: NetworkNumber, _provider: EthereumProvider, blockNumber: Blockish, selectedMarket: sdk.MorphoBlueMarketData) => {
    const balances = await sdk.morphoBlue.getMorphoBlueAccountBalances(_provider, network, blockNumber, false, '0x9cCf93089cb14F94BAeB8822F8CeFfd91Bd71649', selectedMarket);
    // console.log(balances);
    assert.containsAllKeys(balances, [
      'collateral', 'debt',
    ]);
    return balances;
  };

  // APY

  it('can fetch apy afters for wstETH/ETH market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_945];

    const { borrowRate, supplyRate } = await sdk.helpers.morphoBlueHelpers.getApyAfterValuesEstimation(
      selectedMarket,
      [
        {
          action: 'borrow',
          amount: '100',
          asset: 'ETH',
        },
        {
          action: 'supply',
          amount: '300',
          asset: 'ETH',
        },
      ],
      provider,
      network,
    );
    // console.log('borrowRate', borrowRate);
    // console.log('supplyRate', supplyRate);
  });

  // Allocator

  it('can fetch reallocatable liquidity for wstETH/ETH market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_965_Exchange_Rate];

    const { reallocatableLiquidity, targetBorrowUtilization } = await sdk.helpers.morphoBlueHelpers.getReallocatableLiquidity(selectedMarket.marketId, network);
    assert.isTrue(new Dec(reallocatableLiquidity).gt(0), 'No reallocatable liquidity found');
    assert.isTrue(new Dec(targetBorrowUtilization).gt(0), 'No target borrow utilization found');
  });

  it('can fetch vaults for reallocation for wstETH/ETH market on Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_965_Exchange_Rate];

    const { reallocatableLiquidity } = await sdk.helpers.morphoBlueHelpers.getReallocatableLiquidity(selectedMarket.marketId, network);
    const liquidityToAllocate = new Dec(reallocatableLiquidity).div(2).toString();
    const marketData = await fetchMarketData(network, provider, selectedMarket);

    const { vaults, withdrawals } = await sdk.helpers.morphoBlueHelpers.getReallocation(selectedMarket, marketData.assetsData, liquidityToAllocate, network);
    const numOfVaults = vaults.length;
    assert.isAbove(numOfVaults, 0, 'No vaults found');
    assert.equal(vaults.length, withdrawals.length, 'Vaults and withdrawals length mismatch');
  });

  // Balances

  it('can fetch wstETH/ETH balance for position for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_945];

    const balances = await fetchAccountBalances(network, provider, 'latest', selectedMarket);
    // console.log(balances);
  });

  // Ethereum

  it('can fetch wstETH/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDC];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch sDAI/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSDAIUSDC];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch WBTC/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCUSDC];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch ETH/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDC_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch wstETH/USDT market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDT];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch WBTC/USDT market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCUSDT];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch wstETH/USDA Lido Exchange rate market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDA_Exchange_Rate];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch wstETH/PYUSD market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthPYUSD];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch WBTC/PYUSD market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCPYUSD];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch WBTC/ETH market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCEth];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch USDe/USDT market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSDeUSDT];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch sUSDe/USDT market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDeUSDT];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch MKR/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueMKRUSDC];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch tBTC/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueTBTCUSDC];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch cbBTC/ETH market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCEth_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch cbBTC/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCUSDC_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch sUSDe/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDeUSDC_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch syrupUSDC/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSyrupUSDCUSDC_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch LBTC/USDC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueLBTCUSDC_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch LBTC/cbBTC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueLBTCCbBTC_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch sUSDe/USDtb market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDeUSDtb_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch USDe/USDtb market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSDeUSDtb_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch ETH/USDT market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDT_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch rsETH/ETH market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueRsEthEth_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch rswETH/ETH market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueRswEthEth_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  // ezETH/ETH

  it('can fetch ezETH/ETH 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEzEthEth_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch ezETH/ETH 94.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEzEthEth_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  // weETH/ETH

  it('can fetch weETH/ETH 94.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthEth_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  // wstETH/WETH

  it('can fetch wstETH/ETH 94.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch wstETH/ETH 94.5% Lido Exchange rate market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_945_Exchange_Rate];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch wstETH/ETH 96.5% Lido Exchange rate market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_965_Exchange_Rate];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  // sUSDe/DAI
  it('can fetch sUSDe/DAI 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDeDAI_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch sUSDe/DAI 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDeDAI_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch sUSDe/DAI 94.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDeDAI_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  // USDe/DAI
  it('can fetch USDe/DAI 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSDeDAI_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch USDe/DAI 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSDeDAI_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch USR/USDC 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSRUSDC_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch sUSDS/USDT 96.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBluesUSDSUSDT_965];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  it('can fetch PRIME/PYUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBluePRIMEPYUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch kBTC/RLUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueKBTCRLUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch kBTC/PYUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueKBTCPYUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch wstETH/USDC 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDC_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch syrupUSDC/PYUSD 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSyrupUSDCPYUSD_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch WBTC/USDC 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCUSDC_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch cbBTC/USDC 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCUSDC_860_bc99de6a];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/RLUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthRLUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/PYUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthPYUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch cbBTC/USDT 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCUSDT_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch LBTC/PYUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueLBTCPYUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch sUSDe/PYUSD 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSUSDePYUSD_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch WBTC/USDT 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCUSDT_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch wstETH/USDT 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDT_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch syrupUSDC/RLUSD 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSyrupUSDCRLUSD_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/USDC 77% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDC_770];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/USDC 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDC_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/USDC 86% 85252bb8 market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDC_860_85252bb8];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch ETH/USDC 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDC_860_94b823e6];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch USD3/USDC 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSD3USDC_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch stUSDS/USDC 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueStUSDSUSDC_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch cbBTC/RLUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCRLUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch WBTC/ETH 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCEth_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch cbBTC/ETH 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCEth_915_12dbf493];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/USDT 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDT_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/USDT 86% a6a4c1f1 market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDT_860_a6a4c1f1];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch syrupUSDT/USDT 91.5% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSyrupUSDTUSDT_915];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch cbBTC/PYUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCPYUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch weETH/USDT 77% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDT_770];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch ETH/USDT 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDT_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch WBTC/RLUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCRLUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch WBTC/PYUSD 86% market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCPYUSD_860];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });

  // ###### BASE ######

  it('can fetch cbETH/USDC 86% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbEthUSDC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch wstETH/ETH 94.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_945_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch wstETH/ETH 96.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEth_965_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch wstETH/USDC 86% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch cbETH/ETH 94.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbEthEth_945_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch cbETH/ETH 96.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbEthEth_965_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch ETH/USDC 86% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch rETH/USDC 86% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueREthUSDC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch rETH/ETH 94.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueREthEth_945_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch cbBTC/ETH market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCEth_915_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch cbBTC/USDC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCUSDC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch LBTC/WBTC market and account data for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueLBTCWBTC_945];

    const marketData = await fetchMarketData(network, provider, selectedMarket);
    await fetchAccountData(network, provider, marketData, selectedMarket);
  });
  it('can fetch LBTC/cbBTC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueLBTCCbBTC_945_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch cbBTC/EURC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbBTCEURC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch wstETH/EURC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthEURC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch WETH/EURC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWETHEURC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch cbETH/EURC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbEthEURC_860_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch weETH/ETH 91.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthEth_915_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch weETH/ETH 94.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthEth_945_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch AERO/USDC market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueAEROUSDC_625_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  it('can fetch USDe/USDC 91.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueUSDeUSDC_915_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch cbETH/USDC 77% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbEthUSDC_770_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });
  it('can fetch cbXRP/USDC 62.5% market and account data for Base', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Base;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueCbXRPUSDC_625_Base];

    const marketData = await fetchMarketData(network, providerBase, selectedMarket);
    await fetchAccountData(network, providerBase, marketData, selectedMarket);
  });

  // Arbitrum
  it('can fetch syrupUSDC/USDC market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueSyrupUSDCUSDC_915_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch WBTC/USDC market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCUSDC_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch wstETH/USDC market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDC_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch ETH/USDC market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDC_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch sUSDS/USDC market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBluesUSDSUSDC_945_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });

  it('can fetch weETH/USDC 86% market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDC_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch sUSDS/USDT0 94.5% market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBluesUSDSUSDT0_945_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch weETH/USDT0 86% market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWeEthUSDT0_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch ETH/USDT0 86% market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueEthUSDT0_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch wstETH/USDT0 86% market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWstEthUSDT0_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });
  it('can fetch WBTC/USDT0 86% market and account data for Arbitrum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Arb;
    const selectedMarket = sdk.markets.MorphoBlueMarkets(network)[sdk.MorphoBlueVersions.MorphoBlueWBTCUSDT0_860_Arb];

    const marketData = await fetchMarketData(network, providerArb, selectedMarket);
    await fetchAccountData(network, providerArb, marketData, selectedMarket);
  });

  // utils
  it('can fetch wstETH/ETH 96.5% Lido Exchange rate market for Ethereum', async function () {
    this.timeout(10000);
    const network = NetworkNumber.Eth;

    const market = sdk.markets.findMorphoBlueMarket(
      '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      0.965,
      '0xbD60A6770b27E084E8617335ddE769241B0e71D8',
      '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC',
      network,
    );
    if (!market) throw new Error('Market not found');
  });
  // Historical balances. Every fixture is pinned to a fixed block, so both the amounts and the
  // prices behind them are immutable — these assertions are reproducible, not time-dependent.
  // They need an archive RPC.
  describe('historical balance', () => {
    // The Morpho Blue singleton went live at 18883124; the oldest MorphoBlueView this SDK knows
    // about is at 18976639. Blocks in between are exactly what the View-based path cannot serve and
    // this one can — two weeks of history for the markets Morpho launched with.
    const MORPHO_BLUE_DEPLOY_BLOCK = 18883124;
    const OLDEST_MORPHO_BLUE_VIEW_BLOCK = 18976639;
    const PRE_VIEW_BLOCK = 18970000;
    // Supplies, collateralises and borrows in the same market, so one point covers all three legs.
    const PRE_VIEW_USER = '0x9106CBf2C882340b23cC40985c05648173E359e7' as EthAddress;
    // A wstETH/USDC position the View can also read, so the two paths can be compared.
    const USDC_USER = '0x048060A5D996D20997E80F5B082DE8CE5Da3f852' as EthAddress;
    const USDC_BLOCK = 21500000;
    // A market whose loan token is WETH rather than a stablecoin: the oracle quotes WBTC in ETH, so
    // every figure needs the ETH/USD leg on top and none of it is dollar-denominated to begin with.
    const ETH_MARKET_USER = '0xc25d35024Dd497D3825115828994Bb08D12a3aa7' as EthAddress;
    const ETH_MARKET_BLOCK = 21500000;

    const market = (version: sdk.MorphoBlueVersions, networkId = NetworkNumber.Eth) => sdk.markets.MorphoBlueMarkets(networkId)[version];
    const usdcMarket = () => market(sdk.MorphoBlueVersions.MorphoBlueWstEthUSDC);
    const ethMarket = () => market(sdk.MorphoBlueVersions.MorphoBlueWBTCEth);

    /**
     * The amounts are the risky half of a point — the USD figures are just a multiplication on top —
     * and they are the half that depends on getting the share→asset conversion and the interest
     * accrued since `market.lastUpdate` right. The View reads the same singleton at the same block
     * through `expectedSupplyAssets`/`expectedBorrowAssets`, so it is the one independent check
     * available. `getMorphoBlueAccountData` cannot be pinned to a block, so it can't stand in.
     */
    const assertAmountsMatchView = async (selectedMarket: sdk.MorphoBlueMarketData, address: EthAddress, block: number, historical: sdk.MorphoBlueHistoricalBalance) => {
      const balances = await sdk.morphoBlue.getMorphoBlueAccountBalances(provider, NetworkNumber.Eth, block, false, address, selectedMarket);
      const context = await sdk.morphoBlue.getMorphoBlueHistoricalBalanceContext(provider, NetworkNumber.Eth, selectedMarket);
      assert.isNotEmpty(historical.assets, 'fixture holds no position at this block');
      historical.assets.forEach((asset) => {
        // Raw base units on this side against the View's human-readable amounts on the other, scaled
        // by the decimals the token reports on chain rather than by a package lookup.
        const scale = new Dec(10).pow(asset.isCollateral ? context.collateralTokenDecimals : context.loanTokenDecimals);
        if (asset.isCollateral && asset.supplied !== '0') {
          assert.isTrue(new Dec(asset.supplied).div(scale).eq(balances.collateral?.[asset.symbol] || '0'), `${asset.symbol} collateral: ${asset.supplied} vs ${balances.collateral?.[asset.symbol]}`);
        }
        if (asset.borrowed !== '0') {
          assert.isTrue(new Dec(asset.borrowed).div(scale).eq(balances.debt?.[asset.symbol] || '0'), `${asset.symbol} borrowed: ${asset.borrowed} vs ${balances.debt?.[asset.symbol]}`);
        }
      });
    };

    it('reads a position from before any known MorphoBlueView was deployed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      assert.isBelow(PRE_VIEW_BLOCK, OLDEST_MORPHO_BLUE_VIEW_BLOCK);
      assert.isAbove(PRE_VIEW_BLOCK, MORPHO_BLUE_DEPLOY_BLOCK);

      const historical = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, usdcMarket(), PRE_VIEW_USER, PRE_VIEW_BLOCK);

      // 10.05 wstETH collateral plus a 100.01 USDC deposit against a 9510.97 USDC borrow, at Jan 2024
      // prices (wstETH ~$2611, i.e. ETH ~$2211 through the ~1.181 staking rate). Pinned rather than
      // merely non-zero: at a fixed block these are immutable, and a wrong divisor anywhere in the
      // chain moves them by orders of magnitude while still leaving them positive.
      assert.closeTo(Number(historical.collateralTokenUsdPrice), 2610.85, 5);
      assert.closeTo(Number(historical.loanTokenUsdPrice), 1, 0.02);
      assert.closeTo(Number(historical.suppliedUsd), 26339.08, 26339.08 * 0.005);
      assert.closeTo(Number(historical.suppliedCollateralUsd), 26239.06, 26239.06 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 9511.47, 9511.47 * 0.005);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
      assert.equal(historical.block, PRE_VIEW_BLOCK);
      // The loan-token deposit is not collateral, so it counts in `suppliedUsd` but not in
      // `suppliedCollateralUsd` — a fixture that lends and borrows in one market catches a swap.
      assert.isAbove(Number(historical.suppliedUsd), Number(historical.suppliedCollateralUsd));
      // Pinned on its own rather than left to the totals: the 0.5% band on `suppliedUsd` is ±$131.70,
      // wider than the $100.02 deposit itself, so a `toAssetsDown` off by 2x would still land inside
      // it. This is the only tight check on the supply-share conversion anywhere — the View exposes
      // no supplied balance for the loan token, so `assertAmountsMatchView` cannot cover it.
      const loanAsset = historical.assets.find((a) => !a.isCollateral);
      if (!loanAsset) throw new Error('expected a loan-token leg');
      assert.closeTo(Number(loanAsset.suppliedUsd), 100.02, 0.5);
      assert.closeTo(Number(new Dec(loanAsset.supplied).div(1e6)), 100.01, 0.5);
      assert.closeTo(Number(historical.suppliedUsd) - Number(historical.suppliedCollateralUsd), 100.02, 0.5);

      // The View genuinely cannot serve this block — that is the whole reason this path exists.
      let viewFailed = false;
      try {
        await sdk.morphoBlue.getMorphoBlueAccountBalances(provider, network, PRE_VIEW_BLOCK, false, PRE_VIEW_USER, usdcMarket());
      } catch (e) { viewFailed = true; }
      assert.isTrue(viewFailed, 'expected MorphoBlueView to be unreadable before its deployment block');
    });

    it('matches the View amounts in a stablecoin-denominated market', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = usdcMarket();

      const historical = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, selectedMarket, USDC_USER, USDC_BLOCK);
      await assertAmountsMatchView(selectedMarket, USDC_USER, USDC_BLOCK, historical);

      // A USDC loan token prices itself, so the oracle's wstETH quote is already within a rounding
      // error of dollars: wstETH ~$3948 at this block, i.e. ETH ~$3341 through the staking rate.
      assert.closeTo(Number(historical.loanTokenUsdPrice), 1, 0.02);
      assert.closeTo(Number(historical.collateralTokenUsdPrice), 3948.38, 8);
      // 55 wstETH against a 110121.15 USDC borrow, Dec 2024.
      assert.closeTo(Number(historical.suppliedUsd), 217160.84, 217160.84 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 110121.15, 110121.15 * 0.005);
      // Nothing of the supply is the loan token here, so all of it is collateral.
      assert.equal(historical.suppliedCollateralUsd, historical.suppliedUsd);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
    });

    it('converts an ETH-denominated market to USD', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = ethMarket();

      const historical = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, selectedMarket, ETH_MARKET_USER, ETH_MARKET_BLOCK);
      await assertAmountsMatchView(selectedMarket, ETH_MARKET_USER, ETH_MARKET_BLOCK, historical);

      // ETH was ~$3340 at this block and the market's oracle quotes WBTC in ETH (~28.5 ETH each).
      // Without the Chainlink leg the collateral would come out as ~28 "dollars" a coin, so pin the
      // scalar as well as the totals.
      assert.closeTo(Number(historical.loanTokenUsdPrice), 3340.22, 5);
      assert.closeTo(Number(historical.collateralTokenUsdPrice), 95137.73, 200);
      // 8.20000001 WBTC against a 175.056 ETH borrow.
      assert.closeTo(Number(historical.suppliedUsd), 780129.42, 780129.42 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 584725.54, 584725.54 * 0.005);
      assert.closeTo(Number(historical.netUsd), Number(historical.suppliedUsd) - Number(historical.borrowedUsd), 1e-6);
    });

    // The only network branch: Base and Arbitrum have no Chainlink FeedRegistry, so the loan token's
    // USD price comes from the DFS registry and its decimals from the aggregator behind it. Needs an
    // archive Base RPC.
    it('prices a Base market through the DFS feed registry', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Base;
      const selectedMarket = market(sdk.MorphoBlueVersions.MorphoBlueCbBTCUSDC_860_Base, network);
      const user = '0x166Ce42Df5f4BAA94aBC5B62C60dab1B3C73D2a3' as EthAddress;
      const block = 25000000;

      const historical = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(providerBase, network, selectedMarket, user, block);
      const balances = await sdk.morphoBlue.getMorphoBlueAccountBalances(providerBase, network, block, false, user, selectedMarket);

      // cbBTC carries 8 decimals rather than 18, so a hardcoded scale would be off by 1e10 here.
      assert.isTrue(new Dec(historical.assets.find((a) => a.isCollateral)?.supplied || '0').div(1e8).eq(balances.collateral?.cbBTC || '0'));
      assert.isTrue(new Dec(historical.assets.find((a) => !a.isCollateral)?.borrowed || '0').div(1e6).eq(balances.debt?.USDC || '0'));
      // 18.6488 cbBTC at ~$91977 against a 1261825.74 USDC borrow.
      assert.closeTo(Number(historical.loanTokenUsdPrice), 1, 0.02);
      assert.closeTo(Number(historical.collateralTokenUsdPrice), 91977.31, 200);
      assert.closeTo(Number(historical.suppliedUsd), 1715265.94, 1715265.94 * 0.005);
      assert.closeTo(Number(historical.borrowedUsd), 1261748.46, 1261748.46 * 0.005);
    });

    it('returns zeros for an address with no position', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      const historical = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, usdcMarket(), '0x000000000000000000000000000000000000dEaD' as EthAddress, USDC_BLOCK);
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

      const context = await sdk.morphoBlue.getMorphoBlueHistoricalBalanceContext(provider, network, selectedMarket);
      assert.equal(context.marketId, selectedMarket.marketId);
      // Read from the tokens themselves rather than assumed, so just sanity-check them — pinning the
      // values here would re-introduce the hardcoded scale the implementation deliberately avoids.
      assert.isAbove(context.loanTokenDecimals, 0);
      assert.isAbove(context.collateralTokenDecimals, 0);

      const withContext = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, selectedMarket, USDC_USER, USDC_BLOCK, context);
      const withoutContext = await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, selectedMarket, USDC_USER, USDC_BLOCK);
      assert.deepEqual(withContext, withoutContext);
    });

    it('rejects a context built for a different market', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;

      // Reusing one context across a multi-market loop would otherwise read the context's market and
      // label the result with the loop's market.
      const context = await sdk.morphoBlue.getMorphoBlueHistoricalBalanceContext(provider, network, ethMarket());

      let message = '';
      try {
        await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, usdcMarket(), USDC_USER, USDC_BLOCK, context);
      } catch (e) { message = (e as Error).message; }
      assert.include(message, 'context is for market');
    });

    it('throws rather than reporting $0 for a block before the market existed', async function () {
      this.timeout(60000);
      const network = NetworkNumber.Eth;
      const selectedMarket = usdcMarket();
      const context = await sdk.morphoBlue.getMorphoBlueHistoricalBalanceContext(provider, network, selectedMarket);

      // Morpho was already live here, but this market had not been created yet. The caller renders a
      // gap in the chart from the throw; a $0 point would instead draw a believable crash to zero
      // for every position that predates the market.
      let message = '';
      try {
        await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, selectedMarket, PRE_VIEW_USER, MORPHO_BLUE_DEPLOY_BLOCK + 10000, context);
      } catch (e) { message = (e as Error).message; }
      assert.include(message, 'did not exist at block');

      // And before the singleton itself, where there is no market state to read at all.
      let earlierMessage = '';
      try {
        await sdk.morphoBlue.getMorphoBlueHistoricalBalance(provider, network, selectedMarket, PRE_VIEW_USER, MORPHO_BLUE_DEPLOY_BLOCK - 100000, context);
      } catch (e) { earlierMessage = (e as Error).message; }
      assert.include(earlierMessage, 'market or position read failed');
    });
  });
});
