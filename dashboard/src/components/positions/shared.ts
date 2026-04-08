import { formatTime } from '@/lib/format';
import type { OpenPosition } from '@/lib/types';

export const POSITION_COLUMNS = [
  { key: 'marketId', label: 'Market' },
  { key: 'direction', label: 'Dir' },
  { key: 'shares', label: 'Shares', align: 'right' as const },
  { key: 'entryPrice', label: 'Entry', align: 'right' as const },
  { key: 'time', label: 'Time', align: 'right' as const },
];

/** Map an OpenPosition to a table row object matching POSITION_COLUMNS. */
export function positionToRow(p: OpenPosition, truncateLen = 10) {
  return {
    id: p.marketId,
    marketId: p.marketId.slice(0, truncateLen) + '...',
    direction: p.direction,
    shares: p.shares.toFixed(2),
    entryPrice: `$${p.entryPrice.toFixed(4)}`,
    time: formatTime(p.entryTime, false),
  };
}
