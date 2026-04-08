interface Props {
  status: 'up' | 'down' | 'warn' | 'stale';
  label?: string;
}

const STATUS_COLORS: Record<Props['status'], string> = {
  up: 'bg-bb-green',
  down: 'bg-bb-red',
  warn: 'bg-bb-yellow',
  stale: 'bg-bb-muted',
};

export function StatusDot({ status, label }: Props) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 ${STATUS_COLORS[status]}`} />
      {label && (
        <span className="text-[10px] text-bb-dim uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}
