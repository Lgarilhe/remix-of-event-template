// Barre de répartition des inscrits d'une séquence (lot 5c-2) : en cours, ont
// répondu, en pause, en échec, terminées, dans cet ordre. Une part vide n'est
// ni dessinée ni nommée ; le nom accessible et l'infobulle disent les nombres.
import { cn } from '@/lib/utils';
import { progressLabel, type ProgressSegments } from '@/lib/sequenceTableStats';

const PARTS: ReadonlyArray<{ key: keyof Omit<ProgressSegments, 'total'>; fill: string }> = [
  { key: 'active', fill: 'bg-foreground-secondary' },
  { key: 'replied', fill: 'bg-brand' },
  { key: 'paused', fill: 'bg-warning' },
  { key: 'failed', fill: 'bg-danger' },
  { key: 'done', fill: 'bg-muted-foreground/50' },
];

export function EnrollmentProgressBar({ segments, className }: { segments: ProgressSegments; className?: string }) {
  const label = progressLabel(segments);
  if (segments.total <= 0) return null;
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={cn('flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted', className)}
    >
      {PARTS.map(({ key, fill }) => {
        const value = segments[key];
        if (value <= 0) return null;
        return <span key={key} className={cn('h-full', fill)} style={{ width: `${(value / segments.total) * 100}%` }} />;
      })}
    </div>
  );
}
