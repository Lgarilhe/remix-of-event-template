/**
 * SourcingFlow — la recherche en trois états (refonte UX V3).
 *
 *   1. SearchHero      — décrire : prompt central, exemples, reprise d'historique
 *   2. SearchPlan      — comprendre : plan d'étapes réel + filtres extraits qui
 *                        apparaissent un à un (remplace le spinner)
 *   3. FilterChipBar   — piloter : pilules 3-segments (champ | opérateur | valeurs)
 *                        au-dessus des résultats, poids Indispensable/Souhaité/
 *                        Exclure, « Relancer » qui ne s'allume que si modifié
 *
 * Patterns : Juicebox (interprétation éditable), Perplexity (progress-as-plan),
 * Linear (pilule 3-segments), LinkedIn Recruiter (poids par critère),
 * Attio (exploration éphémère / relance choisie).
 *
 * La machine à états vit dans LinkedInSearch ; ce module ne contient que les
 * trois vues + `chipsFromUpdate` (résumé des filtres générés pour le plan).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { LinkedInFiltersState, SENIORITY_LEVELS, PROFILE_LANGUAGES } from '@/components/outreach/types';
import { SearchHistoryEntry } from '@/hooks/useSearchHistory';

/* ────────────────────────── Icônes géométriques (registre 1.5px) ────────────────────────── */
const svgProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;
export const AiBurst = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" {...svgProps} className={className} aria-hidden="true">
    <path d="M14.08 13.2 17.2 15M12 14.4V18M9.92 13.2 6.8 15M9.92 10.8 6.8 9M12 9.6V6M14.08 10.8 17.2 9" />
  </svg>
);
const FIELD_ICONS: Record<string, React.ReactNode> = {
  Poste: <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><rect x="3.5" y="8" width="17" height="11" rx="1.25" /><rect x="9" y="5" width="6" height="3" rx="0.75" /><path d="M3.5 12.5h17" /></svg>,
  Lieu: <svg viewBox="0 0 24 24" {...svgProps} strokeLinejoin="round" className="w-3 h-3"><path d="M6 10a6 6 0 0 1 12 0L12 21 6 10z" /><circle cx="12" cy="10" r="2.3" /></svg>,
  'Exp.': <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><circle cx="12" cy="12" r="8" /><path d="M12 12V7.5M12 12l3.5 2" /></svg>,
  Skills: <svg viewBox="0 0 24 24" {...svgProps} strokeLinejoin="round" className="w-3 h-3"><path d="M12 4 20 9l-8 5-8-5 8-5z" /><path d="M4 12.5l8 5 8-5" /></svg>,
  'Boîte': <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M10.5 21v-4h3v4" /></svg>,
  'Mots-clés': <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><path d="M4 7h16M4 12h10M4 17h6" /></svg>,
};
const Target = () => (
  <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>
);
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}><path d="M7 7 17 17M17 7 7 17" /></svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} className="w-2.5 h-2.5"><path d="M20 7 10 17l-5-5" /></svg>
);

/* ══════════════════════════ 1. HERO ══════════════════════════ */

interface SearchHeroProps {
  jobTitle: string;
  clientName?: string | null;
  history: SearchHistoryEntry[];
  onLaunch: (phrase: string) => void;
  onResumeHistory: (entry: SearchHistoryEntry) => void;
  disabled?: boolean;
}

const HERO_EXAMPLES = [
  'Account Manager SaaS B2B, 8-12 ans, grands comptes, Île-de-France, pas d\'ESN',
  'Head of Sales fintech série B, Paris, a scalé une équipe',
];

