import { describe, it, expect } from 'vitest';
import { AlphaSigner } from '../src/signer';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_SAFE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const CHAIN_ID = 137;
const CTF_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEGRISK_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

describe('AlphaSigner', () => {
  const signer = new AlphaSigner(TEST_PRIVATE_KEY, TEST_SAFE_ADDRESS, CHAIN_ID, CTF_ADDRESS, NEGRISK_ADDRESS, 0);

  it('generates a valid BUY order signature', async () => {
    const order = await signer.signBuyOrder('12345', 0.80, 100, true);
    expect(order.signature).toBeTruthy();
    expect(order.side).toBe('0');
    expect(order.signatureType).toBe('0');
    expect(order.tokenId).toBe('12345');
    expect(parseInt(order.makerAmount)).toBeGreaterThan(0);
    expect(parseInt(order.makerAmount) % 10000).toBe(0);
  });

  it('generates a valid SELL order signature', async () => {
    const order = await signer.signSellOrder('12345', 0.80, 100, true);
    expect(order.signature).toBeTruthy();
    expect(order.side).toBe('1');
    expect(parseInt(order.makerAmount)).toBeGreaterThan(0);
    expect(parseInt(order.makerAmount) % 10).toBe(0);
    expect(parseInt(order.takerAmount)).toBeGreaterThan(0);
    expect(parseInt(order.takerAmount) % 10000).toBe(0);
  });

  it('swaps makerAmount/takerAmount between BUY and SELL', async () => {
    const buyOrder = await signer.signBuyOrder('12345', 0.80, 100, true);
    const sellOrder = await signer.signSellOrder('12345', 0.80, 100, true);
    expect(parseInt(buyOrder.makerAmount)).toBeCloseTo(parseInt(sellOrder.takerAmount), -3);
    expect(parseInt(buyOrder.takerAmount)).toBeCloseTo(parseInt(sellOrder.makerAmount), -3);
  });

  it('uses EOA address as maker when signatureType is 0', async () => {
    const order = await signer.signBuyOrder('12345', 0.80, 100, true);
    expect(order.maker).toBe(signer.getAddress());
  });

  it('uses Safe address as maker when signatureType is 2', async () => {
    const safeSigner = new AlphaSigner(TEST_PRIVATE_KEY, TEST_SAFE_ADDRESS, CHAIN_ID, CTF_ADDRESS, NEGRISK_ADDRESS, 2);
    const order = await safeSigner.signBuyOrder('12345', 0.80, 100, true);
    expect(order.maker).toBe(TEST_SAFE_ADDRESS);
  });
});
