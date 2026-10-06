/**
 * Offres en cours d'une société, lues depuis une adresse web (Brief IA).
 *
 * Deux états, sans cadre autour de la liste (docs/design/06-simplicite.md) :
 *  - choix : toutes les offres, une case par ligne, au plus MAX_BATCH_OFFERS
 *    cochées ; une offre déjà importée comme mission n'est pas cochable ; un lien
 *    « Voir l'offre » ouvre la page source ; au-delà de FILTER_FROM offres, un
 *    champ filtre la liste (la sélection, elle, reste celle de toute la liste) ;
 *  - lecture et analyse : les offres choisies, chacune avec son état.
 *
 * Présentation seule : la sélection, l'analyse et la création vivent dans
 * CreateMissionV2.
 */

import React from 'react';
import { AlertCircle, Check, ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { plural } from '@/lib/plural';
import { cn } from '@/lib/utils';
import type { BulkItem, SourceJob } from './jobSource';

interface JobOffersPickerProps {
  company: string;
  jobs: SourceJob[];
  /** La société a plus d'offres que celles affichées. */
  truncated: boolean;
  /** Adresses des offres déjà importées comme missions. */
  importedUrls: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  maxSelectable: number;
  /** Une fois l'analyse lancée : l'état de chaque offre choisie. */
  items: BulkItem[] | null;
  onToggle: (url: string) => void;
  onToggleAll: () => void;
}

const metaOf = (job: SourceJob): string => [job.location, job.contract].filter(Boolean).join(' · ');

/** Au-delà de ce nombre d'offres, un champ filtre la liste. */
export const FILTER_FROM = 8;

/** Sans accent ni casse : « ingenieur » trouve « Ingénieur ». */
const fold = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const STATUS_LABELS: Record<BulkItem['status'], string> = {
  pending: 'En attente',
  reading: 'Lecture de la fiche',
  analyzing: 'Analyse en cours',
  done: 'Prête',
  error: "L'analyse n'a pas abouti",
  skipped: 'Non analysée',
};

const ItemStatus: React.FC<{ item: BulkItem }> = ({ item }) => {
  const busy = item.status === 'reading' || item.status === 'analyzing';
  return (
    <p
      className={cn(
        'flex max-w-[55%] shrink-0 items-center gap-1.5 text-right text-xs',
        item.status === 'done' && 'text-success',
        item.status === 'error' && 'text-danger',
        (item.status === 'pending' || item.status === 'skipped') && 'text-muted-foreground',
        busy && 'text-foreground-secondary',
      )}
    >
      {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
      {item.status === 'done' && <Check className="size-3.5" aria-hidden="true" />}
      {item.status === 'error' && <AlertCircle className="size-3.5" aria-hidden="true" />}
      {item.status === 'error' || item.status === 'skipped' ? item.error ?? STATUS_LABELS[item.status] : STATUS_LABELS[item.status]}
    </p>
  );
};

export const JobOffersPicker: React.FC<JobOffersPickerProps> = ({
  company, jobs, truncated, importedUrls, selected, maxSelectable, items, onToggle, onToggleAll,
}) => {
  const [query, setQuery] = React.useState('');

  if (items) {
    return (
      <div className="px-6 py-4">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.job.url} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{item.job.title}</p>
                {metaOf(item.job) && <p className="text-xs text-muted-foreground">{metaOf(item.job)}</p>}
              </div>
              <ItemStatus item={item} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const selectable = jobs.filter((j) => !importedUrls.has(j.url)).length;
  const filtering = jobs.length > FILTER_FROM;
  const needle = fold(query.trim());
  // L'indice d'origine garde des identifiants stables quand la liste est filtrée.
  const rows = jobs
    .map((job, i) => ({ job, i }))
    .filter(({ job }) => !filtering || !needle || fold(`${job.title} ${metaOf(job)}`).includes(needle));
  const allLabel = selected.size > 0
    ? 'Tout désélectionner'
    : selectable > maxSelectable
      ? `Sélectionner les ${maxSelectable} premières`
      : 'Tout sélectionner';

  return (
    <div className="px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-secondary">
          {plural(jobs.length, 'offre')} en cours chez {company}. {plural(maxSelectable, 'offre')} au plus à la fois.
        </p>
        {selectable > 0 && (!needle || selected.size > 0) && (
          <Button variant="ghost" size="xs" onClick={onToggleAll}>
            {allLabel}
          </Button>
        )}
      </div>
      {truncated && (
        <p className="mt-1 text-xs text-muted-foreground">Seules les premières offres sont affichées.</p>
      )}
      {filtering && (
        <div className="mt-3">
          <Label htmlFor="offers-filter" className="sr-only">Filtrer les offres</Label>
          <Input
            id="offers-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer par intitulé ou par lieu"
            autoComplete="off"
          />
        </div>
      )}
      {rows.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Aucune offre ne correspond.</p>}
      <ul className="mt-2 divide-y divide-border">
        {rows.map(({ job, i }) => {
          const imported = importedUrls.has(job.url);
          const checked = selected.has(job.url);
          const full = !checked && selected.size >= maxSelectable;
          const id = `offer-${i}`;
          return (
            <li key={job.url} className="flex items-start gap-3 py-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={checked}
                disabled={imported || full}
                onCheckedChange={() => onToggle(job.url)}
              />
              <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer space-y-0.5 font-normal leading-snug">
                <span className="block break-words text-sm font-medium">{job.title}</span>
                {metaOf(job) && <span className="block text-xs text-muted-foreground">{metaOf(job)}</span>}
              </Label>
              {imported && <Badge variant="muted">Déjà importée</Badge>}
              <Button
                asChild
                variant="ghost"
                size="xs"
                className="shrink-0 text-muted-foreground hover:text-foreground max-sm:min-h-11 max-sm:min-w-11"
              >
                <a href={job.url} target="_blank" rel="noopener noreferrer" aria-label={`Voir l'offre ${job.title} (nouvel onglet)`}>
                  <span className="max-sm:sr-only">Voir l'offre</span>
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
