/**
 * CandidateAutocomplete — input avec dropdown suggérant les candidats
 * existants matching la frappe + fallback "Créer comme nouveau candidat".
 *
 * - Tape ≥2 caractères → fetch debounced via useCandidateSearch
 * - Suggestion : avatar + nom + headline + URL LinkedIn (cliquable)
 * - "Créer X comme nouveau candidat" en bas du dropdown
 *
 * Sélection :
 * - Existant → fournit candidateId + name + headline + avatar au parent
 * - Nouveau → fournit name (saisi) + null candidateId, le parent gère la
 *   création côté DB au moment du submit
 */

import React, { useRef, useState, useEffect } from 'react';
import { Search, UserPlus, Loader2, ExternalLink, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
}

export const CandidateAutocomplete: React.FC<CandidateAutocompleteProps> = ({
  value,
  onChange,
  defaultName = '',
}) => {
  const [query, setQuery] = useState(value?.name ?? defaultName);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results, loading } = useCandidateSearch(open ? query : '');

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const showCreateOption =
    query.trim().length >= 2 &&
    !results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase());

  const selectExisting = (r: CandidateSearchResult) => {
    onChange({
      candidateId: r.candidateId,
      name: r.name,
      headline: r.headline,
      avatarUrl: r.avatarUrl,
      linkedinUrl: r.linkedinUrl,
    });
    setQuery(r.name);
    setOpen(false);
  };

  const selectNew = () => {
    const name = query.trim();
    if (!name) return;
    onChange({
      candidateId: null,
      name,
      headline: null,
      avatarUrl: null,
      linkedinUrl: null,
    });
    setOpen(false);
  };

  const clearSelection = () => {
    onChange(null);
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  };

  // Si déjà sélectionné, on affiche un "chip" avec le candidat choisi
  if (value && !open) {
    return (
      <div className="rounded-lg border border-border bg-card p-2.5 flex items-center gap-3">
        <CandidateAvatar name={value.name} avatarUrl={value.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-foreground text-sm truncate tracking-tight">
              {value.name}
            </span>
            {value.candidateId === null && (
              <span className="inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-full ring-1 ring-emerald-500/30">
                Nouveau
              </span>
            )}
          </div>
          {value.headline && (
            <div className="text-[11px] text-muted-foreground truncate">{value.headline}</div>
          )}
        </div>
        <button
          type="button"
          onClick={clearSelection}
          className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
        >
          Changer
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Reset value si on retape (évite incohérence)
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length > 0) {
              e.preventDefault();
              selectExisting(results[0]);
            } else if (e.key === 'Enter' && showCreateOption) {
              e.preventDefault();
              selectNew();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Tape un nom — chercher ou créer…"
          className="h-9 pl-8 rounded-lg"
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
        )}
      </div>

      {open && (results.length > 0 || showCreateOption) && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          {/* Existing candidates */}
          {results.length > 0 && (
            <div className="py-1">
              <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Candidats existants
              </div>
              {results.map((r) => (
                <button
                  key={r.candidateId}
                  type="button"
                  onClick={() => selectExisting(r)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-muted/40 transition-colors"
                >
                  <CandidateAvatar
                    name={r.name}
                    avatarUrl={r.avatarUrl}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-display font-semibold text-foreground truncate tracking-tight">
                      {r.name}
                    </div>
                    {r.headline && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.headline}
                      </div>
                    )}
                  </div>
                  {r.linkedinUrl && (
                    <a
                      href={r.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title="Ouvrir LinkedIn"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Create new */}
          {showCreateOption && (
            <div className={cn('py-1', results.length > 0 && 'border-t border-border')}>
              <button
                type="button"
                onClick={selectNew}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-emerald-500/10 transition-colors group"
              >
                <div className="h-8 w-8 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/25 transition-colors">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    Créer "<span className="font-bold">{query.trim()}</span>" comme nouveau
                    candidat
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Ajouté au pipeline en "Pressenti" sur la mission sélectionnée
                  </div>
                </div>
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
