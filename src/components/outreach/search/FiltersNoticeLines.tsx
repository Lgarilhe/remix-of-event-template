import { searchFiltersNoticeLines, type SearchFiltersNotice } from '@/lib/searchFilterNotice';
import { cn } from '@/lib/utils';

interface FiltersNoticeLinesProps {
  notice: SearchFiltersNotice | null | undefined;
  /** Ancienne page et recherches hors mission : le texte tient dans la barre sous le cadre, comme le décompte des candidats. */
  bordered?: boolean;
}

/**
 * Une ligne discrète au-dessus des résultats : filtres que le compte LinkedIn n'a pas appliqués, ou appliqués
 * de façon approchée. Texte : `src/lib/searchFilterNotice.ts`. Rien n'est rendu quand il n'y a rien à dire.
 */
export function FiltersNoticeLines({ notice, bordered = false }: FiltersNoticeLinesProps) {
  const lines = searchFiltersNoticeLines(notice);
  if (lines.length === 0) return null;
  return (
    <div
      role="status"
      className={cn('shrink-0 space-y-0.5 text-sm text-foreground-secondary', bordered ? 'border-b border-border px-4 py-2' : 'pb-2.5')}
    >
      {lines.map((line) => <p key={line}>{line}</p>)}
    </div>
  );
}
