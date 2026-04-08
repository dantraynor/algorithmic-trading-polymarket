export function kellyFraction(confidence: number, ask: number): number {
  const edge = confidence - ask;
  if (edge <= 0) return 0;
  return edge / (1 - ask);
}

export function kellyBetSize(
  confidence: number,
  ask: number,
  bankroll: number,
  kellyMultiplier: number,
  maxBetPct: number = 1.0,
  availableLiquidity: number = Infinity,
  takerFeeBps: number = 0,
): number {
  const fee = takerFeeBps / 10_000;
  const netConfidence = confidence - fee;
  const edge = netConfidence - ask;
  if (edge <= 0) return 0;

  const fraction = edge / (1 - ask);
  const rawBet = bankroll * fraction * kellyMultiplier;
  const maxBet = bankroll * maxBetPct;

  return Math.min(rawBet, maxBet, availableLiquidity);
}
