interface Props {
  label: string;
  value: string | number;
  color?: 'green' | 'red' | 'yellow' | 'cyan' | 'default';
  size?: 'sm' | 'lg';
}

const COLOR_MAP: Record<string, string> = {
  green: 'text-bb-green',
  red: 'text-bb-red',
  yellow: 'text-bb-yellow',
  cyan: 'text-bb-cyan',
  default: 'text-bb-text',
};

export function StatCell({ label, value, color = 'default', size = 'sm' }: Props) {
  const valueSize = size === 'lg' ? 'text-[16px]' : 'text-[11px]';
  const colorClass = COLOR_MAP[color] ?? COLOR_MAP.default;

  return (
    <div className="flex flex-col gap-0.5 font-mono">
      <span className="text-[10px] uppercase tracking-wider text-bb-dim leading-none">
        {label}
      </span>
      <span className={`${valueSize} ${colorClass} leading-none tabular-nums`}>
        {value}
      </span>
    </div>
  );
}
