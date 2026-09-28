/**
 * CandidateAutocomplete — champ de recherche d'un candidat existant, avec
 * l'option de créer un nouveau candidat au passage.
 *
 * Combobox accessible (motif ARIA « combobox + listbox ») :
 * - deux caractères au moins lancent la recherche (useCandidateSearch) ;
 * - flèches haut et bas pour parcourir, Entrée pour choisir l'option active,
 *   Échap pour fermer la liste sans fermer le dialogue qui la contient ;
 * - rien n'est choisi d'office : Entrée sans option active ne fait rien.
 *
 * Sélection :
 * - existant : candidateId, nom, intitulé, photo ;
 * - nouveau : nom saisi et candidateId null, le parent crée le candidat à
 *   l'enregistrement.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, UserPlus, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { useCandidateSearch, type CandidateSearchResult } from '@/hooks/useCandidateSearch';
import { cn } from '@/lib/utils';

export interface SelectedCandidate {
  /** Si null = nouveau candidat à créer */
  candidateId: string | null;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  linkedinUrl: string | null;
}

interface CandidateAutocompleteProps {
  value: SelectedCandidate | null;
  onChange: (candidate: SelectedCandidate | null) => void;
  /** Pour le state intermédiaire de saisie quand pas encore sélectionné */
  defaultName?: string;
  /** Identifiant du champ, pour un <Label htmlFor>. */
  id?: string;
  /** Phrase d'aide reliée au champ (aria-describedby). */
  describedBy?: string;
  /** Ce que devient un nouveau candidat, sous l'option « Créer » (dépend de l'écran). */
  createHint?: string;
}

type Option =
  | { kind: 'existing'; result: CandidateSearchResult }
  | { kind: 'new'; name: string };

export const CandidateAutocomplete: React.FC<CandidateAutocompleteProps> = ({
  value,
  onChange,
  defaultName = '',
  id,
  describedBy,
  createHint = 'Nouveau candidat, enregistré avec cette tâche',
}) => {
  const [query, setQuery] = useState(value?.name ?? defaultName);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;

  const { results, loading } = useCandidateSearch(open ? query : '');

  const trimmed = query.trim();
  const showCreateOption =
    trimmed.length >= 2 && !results.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());
  const options: Option[] = [
    ...results.map((result) => ({ kind: 'existing' as const, result })),
    ...(showCreateOption ? [{ kind: 'new' as const, name: trimmed }] : []),
  ];
  const listOpen = open && options.length > 0;

  // Une nouvelle liste repart sans option active : rien n'est choisi d'office.
  useEffect(() => {
    setActiveIndex(-1);
  }, [query, results.length]);

  // Fermeture au clic en dehors
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const choose = (option: Option) => {
    if (option.kind === 'existing') {
      const r = option.result;
      onChange({ candidateId: r.candidateId, name: r.name, headline: r.headline, avatarUrl: r.avatarUrl, linkedinUrl: r.linkedinUrl });
      setQuery(r.name);
    } else {
      onChange({ candidateId: null, name: option.name, headline: null, avatarUrl: null, linkedinUrl: null });
    }
    setOpen(false);
  };

  const clearSelection = () => {
    onChange(null);
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (options.length > 0) setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length > 0) setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && listOpen) {
      // Liste ouverte : Entrée choisit l'option active, sans envoyer le formulaire.
      e.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) choose(options[activeIndex]);
    } else if (e.key === 'Escape' && listOpen) {
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  // Candidat choisi : carte récapitulative avec « Changer »
  if (value && !open) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5">
        <CandidateAvatar name={value.name} avatarUrl={value.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{value.name}</span>
            {value.candidateId === null && <Badge variant="muted">Nouveau candidat</Badge>}
          </div>
          {value.headline && <div className="truncate text-xs text-muted-foreground">{value.headline}</div>}
        </div>
        <Button type="button" variant="ghost" size="xs" onClick={clearSelection} aria-label={`Changer de candidat (${value.name})`}>
          Changer
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={describedBy}
          data-suggestions-open={listOpen ? 'true' : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Une nouvelle saisie annule le choix précédent (évite l'incohérence)
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Nom du candidat"
          className="pl-8 pr-8"
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label="Candidats"
        hidden={!listOpen}
        className="absolute left-0 right-0 z-popover mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
      >
        {options.map((option, i) => {
          const active = i === activeIndex;
          if (option.kind === 'existing') {
            const r = option.result;
            return (
              <li
                key={r.candidateId}
                id={optionId(i)}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                onMouseMove={() => setActiveIndex(i)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5', active && 'bg-accent')}
              >
                <CandidateAvatar name={r.name} avatarUrl={r.avatarUrl} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{r.name}</span>
                  {r.headline && <span className="block truncate text-xs text-muted-foreground">{r.headline}</span>}
                </span>
              </li>
            );
          }
          return (
            <li
              key="new"
              id={optionId(i)}
              role="option"
              aria-selected={active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              onMouseMove={() => setActiveIndex(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5',
                results.length > 0 && 'mt-1 border-t border-border pt-2',
                active && 'bg-accent',
              )}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-foreground-secondary">
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">Créer « {option.name} »</span>
                <span className="block truncate text-xs text-muted-foreground">{createHint}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
