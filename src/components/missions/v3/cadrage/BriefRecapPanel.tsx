// Refonte mission, écran Cadrage : « Le poste » dans la fenêtre du brief vocal.
// Le recruteur voit le poste se construire pendant qu'il répond : seulement ce
// qui est renseigné, rien de vide, et un badge « Noté » sur ce que la dernière
// réponse vient d'apporter. Deux présentations d'un même contenu : une colonne
// creusée à droite dès md (BriefRecapAside), une ligne qui s'ouvre sous md
// (BriefRecapSummary). L'anneau est celui du bandeau, passé tel quel : la fenêtre
// et la page derrière disent la même chose à chaque instant.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Illustration } from '@/components/ui/illustration';
import { cn } from '@/lib/utils';
import type { CadrageReadiness } from './cadrageModel';
import type { RecapRow } from './briefInterviewModel';
import { TOUCH } from './sectionUi';

interface PosteProps {
  readiness: Pick<CadrageReadiness, 'status' | 'title' | 'sentence'>;
  /** L'anneau du bandeau, passé tel quel (même calcul que la page derrière la fenêtre). */
  ring: ReactNode;
  rows: RecapRow[];
  /** Lignes remplies par la dernière réponse. */
  freshIds: ReadonlySet<string>;
  /** Change à chaque réponse : relance l'apparition des lignes. */
  freshKey: number;
  /** Quand le poste est prêt, un lien discret pour partir sans attendre la fin des questions. */
  onContinue?: () => void;
}

function PosteRows({ rows, freshIds, freshKey }: Pick<PosteProps, 'rows' | 'freshIds' | 'freshKey'>) {
  if (rows.length === 0) {
    return (
      <div className="m-auto flex max-w-56 flex-col items-center gap-3 py-6 text-center">
        <Illustration name="brief" size="sm" tile={false} className="max-md:hidden" />
        <p className="text-sm text-muted-foreground">Le poste se construit ici, réponse après réponse.</p>
      </div>
    );
  }
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => {
        const fresh = freshIds.has(row.id);
        return (
          <div
            key={fresh ? `${row.id}-${freshKey}` : row.id}
            data-fresh={fresh || undefined}
            className={cn('flex flex-col gap-1 py-3 first:pt-0', fresh && 'konekt-fade-up')}
          >
            <dt className="flex items-center gap-2 text-xs text-muted-foreground">
              {row.label}
              {fresh && <Badge variant="brand">Noté</Badge>}
            </dt>
            <dd className="min-w-0">
              {row.items ? (
                <ul className="flex flex-col gap-1">
                  {row.items.map((item) => (
                    <li key={item.text} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-sm text-foreground">{item.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{item.note}</span>
                    </li>
                  ))}
                </ul>
              ) : row.chips ? (
                <ul className="flex flex-wrap gap-1.5">
                  {row.chips.map((chip) => (
                    <li key={chip}>
                      <Badge variant="muted">{chip}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={cn('break-words text-sm text-foreground', row.long && 'line-clamp-3')}>{row.value}</p>
              )}
              {row.hint && <p className="mt-1 text-xs text-muted-foreground">{row.hint}</p>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Colonne de droite (md et plus) : le poste, creusé en bg-background, sans filet vertical. */
export function BriefRecapAside({ readiness, ring, rows, freshIds, freshKey, onContinue }: PosteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // La première ligne remplie reste visible, sans faire défiler autre chose que cette liste.
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>('[data-fresh="true"]');
    if (!box || !el) return;
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
  }, [freshKey]);
  return (
    <aside aria-label="Le poste" className="hidden min-h-0 flex-col gap-4 bg-background px-4 py-5 md:flex">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          {ring}
          <p className="text-md font-semibold text-foreground">{readiness.title}</p>
        </div>
        <p className="text-sm text-muted-foreground">{readiness.sentence}</p>
        {readiness.status === 'ready' && onContinue && (
          <Button type="button" variant="ghost" size="sm" onClick={onContinue} className="-ml-3 self-start">
            Aller au sourcing
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
      <div ref={listRef} role="region" aria-label="Ce qui est noté dans le brief" tabIndex={0} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PosteRows rows={rows} freshIds={freshIds} freshKey={freshKey} />
      </div>
    </aside>
  );
}

/** Téléphone et petite tablette (moins de md) : une ligne d'avancement qui s'ouvre. L'anneau reste HORS du Button. */
export function BriefRecapSummary({ readiness, ring, rows, freshIds, freshKey, onContinue }: PosteProps) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="md:hidden">
      <div className="flex items-center gap-3 rounded-lg bg-background px-3 py-1">
        {ring}
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className={cn('h-auto min-w-0 flex-1 justify-between gap-3 whitespace-normal rounded-lg px-2 py-1.5 text-left', TOUCH)}>
            <span className="min-w-0 flex-1">
              <span className="block text-md font-semibold text-foreground">{readiness.title}</span>
              <span className="block truncate text-sm font-normal text-muted-foreground">{readiness.sentence}</span>
            </span>
            <ChevronDown className={cn('transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
            <span className="sr-only">{open ? 'Masquer ce qui est noté' : 'Voir ce qui est noté'}</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-3 rounded-lg bg-background px-3 py-3">
          {readiness.status === 'ready' && onContinue && (
            <Button type="button" variant="ghost" size="sm" onClick={onContinue} className={cn('-ml-2 self-start', TOUCH)}>
              Aller au sourcing
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
          <PosteRows rows={rows} freshIds={freshIds} freshKey={freshKey} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
