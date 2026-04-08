import Decimal from 'decimal.js';
import { PaperSimulator } from '../paper-simulator';
import { OrderbookChecker } from '../orderbook-checker';
import { Config, MomentumDecision } from '../types';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

function createMockChecker(asks: Array<{ price: string; size: string }>): OrderbookChecker {
  const checker = new OrderbookChecker({ clobApiUrl: 'https://fake' } as Config);
  checker.fetchOrderBook = jest.fn().mockResolvedValue({
    asks,
    bids: [],
    fetchedAt: Date.now(),
  });
  return checker;
}

function makeDecision(overrides: Partial<MomentumDecision> = {}): MomentumDecision {
  return {
    direction: 'UP',
    tokenId: 'token-123',
    entryPrice: new Decimal('0.92'),
    shares: new Decimal('50'),
    totalCost: new Decimal('46'),
    expectedProfit: new Decimal('4'),
    expectedLoss: new Decimal('46'),
    deltaBps: 15,
    ...overrides,
  };
}

describe('PaperSimulator', () => {
  it('full fill: enough liquidity at limit price', async () => {
    const checker = createMockChecker([
      { price: '0.88', size: '30' },
      { price: '0.90', size: '30' },
    ]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision({ shares: new Decimal('50') }));

    expect(result.success).toBe(true);
    expect(result.fillShares.toNumber()).toBe(50);
    expect(result.fillRatio).toBe(1);
    expect(result.partialFill).toBe(false);
    expect(result.missedFill).toBe(false);
    expect(result.bestAskPrice.toNumber()).toBe(0.88);
  });

  it('partial fill: not enough liquidity', async () => {
    const checker = createMockChecker([
      { price: '0.90', size: '30' },
    ]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision({ shares: new Decimal('50') }));

    expect(result.success).toBe(true);
    expect(result.fillShares.toNumber()).toBe(30);
    expect(result.fillRatio).toBeCloseTo(0.6, 2);
    expect(result.partialFill).toBe(true);
    expect(result.missedFill).toBe(false);
  });

  it('missed fill: empty order book', async () => {
    const checker = createMockChecker([]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision());

    expect(result.success).toBe(false);
    expect(result.fillShares.toNumber()).toBe(0);
    expect(result.missedFill).toBe(true);
    expect(result.fillRatio).toBe(0);
  });

  it('missed fill: all asks above entry price', async () => {
    const checker = createMockChecker([
      { price: '0.96', size: '100' },
    ]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision({ entryPrice: new Decimal('0.92') }));

    expect(result.success).toBe(false);
    expect(result.missedFill).toBe(true);
  });

  it('minimum shares edge: exactly 5 shares available', async () => {
    const checker = createMockChecker([
      { price: '0.90', size: '5' },
    ]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision({ shares: new Decimal('50') }));

    expect(result.success).toBe(true);
    expect(result.fillShares.toNumber()).toBe(5);
    expect(result.partialFill).toBe(true);
  });

  it('below minimum: 4 shares available', async () => {
    const checker = createMockChecker([
      { price: '0.90', size: '4' },
    ]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision({ shares: new Decimal('50') }));

    expect(result.success).toBe(false);
    expect(result.missedFill).toBe(true);
  });

  it('slippage calculation: multi-level fill', async () => {
    const checker = createMockChecker([
      { price: '0.88', size: '20' },
      { price: '0.90', size: '30' },
      { price: '0.92', size: '50' },
    ]);
    const sim = new PaperSimulator(checker);

    const result = await sim.simulateFill(makeDecision({
      shares: new Decimal('100'),
      entryPrice: new Decimal('0.95'),
    }));

    expect(result.success).toBe(true);
    expect(result.fillShares.toNumber()).toBe(100);
    expect(result.bestAskPrice.toNumber()).toBe(0.88);
    // VWAP = (20*0.88 + 30*0.90 + 50*0.92) / 100 = 90.6 / 100 = 0.906
    expect(result.fillPrice.toNumber()).toBeCloseTo(0.906, 3);
    // Slippage = (0.906 - 0.88) / 0.88 * 10000 ≈ 295.45 bps
    expect(result.slippageBps).toBeCloseTo(295.45, 0);
    expect(result.bookDepthLevels).toBe(3);
    expect(result.totalCost.toNumber()).toBeCloseTo(90.6, 1);
  });

  it('records requestedShares and requestedPrice correctly', async () => {
    const checker = createMockChecker([
      { price: '0.90', size: '100' },
    ]);
    const sim = new PaperSimulator(checker);

    const decision = makeDecision({
      shares: new Decimal('50'),
      entryPrice: new Decimal('0.92'),
    });
    const result = await sim.simulateFill(decision);

    expect(result.requestedShares.toNumber()).toBe(50);
    expect(result.requestedPrice.toNumber()).toBe(0.92);
  });
});
