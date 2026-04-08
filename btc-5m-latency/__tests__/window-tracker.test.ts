import Decimal from 'decimal.js';
import { WindowTracker } from '../src/window-tracker';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

describe('WindowTracker', () => {
  let tracker: WindowTracker;

  beforeEach(() => {
    tracker = new WindowTracker();
  });

  it('starts a window with correct initial state', () => {
    tracker.startWindow(1000, new Decimal(65000));
    const w = tracker.getCurrentWindow(1000);

    expect(w).not.toBeNull();
    expect(w!.priceToBeat.toNumber()).toBe(65000);
    expect(w!.upSharesHeld.toNumber()).toBe(0);
    expect(w!.downSharesHeld.toNumber()).toBe(0);
    expect(w!.numTrades).toBe(0);
    expect(w!.outcome).toBeNull();
  });

  it('records UP fills and updates avg cost', () => {
    tracker.startWindow(1000, new Decimal(65000));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.80), new Decimal(0.10));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.85), new Decimal(0.08));

    const w = tracker.getCurrentWindow(1000)!;
    expect(w.upSharesHeld.toNumber()).toBe(20);
    expect(w.numTrades).toBe(2);
    // Avg cost = (10*0.80 + 10*0.85) / 20 = 16.5 / 20 = 0.825
    expect(w.upAvgCost.toNumber()).toBeCloseTo(0.825, 3);
    expect(w.totalVolume.toNumber()).toBeCloseTo(16.5, 3);
  });

  it('records DOWN fills independently', () => {
    tracker.startWindow(1000, new Decimal(65000));
    tracker.recordFill(1000, 'DOWN', new Decimal(5), new Decimal(0.30), new Decimal(0.12));

    const w = tracker.getCurrentWindow(1000)!;
    expect(w.downSharesHeld.toNumber()).toBe(5);
    expect(w.downAvgCost.toNumber()).toBeCloseTo(0.30, 3);
    expect(w.upSharesHeld.toNumber()).toBe(0);
  });

  it('tracks max edge and avg edge', () => {
    tracker.startWindow(1000, new Decimal(65000));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.80), new Decimal(0.10));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.85), new Decimal(0.15));

    const w = tracker.getCurrentWindow(1000)!;
    expect(w.maxEdgeSeen.toNumber()).toBe(0.15);
    expect(w.avgEdgeAtFill.toNumber()).toBeCloseTo(0.125, 3);
  });

  it('settles UP outcome correctly', () => {
    tracker.startWindow(1000, new Decimal(65000));
    // Buy 10 UP shares at $0.80 each -> cost $8
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.80), new Decimal(0.10));

    // Final price >= price to beat -> UP wins
    const pnl = tracker.settleWindow(1000, new Decimal(65100));

    expect(pnl.outcome).toBe('UP');
    // gross pnl = 10 * $1 - $8 = $2
    expect(pnl.grossPnl.toNumber()).toBeCloseTo(2, 3);
  });

  it('settles DOWN outcome correctly', () => {
    tracker.startWindow(1000, new Decimal(65000));
    // Buy 10 DOWN shares at $0.30 each -> cost $3
    tracker.recordFill(1000, 'DOWN', new Decimal(10), new Decimal(0.30), new Decimal(0.12));

    // Final price < price to beat -> DOWN wins
    const pnl = tracker.settleWindow(1000, new Decimal(64900));

    expect(pnl.outcome).toBe('DOWN');
    // gross pnl = 10 * $1 - $3 = $7
    expect(pnl.grossPnl.toNumber()).toBeCloseTo(7, 3);
  });

  it('handles losing window (UP bought, DOWN wins)', () => {
    tracker.startWindow(1000, new Decimal(65000));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.80), new Decimal(0.10));

    // DOWN wins
    const pnl = tracker.settleWindow(1000, new Decimal(64900));

    expect(pnl.outcome).toBe('DOWN');
    // gross pnl = 0 - $8 = -$8
    expect(pnl.grossPnl.toNumber()).toBeCloseTo(-8, 3);
  });

  it('handles both sides in same window', () => {
    tracker.startWindow(1000, new Decimal(65000));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.80), new Decimal(0.10));
    tracker.recordFill(1000, 'DOWN', new Decimal(5), new Decimal(0.15), new Decimal(0.08));

    // UP wins: UP shares pay out, DOWN shares worthless
    const pnl = tracker.settleWindow(1000, new Decimal(65100));

    expect(pnl.outcome).toBe('UP');
    // gross pnl = 10 * $1 + 0 - (8 + 0.75) = 10 - 8.75 = 1.25
    expect(pnl.grossPnl.toNumber()).toBeCloseTo(1.25, 3);
    expect(pnl.numTrades).toBe(2);
  });

  it('hasTraded returns false for untraded window', () => {
    tracker.startWindow(1000, new Decimal(65000));
    expect(tracker.hasTraded(1000)).toBe(false);
  });

  it('hasTraded returns true after a fill', () => {
    tracker.startWindow(1000, new Decimal(65000));
    tracker.recordFill(1000, 'UP', new Decimal(10), new Decimal(0.80), new Decimal(0.10));
    expect(tracker.hasTraded(1000)).toBe(true);
  });

  it('settles window with no trades to zero P&L', () => {
    tracker.startWindow(1000, new Decimal(65000));
    const pnl = tracker.settleWindow(1000, new Decimal(65100));

    expect(pnl.grossPnl.toNumber()).toBe(0);
    expect(pnl.numTrades).toBe(0);
  });
});
