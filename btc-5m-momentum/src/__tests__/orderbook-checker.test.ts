import Decimal from 'decimal.js';
import { OrderbookChecker } from '../orderbook-checker';
import { Config, OrderBookLevel } from '../types';

function createChecker(): OrderbookChecker {
  return new OrderbookChecker({ clobApiUrl: 'https://fake' } as Config);
}

describe('OrderbookChecker', () => {
  describe('getAvailableLiquidity', () => {
    const checker = createChecker();

    it('returns null for empty asks', () => {
      const result = checker.getAvailableLiquidity([], new Decimal('0.95'), new Decimal('100'));
      expect(result).toBeNull();
    });

    it('returns null when total shares below minimum (5)', () => {
      const asks: OrderBookLevel[] = [
        { price: '0.90', size: '3' }, // Only 3 shares, below min of 5
      ];
      const result = checker.getAvailableLiquidity(asks, new Decimal('0.95'), new Decimal('100'));
      expect(result).toBeNull();
    });

    it('walks ask levels and returns correct liquidity', () => {
      const asks: OrderBookLevel[] = [
        { price: '0.88', size: '20' },
        { price: '0.90', size: '30' },
        { price: '0.92', size: '50' },
      ];

      const result = checker.getAvailableLiquidity(asks, new Decimal('0.95'), new Decimal('100'));
      expect(result).not.toBeNull();
      expect(result!.availableShares.toNumber()).toBe(100);
      // 20*0.88 + 30*0.90 + 50*0.92 = 17.6 + 27 + 46 = 90.6
      expect(result!.totalCost.toNumber()).toBeCloseTo(90.6, 2);
      expect(result!.worstPrice.toString()).toBe('0.92');
      // VWAP = 90.6 / 100 = 0.906
      expect(result!.vwapPrice.toNumber()).toBeCloseTo(0.906, 3);
    });

    it('stops at maxPrice', () => {
      const asks: OrderBookLevel[] = [
        { price: '0.88', size: '20' },
        { price: '0.90', size: '30' },
        { price: '0.96', size: '50' }, // Above maxPrice of 0.95
      ];

      const result = checker.getAvailableLiquidity(asks, new Decimal('0.95'), new Decimal('100'));
      expect(result).not.toBeNull();
      expect(result!.availableShares.toNumber()).toBe(50); // 20 + 30
      expect(result!.worstPrice.toNumber()).toBe(0.9);
    });

    it('caps at maxShares', () => {
      const asks: OrderBookLevel[] = [
        { price: '0.90', size: '100' },
      ];

      const result = checker.getAvailableLiquidity(asks, new Decimal('0.95'), new Decimal('50'));
      expect(result).not.toBeNull();
      expect(result!.availableShares.toNumber()).toBe(50);
      expect(result!.totalCost.toNumber()).toBeCloseTo(45, 2); // 50 * 0.90
    });

    it('partially fills from a level when capped', () => {
      const asks: OrderBookLevel[] = [
        { price: '0.88', size: '30' },
        { price: '0.90', size: '100' }, // We only need 20 more from this level
      ];

      const result = checker.getAvailableLiquidity(asks, new Decimal('0.95'), new Decimal('50'));
      expect(result).not.toBeNull();
      expect(result!.availableShares.toNumber()).toBe(50);
      // 30*0.88 + 20*0.90 = 26.4 + 18 = 44.4
      expect(result!.totalCost.toNumber()).toBeCloseTo(44.4, 2);
      expect(result!.worstPrice.toNumber()).toBe(0.9);
    });
  });
});
