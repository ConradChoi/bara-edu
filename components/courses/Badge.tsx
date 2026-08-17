type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-n-2 text-n-7',
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export default function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${TONE_CLASS[tone]}`}>{children}</span>;
}
