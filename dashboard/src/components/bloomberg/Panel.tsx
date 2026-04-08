import type { ReactNode } from 'react';

interface Props {
  title?: string;
  live?: boolean;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, live, right, className, children }: Props) {
  return (
    <div className={`border border-bb-border bg-bb-panel ${className ?? ''}`}>
      {title && (
        <div className="flex items-center justify-between px-2 py-1 border-b border-bb-border">
          <div className="flex items-center gap-1.5">
            {live && (
              <span className="w-1.5 h-1.5 bg-bb-green bb-blink" />
            )}
            <span className="text-[10px] uppercase tracking-wider text-bb-cyan font-medium">
              {title}
            </span>
          </div>
          {right && <div className="flex items-center gap-1.5">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
