/**
 * Barre de recherche en langage naturel — l'entrée principale du sourcing.
 *
 * L'utilisateur décrit le candidat idéal en une phrase ; l'IA Konekt
 * (`generate-search-filters`) la traduit en filtres éditables. En contexte
 * mission, la phrase augmente le brief (voir `buildAugmentedJob`).
 *
 * Style : registre « Linear/Qonto » via les tokens --k-* (voir index.css) —
 * hiérarchie par la lumière + filets 1px, un seul accent indigo discret ;
 * ici il ne vit que dans le glyphe IA au focus et dans l'action une fois
 * la barre remplie.
 */
import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { Job } from '@/types/jobs';
import { LinkedInFiltersState, LocationFilterItem } from '@/components/outreach/types';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import type { FilterSuggestions } from './SearchFiltersPanel';
import { buildAugmentedJob, generateFiltersFromJob } from './generateFiltersFromJob';

interface SearchPromptBarProps {
  selectedJob: Job | null;
  accountId: string | null;
  searchSource: 'linkedin' | 'database';
  currentLocation?: LocationFilterItem[];
  onApplyFilters: (update: Partial<LinkedInFiltersState>) => void;
  onSuggestionsGenerated?: (suggestions: FilterSuggestions | null) => void;
  disabled?: boolean;
}

const EXAMPLES = [
  'Head of Sales SaaS B2B, Paris, a scalé une équipe commerciale',
  'Ingénieur DevOps AWS + Terraform, 5 ans+, ouvert au remote',
];

/** Glyphe IA : burst de 6 rayons (pas un sparkle) — prend l'accent au focus. */
const AiBurst = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
    <path d="M14.08 13.2 17.2 15M12 14.4V18M9.92 13.2 6.8 15M9.92 10.8 6.8 9M12 9.6V6M14.08 10.8 17.2 9" />
  </svg>
);

export const SearchPromptBar: React.FC<SearchPromptBarProps> = ({
  selectedJob,
  accountId,
  searchSource,
  currentLocation,
  onApplyFilters,
  onSuggestionsGenerated,
  disabled,
}) => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const armed = value.trim().length > 0;
  const accentActive = focused || armed;

  const autogrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  const handleGenerate = useCallback(async () => {
    const phrase = value.trim();
    if (!phrase && !selectedJob) {
      toast.error('Décris le candidat idéal pour générer les filtres.');
      return;
    }
    if (!accountId && searchSource !== 'database') {
      toast.error('Connectez votre compte LinkedIn pour lancer une recherche.');
      return;
    }

    setLoading(true);
    try {
      const job = buildAugmentedJob(selectedJob, phrase);
      const { update, suggestions, filterCount } = await generateFiltersFromJob({
        job,
        accountId,
        searchSource,
        currentLocation,
      });
      onApplyFilters(update);
      onSuggestionsGenerated?.(suggestions);
      toast.success(`${filterCount} filtre${filterCount > 1 ? 's' : ''} généré${filterCount > 1 ? 's' : ''}`);
    } catch (error: any) {
      const msg = error?.message || '';
      let humanized = 'Erreur lors de la génération des filtres';
      if (msg.includes('insufficient_credits')) humanized = 'Crédits IA insuffisants';
      else if (msg.includes('503') || msg.includes('529') || msg.includes('surcharg')) humanized = 'Service IA temporairement surchargé, réessayez dans 30 secondes';
      else if (msg.includes('429')) humanized = 'Trop de requêtes, réessayez dans quelques secondes';
      else if (msg.includes('timeout') || msg.includes('aborted')) humanized = 'La requête a pris trop de temps. Réessayez.';
      else if (msg && msg !== "Réponse invalide de l'API" && msg.length < 200) humanized = msg;
      toast.error(humanized);
    } finally {
      setLoading(false);
    }
  }, [value, selectedJob, accountId, searchSource, currentLocation, onApplyFilters, onSuggestionsGenerated]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading && !disabled) handleGenerate();
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'rounded-[10px] border bg-[var(--k-surface)] px-3.5 py-3 transition-[border-color,box-shadow] duration-150',
          focused ? 'border-[var(--k-hairline-focus)] shadow-[0_1px_3px_rgba(0,0,0,0.20)]' : 'border-[var(--k-hairline)]'
        )}
      >
        <div className="flex items-start gap-2.5">
          <AiBurst
            className={cn(
              'w-[17px] h-[17px] mt-0.5 shrink-0 transition-colors duration-150',
              accentActive ? 'text-[var(--k-accent)]' : 'text-[var(--k-text-placeholder)]'
            )}
          />
          <textarea
            ref={taRef}
            value={value}
            onChange={e => { setValue(e.target.value); autogrow(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={disabled || loading}
            placeholder="Décris le profil — ex. Account Manager SaaS B2B en Île-de-France, 8+ ans, a géré des grands comptes, pas de profil ESN"
            className="flex-1 min-w-0 resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed text-[var(--k-text)] placeholder:text-[var(--k-text-placeholder)] focus:outline-none"
          />
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-[var(--k-text-muted)]">
            <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-[var(--k-hairline)] text-[var(--k-text-muted)]">⏎</kbd>
            pour lancer
          </span>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={disabled || loading}
            className={cn(
              'ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-60',
              armed
                ? 'bg-[var(--k-accent)] text-[var(--k-on-accent)] hover:bg-[var(--k-accent-hover)] border border-transparent'
                : 'bg-transparent text-[var(--k-text-muted)] border border-[var(--k-hairline)] hover:text-[var(--k-text)] hover:border-[var(--k-hairline-hover)]'
            )}
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            )}
            {loading ? 'Génération…' : 'Générer les filtres'}
            {!loading && <CreditCostBadge actionId="filter_generation" />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--k-text-muted)] mr-0.5">Exemples</span>
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            type="button"
            onClick={() => { setValue(ex); taRef.current?.focus(); requestAnimationFrame(autogrow); }}
            className="rounded-full border border-[var(--k-hairline)] px-2.5 py-1 text-xs text-[var(--k-text-muted)] transition-colors duration-150 hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)]"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
};