export const SearchHero: React.FC<SearchHeroProps> = ({
  jobTitle, clientName, history, onLaunch, onResumeHistory, disabled,
}) => {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const armed = value.trim().length > 0;

  // « / » focalise le prompt (pattern clavier-first)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== taRef.current && !/INPUT|TEXTAREA/.test((document.activeElement as HTMLElement)?.tagName || '')) {
        e.preventDefault();
        taRef.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-start pt-10 sm:pt-16 pb-10 px-4 relative min-h-[480px]">
      <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[560px] max-w-full h-[300px] pointer-events-none opacity-50"
        style={{ background: 'radial-gradient(ellipse at center, var(--k-accent-tint), transparent 70%)' }} />

      <div className="relative inline-flex items-center gap-2 rounded-full border border-[var(--k-hairline)] bg-[var(--k-surface)] pl-1.5 pr-3 py-1 text-xs text-[var(--k-text-2)] mb-5">
        <span className="w-5 h-5 grid place-items-center rounded-full border border-[var(--k-hairline)] bg-[var(--k-surface-2)]"><Target /></span>
        Mission · <b className="font-medium text-[var(--k-text)]">{jobTitle}</b>
        {clientName && <span className="text-[var(--k-text-muted)]">· {clientName}</span>}
      </div>

      <h2 className="relative text-xl font-semibold tracking-[-.015em] mb-4 text-[var(--k-text)]">Qui cherches-tu ?</h2>

      <div className={cn(
        'relative w-full max-w-[640px] rounded-xl border bg-[var(--k-surface)] px-4 py-3.5 transition-[border-color,box-shadow] duration-150',
        focused ? 'border-[var(--k-hairline-focus)] shadow-[0_1px_3px_rgba(0,0,0,0.2)]' : 'border-[var(--k-hairline)]',
      )}>
        <div className="flex items-start gap-2.5">
          <AiBurst className={cn('w-[17px] h-[17px] mt-1 shrink-0 transition-colors duration-150', (focused || armed) ? 'text-[var(--k-accent)]' : 'text-[var(--k-text-placeholder)]')} />
          <textarea
            ref={taRef}
            value={value}
            rows={2}
            disabled={disabled}
            onChange={e => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (armed) onLaunch(value.trim()); } }}
            placeholder="Décris le profil idéal — rôle, séniorité, contexte, lieu. L'IA le traduit en filtres que tu pourras piloter."
            className="flex-1 min-w-0 resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed text-[var(--k-text)] placeholder:text-[var(--k-text-placeholder)] focus:outline-none min-h-[52px]"
          />
        </div>
        <div className="flex items-center gap-2.5 mt-1.5">
          <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--k-text-muted)]">
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--k-hairline)]">⏎</kbd> lancer ·
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--k-hairline)]">/</kbd> focus
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onLaunch(value.trim())}
            className={cn(
              'ml-auto inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-60',
              armed
                ? 'bg-[var(--k-accent)] text-[var(--k-on-accent)] hover:bg-[var(--k-accent-hover)] border border-transparent'
                : 'bg-transparent text-[var(--k-text-muted)] border border-[var(--k-hairline)] hover:text-[var(--k-text)] hover:border-[var(--k-hairline-hover)]',
            )}
          >
            <svg viewBox="0 0 24 24" {...svgProps} strokeWidth={1.6} className="w-3.5 h-3.5"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
            Générer &amp; chercher
          </button>
        </div>
      </div>

      <div className="relative flex flex-wrap justify-center gap-1.5 mt-4 max-w-[660px]">
        <span className="w-full text-center font-mono text-[10px] uppercase tracking-wider text-[var(--k-text-muted)] mb-0.5">
          Exemples — rôle + séniorité + contexte + lieu
        </span>
        {HERO_EXAMPLES.map(ex => (
          <button key={ex} type="button" onClick={() => { setValue(ex); taRef.current?.focus(); }}
            className="rounded-full border border-[var(--k-hairline)] px-3 py-1.5 text-xs text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)] transition-colors">
            {ex}
          </button>
        ))}
      </div>

      <div className="relative flex items-center gap-3 mt-6 text-xs text-[var(--k-text-muted)]">
        <span className="w-10 h-px bg-[var(--k-hairline)]" />
        ou
        <button type="button" onClick={() => onLaunch('')} disabled={disabled}
          className="font-medium text-[var(--k-text-2)] hover:text-[var(--k-text)] underline underline-offset-4 decoration-[var(--k-hairline-focus)]">
          générer depuis le brief
        </button>
        — sans rien taper
        <span className="w-10 h-px bg-[var(--k-hairline)]" />
      </div>

      {history.length > 0 && (
        <div className="relative w-full max-w-[640px] mt-8">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--k-text-muted)] mb-2">Reprendre une recherche</div>
          {history.slice(0, 3).map(entry => (
            <button key={entry.id} type="button" onClick={() => onResumeHistory(entry)}
              className="flex items-center gap-2.5 w-full text-left rounded-[10px] border border-[var(--k-hairline)] bg-[var(--k-surface)] px-3 py-2 mb-1.5 hover:border-[var(--k-hairline-hover)] transition-colors">
              <svg viewBox="0 0 24 24" {...svgProps} className="w-3.5 h-3.5 shrink-0 text-[var(--k-text-muted)]"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" /></svg>
              <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--k-text-2)]">
                {entry.filters_snapshot?.role?.map(r => r.keywords).join(', ') || entry.filters_snapshot?.keywords || entry.job_title || 'Recherche'}
              </span>
              <span className="font-mono text-[11px] text-[var(--k-text-muted)] shrink-0">{entry.results_count} profils</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════ 2. PLAN ══════════════════════════ */

export interface PlanChip { field: string; label: string; must?: boolean }
export type PlanStage = 'analyze' | 'search';

/** Résume un Partial<LinkedInFiltersState> généré en chips pour le plan. */
export function chipsFromUpdate(u: Partial<LinkedInFiltersState>): PlanChip[] {
  const chips: PlanChip[] = [];
  (u.role || []).forEach(r => chips.push({ field: 'Poste', label: r.keywords, must: r.priority === 'MUST_HAVE' }));
  (u.location || []).forEach(l => chips.push({ field: 'Lieu', label: l.name }));
  if (u.calculated_experience_min != null || u.calculated_experience_max != null) {
    chips.push({ field: 'Exp.', label: `${u.calculated_experience_min ?? 0}–${u.calculated_experience_max ?? '∞'} ans` });
  }
  (u.skills_keywords || []).slice(0, 4).forEach(s => chips.push({ field: 'Skills', label: s }));
  (u.company_keywords || []).forEach(c => chips.push({ field: 'Boîte', label: (c.priority === 'DOESNT_HAVE' ? 'exclut ' : '') + c.keywords }));
  if (u.keywords) chips.push({ field: 'Mots-clés', label: u.keywords.length > 40 ? u.keywords.slice(0, 40) + '…' : u.keywords });
  return chips;
}

interface SearchPlanProps { query: string; stage: PlanStage; chips: PlanChip[] }

const StepIcon: React.FC<{ state: 'wait' | 'active' | 'done' }> = ({ state }) => (
  <span className={cn(
    'w-[17px] h-[17px] mt-0.5 shrink-0 rounded-full grid place-items-center border transition-colors',
    state === 'done' ? 'bg-[var(--k-accent-tint)] border-transparent text-[var(--k-accent)]' : 'border-[var(--k-hairline)] bg-[var(--k-surface)] text-[var(--k-text-muted)]',
  )}>
    {state === 'done' ? <Check /> : state === 'active'
      ? <span className="w-[9px] h-[9px] rounded-full border-[1.5px] border-[var(--k-hairline-focus)] border-t-[var(--k-accent)] animate-spin" />
      : <span className="w-1 h-1 rounded-full bg-[var(--k-hairline-focus)]" />}
  </span>
);

export const SearchPlan: React.FC<SearchPlanProps> = ({ query, stage, chips }) => {
  const steps: { title: string; state: 'wait' | 'active' | 'done'; meta?: string }[] = [
    { title: 'Analyse de la demande + brief mission', state: 'done' },
    { title: 'Extraction des filtres', state: stage === 'analyze' ? 'active' : 'done', meta: stage !== 'analyze' ? `${chips.length} filtres — éditables juste après` : undefined },
    { title: 'Recherche des profils', state: stage === 'search' ? 'active' : 'wait' },
  ];
  return (
    <div className="flex-1 px-4 py-6 min-h-[420px]">
      <div className="max-w-[720px] mx-auto">
        <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--k-hairline)] bg-[var(--k-surface)] px-3 py-2.5">
          <AiBurst className="w-[15px] h-[15px] shrink-0 text-[var(--k-accent)]" />
          <span className="flex-1 min-w-0 truncate text-sm text-[var(--k-text-2)]">{query}</span>
        </div>
        <div className="h-0.5 my-4 rounded bg-[var(--k-hairline)] overflow-hidden relative">
          <span className="absolute inset-y-0 w-1/3 rounded bg-[var(--k-accent)] opacity-75 animate-[kIndet_1.2s_linear_infinite]" />
          <style>{'@keyframes kIndet{from{left:-33%}to{left:100%}}'}</style>
        </div>
        <div className="flex flex-col gap-1">
          {steps.map((s, i) => (
            <div key={i} className={cn('flex items-start gap-2.5 px-1 py-1.5 transition-opacity duration-200', s.state === 'wait' && 'opacity-45')}>
              <StepIcon state={s.state} />
              <div className="flex-1 min-w-0">
                <span className={cn('text-[13.5px] font-medium', s.state === 'done' ? 'text-[var(--k-text)]' : 'text-[var(--k-text-2)]', s.state === 'active' && 'konekt-shimmer-text')}>
                  {s.title}
                </span>
                {s.meta && <span className="ml-2 font-mono text-[11px] text-[var(--k-text-muted)]">{s.meta}</span>}
                {i === 1 && chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {chips.map((c, k) => (
                      <span
                        key={`${c.field}-${c.label}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--k-text-2)] animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
                        style={{ animationDelay: `${Math.min(k, 8) * 50}ms`, animationFillMode: 'backwards' }}
                      >
                        {c.must && <span className="w-[5px] h-[5px] rounded-full bg-[var(--k-accent)]" />}
                        <span className="font-mono text-[9px] uppercase tracking-wide text-[var(--k-text-muted)]">{c.field}</span>
                        {c.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════ 3. CHIP BAR ══════════════════════════ */

type Weight = 'must' | 'should' | 'exclude';
type FacetKey = 'poste' | 'lieu' | 'exp' | 'skills' | 'boite' | 'keywords' | 'seniorite' | 'langue';
interface FacetChip {
  key: FacetKey;
  field: string;
  op: string;
  values: string[];
  weight: Weight;
  canCycle: boolean;
}

/** Champs proposés par « + Filtre » — granularité directe sans passer par le
 *  panneau avancé. `advanced: true` = nécessite l'autocomplete LinkedIn → modal. */
const ADDABLE_FIELDS: { key: FacetKey | 'advanced'; label: string; hint?: string }[] = [
  { key: 'lieu', label: 'Lieu' },
  { key: 'poste', label: 'Poste' },
  { key: 'exp', label: 'Expérience' },
  { key: 'skills', label: 'Compétence' },
  { key: 'boite', label: 'Entreprise' },
  { key: 'seniorite', label: 'Séniorité' },
  { key: 'langue', label: 'Langue du profil' },
  { key: 'advanced', label: 'École, secteur, spotlights…', hint: 'panneau avancé' },
];

function buildChips(f: LinkedInFiltersState): FacetChip[] {
  const chips: FacetChip[] = [];
  const roleVals = [...f.role.map(r => r.keywords), ...f.job_title.map(j => j.name)];
  if (roleVals.length) chips.push({
    key: 'poste', field: 'Poste', op: roleVals.length > 1 ? "l'un de" : 'est', values: roleVals,
    weight: f.role.some(r => r.priority === 'MUST_HAVE') || f.job_title.some(j => j.priority === 'MUST_HAVE') ? 'must' : 'should',
    canCycle: true,
  });
  if (f.location.length) chips.push({
    key: 'lieu', field: 'Lieu', op: f.location.length > 1 ? "l'un de" : 'est', values: f.location.map(l => l.name),
    weight: f.location.some(l => l.priority === 'MUST_HAVE') ? 'must' : 'should', canCycle: true,
  });
  if (f.calculated_experience_min != null || f.calculated_experience_max != null) chips.push({
    key: 'exp', field: 'Exp.', op: 'entre', values: [`${f.calculated_experience_min ?? 0}–${f.calculated_experience_max ?? '∞'} ans`],
    weight: 'should', canCycle: false,
  });
  const skillVals = [...f.skills.map(s => s.name), ...(f.skills_keywords || [])];
  if (skillVals.length) chips.push({
    key: 'skills', field: 'Skills', op: 'contient', values: skillVals,
    weight: f.skills.some(s => s.priority === 'MUST_HAVE') ? 'must' : 'should', canCycle: false,
  });
  const coIncl = [...f.company.map(c => c.name), ...f.company_keywords.filter(c => c.priority !== 'DOESNT_HAVE').map(c => c.keywords)];
  const coExcl = [...f.company_keywords.filter(c => c.priority === 'DOESNT_HAVE').map(c => c.keywords), ...(f.exclude_consulting ? ['ESN / Conseil'] : [])];
  if (coIncl.length || coExcl.length) chips.push({
    key: 'boite', field: 'Boîte', op: coExcl.length && !coIncl.length ? 'exclut' : 'contient',
    values: [...coIncl, ...coExcl.map(v => `⌀ ${v}`)],
    weight: coExcl.length && !coIncl.length ? 'exclude' : 'should', canCycle: false,
  });
  if (f.seniority.length) chips.push({
    key: 'seniorite', field: 'Séniorité', op: f.seniority.length > 1 ? "l'une de" : 'est',
    values: f.seniority.map(s => SENIORITY_LEVELS.find(sl => sl.value === s)?.label || s),
    weight: 'should', canCycle: false,
  });
  if (f.profile_language.length) chips.push({
    key: 'langue', field: 'Langue', op: f.profile_language.length > 1 ? "l'une de" : 'est',
    values: f.profile_language.map(l => PROFILE_LANGUAGES.find(pl => pl.value === l)?.label || l),
    weight: 'should', canCycle: false,
  });
  if (f.keywords?.trim()) chips.push({
    key: 'keywords', field: 'Mots-clés', op: 'booléen',
    values: [f.keywords.length > 34 ? f.keywords.slice(0, 34) + '…' : f.keywords],
    weight: 'should', canCycle: false,
  });
  return chips;
}

function advancedCount(f: LinkedInFiltersState): number {
  return f.school.length + f.industry.length + f.function.length
    + f.degree.length + f.groups.length + f.network_distance.length
    + f.past_company.length + f.past_job_title.length + (f.spotlight ? 1 : 0)
    + (f.open_to_work === true ? 1 : 0) + f.company_headcount.length + f.company_type.length;
}

interface FilterChipBarProps {
  filters: LinkedInFiltersState;
  onFiltersEdit: (updater: (prev: LinkedInFiltersState) => LinkedInFiltersState) => void;
  total: number | null;
  loading: boolean;
  dirty: boolean;
  onRerun: () => void;
  onOpenAdvanced: () => void;
  onFollowUp: (phrase: string) => Promise<void>;
  accountId: string | null;
  searchSource: 'linkedin' | 'database';
}

export const FilterChipBar: React.FC<FilterChipBarProps> = ({
  filters, onFiltersEdit, total, loading, dirty, onRerun, onOpenAdvanced, onFollowUp, accountId, searchSource,
}) => {
  const chips = buildChips(filters);
  const advCount = advancedCount(filters);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [fuValue, setFuValue] = useState('');
  const [fuOpen, setFuOpen] = useState(false);
  const [fuLoading, setFuLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openKey) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-chip-pop]') && !(e.target as HTMLElement).closest('[data-chip-seg]')) setOpenKey(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenKey(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [openKey]);

  /* ── Poids : bascule Indispensable ↔ Souhaité (Poste, Lieu) ── */
  const cycleWeight = useCallback((key: FacetChip['key']) => {
    onFiltersEdit(f => {
      if (key === 'poste') {
        const toMust = !f.role.some(r => r.priority === 'MUST_HAVE');
        return {
          ...f,
          role: f.role.map(r => r.priority === 'DOESNT_HAVE' ? r : { ...r, priority: toMust ? 'MUST_HAVE' as const : 'CAN_HAVE' as const }),
          job_title: f.job_title.map(j => ({ ...j, priority: toMust ? 'MUST_HAVE' as const : 'CAN_HAVE' as const })),
        };
      }
      if (key === 'lieu') {
        const toMust = !f.location.some(l => l.priority === 'MUST_HAVE');
        return { ...f, location: f.location.map(l => ({ ...l, priority: toMust ? 'MUST_HAVE' as const : 'CAN_HAVE' as const })) };
      }
      return f;
    });
  }, [onFiltersEdit]);

  /* ── Retrait d'une facette entière ── */
  const removeFacet = useCallback((key: FacetChip['key']) => {
    onFiltersEdit(f => {
      switch (key) {
        case 'poste': return { ...f, role: [], job_title: [] };
        case 'lieu': return { ...f, location: [] };
        case 'exp': return { ...f, calculated_experience_min: null, calculated_experience_max: null, years_of_experience_min: null, years_of_experience_max: null };
        case 'skills': return { ...f, skills: [], skills_keywords: [] };
        case 'boite': return { ...f, company: [], company_keywords: [], exclude_consulting: false };
        case 'keywords': return { ...f, keywords: '' };
        case 'seniorite': return { ...f, seniority: [] };
        case 'langue': return { ...f, profile_language: [] };
        default: return f;
      }
    });
  }, [onFiltersEdit]);

  /* ── Retrait / ajout de valeurs dans une facette ── */
  const removeValue = useCallback((key: FacetChip['key'], value: string) => {
    const raw = value.replace(/^⌀ /, '');
    onFiltersEdit(f => {
      switch (key) {
        case 'poste': return { ...f, role: f.role.filter(r => r.keywords !== raw), job_title: f.job_title.filter(j => j.name !== raw) };
        case 'lieu': return { ...f, location: f.location.filter(l => l.name !== raw) };
        case 'skills': return { ...f, skills: f.skills.filter(s => s.name !== raw), skills_keywords: (f.skills_keywords || []).filter(s => s !== raw) };
        case 'boite':
          if (raw === 'ESN / Conseil' && f.exclude_consulting) return { ...f, exclude_consulting: false };
          return { ...f, company: f.company.filter(c => c.name !== raw), company_keywords: f.company_keywords.filter(c => c.keywords !== raw) };
        case 'seniorite': {
          const sv = SENIORITY_LEVELS.find(sl => sl.label === raw)?.value ?? raw;
          return { ...f, seniority: f.seniority.filter(s => s !== sv) };
        }
        case 'langue': {
          const lv = PROFILE_LANGUAGES.find(pl => pl.label === raw)?.value ?? raw;
          return { ...f, profile_language: f.profile_language.filter(l => l !== lv) };
        }
        default: return f;
      }
    });
  }, [onFiltersEdit]);

  const addValue = useCallback(async (key: FacetChip['key'], value: string) => {
    const v = value.trim();
    if (!v) return;
    if (key === 'lieu') {
      if (searchSource === 'linkedin' && accountId) {
        setResolving(true);
        try {
          const { data } = await invokeUnipile({ body: { action: 'get_parameters', account_id: accountId, type: 'LOCATION', keywords: v, service: 'RECRUITER' } });
          const items = Array.isArray(data?.items) ? (data.items as any[]) : [];
          const norm = v.toLowerCase();
          const best = items.find((it: any) => String(it.title || '').toLowerCase() === norm)
            || items.find((it: any) => String(it.title || '').toLowerCase().includes(norm)) || items[0];
          if (best?.id && best?.title) {
            onFiltersEdit(f => f.location.some(l => l.id === String(best.id)) ? f : ({
              ...f, location: [...f.location, { id: String(best.id), name: String(best.title), priority: 'MUST_HAVE' as const, scope: 'CURRENT_OR_OPEN_TO_RELOCATE' as const }],
            }));
          } else toast.error(`Localisation « ${v} » introuvable`);
        } catch { toast.error('Résolution de la localisation impossible'); }
        finally { setResolving(false); }
      } else {
        onFiltersEdit(f => ({ ...f, location: [...f.location, { id: v, name: v, priority: 'MUST_HAVE' as const, scope: 'CURRENT_OR_OPEN_TO_RELOCATE' as const }] }));
      }
      return;
    }
    onFiltersEdit(f => {
      switch (key) {
        case 'poste': return { ...f, role: [...f.role, { keywords: v, priority: 'CAN_HAVE' as const, scope: 'CURRENT_OR_PAST' as const }] };
        case 'skills': return { ...f, skills_keywords: [...(f.skills_keywords || []), v] };
        case 'boite': return { ...f, company_keywords: [...f.company_keywords, { keywords: v, priority: 'CAN_HAVE' as const, scope: 'CURRENT' as const }] };
        default: return f;
      }
    });
  }, [onFiltersEdit, accountId, searchSource]);

  const toggleOption = useCallback((key: 'seniorite' | 'langue', value: string) => {
    onFiltersEdit(f => key === 'seniorite'
      ? { ...f, seniority: f.seniority.includes(value) ? f.seniority.filter(s => s !== value) : [...f.seniority, value] }
      : { ...f, profile_language: f.profile_language.includes(value) ? f.profile_language.filter(l => l !== value) : [...f.profile_language, value] });
  }, [onFiltersEdit]);

  // « + Filtre » : champ choisi → éditeur inline (2e étage du même popover)
  const [addField, setAddField] = useState<FacetKey | null>(null);

  const submitFollowUp = useCallback(async () => {
    const v = fuValue.trim();
    if (!v || fuLoading) return;
    setFuLoading(true);
    try {
      await onFollowUp(v);
      setFuValue('');
      setFuOpen(false);
    } finally { setFuLoading(false); }
  }, [fuValue, fuLoading, onFollowUp]);

  const weightLabel: Record<Weight, string> = { must: 'Indispensable', should: 'Souhaité', exclude: 'Exclure' };

  return (
    <div className="mb-2">
      {/* Barre unique : phrase d'affinage repliée + pilules + ajout + compteur */}
      <div ref={barRef} className="relative flex flex-wrap items-center gap-1.5">
        {fuOpen && (
          <span className="order-first basis-full inline-flex items-center gap-2 rounded-lg border border-[var(--k-hairline-focus)] bg-[var(--k-surface)] px-2.5 py-1.5 mb-0.5">
            <AiBurst className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />
            <input
              autoFocus
              value={fuValue}
              onChange={e => setFuValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submitFollowUp(); }
                if (e.key === 'Escape') { setFuOpen(false); setFuValue(''); }
              }}
              placeholder="Affiner en une phrase — ex. « ajoute anglais courant, retire Lyon » (⏎ · esc)"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-[var(--k-text)] placeholder:text-[var(--k-text-placeholder)]"
            />
            {fuLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--k-text-muted)]" />
              : <button type="button" onClick={() => { setFuOpen(false); setFuValue(''); }} className="text-[var(--k-text-muted)] hover:text-[var(--k-text)]"><XIcon className="w-2.5 h-2.5" /></button>}
          </span>
        )}
        {chips.map(chip => (
          <span key={chip.key} className={cn(
            'relative inline-flex items-stretch rounded-lg border bg-[var(--k-surface)] overflow-visible text-xs font-medium transition-colors',
            chip.weight === 'must' ? 'border-[color-mix(in_srgb,var(--k-accent)_35%,var(--k-hairline))]' : 'border-[var(--k-hairline)] hover:border-[var(--k-hairline-hover)]',
          )}>
            <button
              type="button"
              data-chip-seg
              onClick={() => chip.canCycle && cycleWeight(chip.key)}
              title={chip.canCycle ? `${weightLabel[chip.weight]} — clic pour basculer` : chip.field}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 border-r border-[var(--k-hairline)]',
                chip.weight === 'must' ? 'text-[var(--k-text)]' : chip.weight === 'exclude' ? 'text-[var(--k-bad,#e06666)]' : 'text-[var(--k-text-muted)]',
                chip.canCycle ? 'cursor-pointer hover:bg-[var(--k-surface-2)]' : 'cursor-default',
              )}
            >
              {chip.weight === 'must' && <span className="w-[5px] h-[5px] rounded-full bg-[var(--k-accent)]" />}
              {FIELD_ICONS[chip.field]}
              {chip.field}
            </button>
            <span className="inline-flex items-center px-1.5 py-1 text-[11.5px] font-normal text-[var(--k-text-muted)] border-r border-[var(--k-hairline)]">{chip.op}</span>
            <button
              type="button"
              data-chip-seg
              onClick={() => setOpenKey(openKey === chip.key ? null : chip.key)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)] max-w-[220px]"
            >
              <span className="truncate">
                {chip.values.length > 2 ? `${chip.values.slice(0, 2).join(', ')} +${chip.values.length - 2}` : chip.values.join(', ')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => removeFacet(chip.key)}
              aria-label={`Retirer ${chip.field}`}
              className="inline-flex items-center px-1.5 py-1 border-l border-[var(--k-hairline)] text-[var(--k-text-muted)] hover:text-[var(--k-text)] hover:bg-[var(--k-surface-2)]"
            >
              <XIcon className="w-2.5 h-2.5" />
            </button>

            {/* Popover valeurs */}
            {openKey === chip.key && (
              <div data-chip-pop className="absolute z-40 top-full left-0 mt-1.5 min-w-[230px] max-w-[300px] rounded-[10px] border border-[var(--k-hairline-focus)] bg-[var(--k-surface-3)] shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)] px-2 pt-1 pb-1.5">{chip.field} — valeurs</div>
                {chip.key === 'exp' ? (
                  <div className="flex items-center gap-1.5 px-2 pb-1.5 text-xs text-[var(--k-text-muted)]">
                    <input type="number" min={0} max={50} value={filters.calculated_experience_min ?? ''} placeholder="min"
                      onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, calculated_experience_min: v, years_of_experience_min: v })); }}
                      className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                    →
                    <input type="number" min={0} max={50} value={filters.calculated_experience_max ?? ''} placeholder="max"
                      onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, calculated_experience_max: v, years_of_experience_max: v })); }}
                      className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                    ans
                  </div>
                ) : chip.key === 'keywords' ? (
                  <button type="button" onClick={() => { setOpenKey(null); onOpenAdvanced(); }}
                    className="w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]">
                    Éditer la requête booléenne dans le panneau avancé →
                  </button>
                ) : (chip.key === 'seniorite' || chip.key === 'langue') ? (
                  <>
                    {(chip.key === 'seniorite' ? SENIORITY_LEVELS : PROFILE_LANGUAGES).map(opt => {
                      const checked = chip.key === 'seniorite'
                        ? filters.seniority.includes(opt.value)
                        : filters.profile_language.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleOption(chip.key as 'seniorite' | 'langue', opt.value)}
                          className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]"
                        >
                          <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                          {checked && <span className="text-[var(--k-accent)]"><Check /></span>}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {chip.values.map(v => (
                      <div key={v} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)]">
                        <span className="flex-1 min-w-0 truncate">{v}</span>
                        {chip.values.length > 1 && (
                          <button type="button" onClick={() => removeValue(chip.key, v)} aria-label={`Retirer ${v}`}
                            className="opacity-0 group-hover:opacity-100 text-[var(--k-text-muted)] hover:text-[var(--k-text)]">
                            <XIcon className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <input
                      autoFocus
                      placeholder={resolving ? 'Résolution…' : 'Ajouter — ⏎'}
                      disabled={resolving}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const v = (e.target as HTMLInputElement).value;
                          (e.target as HTMLInputElement).value = '';
                          addValue(chip.key, v);
                        }
                      }}
                      className="w-[calc(100%-8px)] m-1 h-7 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 text-xs text-[var(--k-text)] placeholder:text-[var(--k-text-placeholder)] outline-none focus:border-[var(--k-hairline-focus)]"
                    />
                  </>
                )}
              </div>
            )}
          </span>
        ))}

        {/* + Filtre : granularité directe — champ puis éditeur inline */}
        <span className="relative">
          <button
            type="button"
            data-chip-seg
            onClick={() => { setOpenKey(openKey === '__add' ? null : '__add'); setAddField(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--k-hairline)] px-2.5 py-1 text-xs font-medium text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)] transition-colors"
          >
            <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></svg>
            Filtre
          </button>
          {openKey === '__add' && (
            <div data-chip-pop className="absolute z-40 top-full left-0 mt-1.5 min-w-[220px] rounded-[10px] border border-[var(--k-hairline-focus)] bg-[var(--k-surface-3)] shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
              {addField === null ? (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)] px-2 pt-1 pb-1.5">Ajouter un filtre</div>
                  {ADDABLE_FIELDS.map(fd => (
                    <button
                      key={fd.key}
                      type="button"
                      onClick={() => {
                        if (fd.key === 'advanced') { setOpenKey(null); onOpenAdvanced(); return; }
                        setAddField(fd.key as FacetKey);
                      }}
                      className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]"
                    >
                      <span className="flex-1">{fd.label}</span>
                      {fd.hint && <span className="font-mono text-[10px] text-[var(--k-text-muted)]">{fd.hint}</span>}
                    </button>
                  ))}
                </>
              ) : addField === 'exp' ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--k-text-muted)]">
                  <input type="number" min={0} max={50} autoFocus placeholder="min"
                    onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, calculated_experience_min: v, years_of_experience_min: v })); }}
                    className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                  →
                  <input type="number" min={0} max={50} placeholder="max"
                    onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, calculated_experience_max: v, years_of_experience_max: v })); }}
                    className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                  ans
                </div>
              ) : (addField === 'seniorite' || addField === 'langue') ? (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)] px-2 pt-1 pb-1.5">{addField === 'seniorite' ? 'Séniorité' : 'Langue du profil'}</div>
                  {(addField === 'seniorite' ? SENIORITY_LEVELS : PROFILE_LANGUAGES).map(opt => {
                    const checked = addField === 'seniorite'
                      ? filters.seniority.includes(opt.value)
                      : filters.profile_language.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleOption(addField as 'seniorite' | 'langue', opt.value)}
                        className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]"
                      >
                        <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                        {checked && <span className="text-[var(--k-accent)]"><Check /></span>}
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)] px-2 pt-1 pb-1.5">
                    {ADDABLE_FIELDS.find(fd => fd.key === addField)?.label}
                  </div>
                  <input
                    autoFocus
                    placeholder={resolving ? 'Résolution…' : 'Valeur — ⏎'}
                    disabled={resolving}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value;
                        (e.target as HTMLInputElement).value = '';
                        if (addField) addValue(addField as FacetChip['key'], v);
                      }
                    }}
                    className="w-[calc(100%-8px)] m-1 h-7 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 text-xs text-[var(--k-text)] placeholder:text-[var(--k-text-placeholder)] outline-none focus:border-[var(--k-hairline-focus)]"
                  />
                </>
              )}
            </div>
          )}
        </span>

        {/* Phrase d'affinage — repliée en bouton (dé-densification) */}
        <button
          type="button"
          onClick={() => setFuOpen(o => !o)}
          title="Affiner en une phrase — l'IA la traduit en chips visibles"
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--k-hairline)] px-2.5 py-1 text-xs font-medium text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)] transition-colors"
        >
          <AiBurst className="w-3 h-3" />
          Affiner
        </button>

        {/* Avancé (l'ancien panneau complet, en échappatoire) */}
        <button
          type="button"
          onClick={onOpenAdvanced}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--k-hairline)] px-2.5 py-1 text-xs font-medium text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)] transition-colors"
        >
          <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></svg>
          Avancé{advCount > 0 ? ` · ${advCount}` : ''}
        </button>

        <div className="ml-auto flex items-center gap-2.5">
          {total != null && (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-mono text-[15px] font-medium text-[var(--k-text)] [font-feature-settings:'tnum'_1]">{total.toLocaleString('fr-FR')}</span>
              <span className="text-xs text-[var(--k-text-muted)]">candidats</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => dirty && !loading && onRerun()}
            disabled={loading}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150',
              dirty
                ? 'bg-[var(--k-accent)] text-[var(--k-on-accent)] hover:bg-[var(--k-accent-hover)] border border-transparent'
                : 'bg-[var(--k-surface-2)] text-[var(--k-text-muted)] border border-[var(--k-hairline)] cursor-default',
            )}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading ? 'Recherche…' : dirty ? 'Relancer la recherche' : 'À jour'}
          </button>
        </div>
      </div>
    </div>
  );
};
