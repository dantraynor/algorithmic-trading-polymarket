import type { ReactNode } from 'react';

interface Props {
  label: string;
  live?: boolean;
  right?: ReactNode;
}

/**
 * Sub-section divider used INSIDE a Panel to separate logical groups.
 *
 * This is NOT a replacement for Panel — Panel is a container with a title bar,
 * border, and optional `right` slot. SectionHeader is a lightweight divider
 * for grouping rows within a Panel (e.g. separating "Signal Quality" from
 * "Position Stats" inside the BtcLatencyPanel).
 */
export function SectionHeader({ label, live, right }: Props) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-b border-bb-border">
      <div className="flex items-center gap-1.5">
        {live && (
          <span className="w-1.5 h-1.5 bg-bb-green bb-blink" />
        )}
        <span className="text-[10px] uppercase tracking-wider text-bb-cyan font-medium">
          {label}
        </span>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
