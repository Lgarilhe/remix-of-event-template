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
import {
  LinkedInFiltersState, SENIORITY_LEVELS, PROFILE_LANGUAGES,
  COMPANY_HEADCOUNT_OPTIONS, LOCATION_RADIUS_OPTIONS,
  FilterPriority, FilterScope, CompanyScope, LocationScope,
} from '@/components/outreach/types';
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
  Secteur: <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>,
  Taille: <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><path d="M5 19v-5M12 19V9M19 19V5" /></svg>,
  'École': <svg viewBox="0 0 24 24" {...svgProps} strokeLinejoin="round" className="w-3 h-3"><path d="M12 5 21 9.5 12 14 3 9.5 12 5z" /><path d="M7 11.8V16c0 1.1 2.2 2 5 2s5-.9 5-2v-4.2" /></svg>,
  'Ancienneté': <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><rect x="4" y="6" width="16" height="14" rx="1" /><path d="M4 10.5h16M8.5 4v4M15.5 4v4" /></svg>,
  Contact: <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><rect x="4" y="6" width="16" height="12" rx="1" /><path d="m4 7.5 8 5.5 8-5.5" /></svg>,
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
  /** Filtres du brief déjà chargés : recherche directe, sans génération IA. */
  onLaunchWithBriefFilters?: () => void;
  /** Recherche échouée avant tout résultat : message affiché sous le prompt. */
  errorMessage?: string | null;
  disabled?: boolean;
}

const HERO_EXAMPLES = [
  'Account Manager SaaS B2B, 8-12 ans, grands comptes, Île-de-France, pas d\'ESN',
  'Head of Sales fintech série B, Paris, a scalé une équipe',
];

export const SearchHero: React.FC<SearchHeroProps> = ({
  jobTitle, clientName, history, onLaunch, onResumeHistory, onLaunchWithBriefFilters, errorMessage, disabled,
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
            onClick={() => { if (!armed && onLaunchWithBriefFilters) onLaunchWithBriefFilters(); else onLaunch(value.trim()); }}
            className={cn(
              'ml-auto inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-60',
              (armed || onLaunchWithBriefFilters)
                ? 'bg-[var(--k-accent)] text-[var(--k-on-accent)] hover:bg-[var(--k-accent-hover)] border border-transparent'
                : 'bg-transparent text-[var(--k-text-muted)] border border-[var(--k-hairline)] hover:text-[var(--k-text)] hover:border-[var(--k-hairline-hover)]',
            )}
          >
            <svg viewBox="0 0 24 24" {...svgProps} strokeWidth={1.6} className="w-3.5 h-3.5"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
            {!armed && onLaunchWithBriefFilters ? 'Lancer la recherche avec les filtres du brief' : <>Générer &amp; chercher</>}
          </button>
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="relative w-full max-w-[640px] mt-2 text-xs text-[var(--k-warn)]">{errorMessage}</p>
      )}

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
          {onLaunchWithBriefFilters ? 'régénérer les filtres depuis le brief' : 'générer depuis le brief'}
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
type FacetKey = 'poste' | 'lieu' | 'exp' | 'anciennete' | 'skills' | 'boite' | 'secteur' | 'taille' | 'ecole' | 'keywords' | 'seniorite' | 'langue' | 'contact';

/** Un token de valeur dans une facette. `state` pilote le rendu (dot accent =
 *  indispensable, barré = exclu) ; `mutable` = tri-état réglable au survol. */
interface ChipToken { label: string; state: Weight | 'plain'; mutable: boolean }
interface FacetChip {
  key: FacetKey;
  field: string;
  op: string;
  tokens: ChipToken[];
  weight: Weight;
  canCycle: boolean;
  /** Portée temporelle (Poste/Boîte) — segment cliquable si présent. */
  scopeLabel?: string;
}

/** Champs proposés par « + Filtre » — granularité directe sans passer par le
 *  panneau avancé. `advanced` = reste du panneau complet (diplôme, groupes…). */
const ADDABLE_FIELDS: { key: FacetKey | 'advanced'; label: string; hint?: string }[] = [
  { key: 'lieu', label: 'Lieu' },
  { key: 'poste', label: 'Poste' },
  { key: 'exp', label: 'Expérience totale' },
  { key: 'anciennete', label: 'Ancienneté dans le poste' },
  { key: 'skills', label: 'Compétence' },
  { key: 'boite', label: 'Entreprise' },
  { key: 'secteur', label: 'Secteur' },
  { key: 'taille', label: "Taille d'entreprise" },
  { key: 'ecole', label: 'École' },
  { key: 'seniorite', label: 'Séniorité' },
  { key: 'langue', label: 'Langue du profil' },
  { key: 'contact', label: 'Déjà contactés ?' },
  { key: 'advanced', label: 'Diplôme, spotlights, groupes…', hint: 'panneau avancé' },
];

/* Portées temporelles — mêmes buckets que LinkedIn Recruiter. */
const ROLE_SCOPE_LABELS: Record<string, string> = { CURRENT: 'actuel', PAST: 'passé', CURRENT_OR_PAST: 'act. ou passé' };
const ROLE_SCOPE_OPTIONS: { value: FilterScope; label: string }[] = [
  { value: 'CURRENT', label: 'Poste actuel uniquement' },
  { value: 'CURRENT_OR_PAST', label: 'Actuel ou passé' },
  { value: 'PAST', label: 'Passé uniquement' },
];
const COMPANY_SCOPE_LABELS: Record<string, string> = { CURRENT: 'actuelle', CURRENT_OR_PAST: 'act. ou passée', PAST: 'passée', PAST_NOT_CURRENT: 'ex-employés' };
const COMPANY_SCOPE_OPTIONS: { value: CompanyScope; label: string }[] = [
  { value: 'CURRENT', label: 'Entreprise actuelle' },
  { value: 'CURRENT_OR_PAST', label: 'Actuelle ou passée' },
  { value: 'PAST', label: 'Passée' },
  { value: 'PAST_NOT_CURRENT', label: 'Ex-employés (partis depuis)' },
];
const LOCATION_SCOPE_OPTIONS: { value: LocationScope; label: string }[] = [
  { value: 'CURRENT_OR_OPEN_TO_RELOCATE', label: 'Sur place ou prêts à déménager' },
  { value: 'CURRENT', label: 'Sur place uniquement' },
  { value: 'OPEN_TO_RELOCATE_ONLY', label: 'Prêts à déménager uniquement' },
];
const CONTACT_TIMESPANS: { value: number | null; label: string }[] = [
  { value: 30, label: '30 derniers jours' },
  { value: 90, label: '90 derniers jours' },
  { value: 180, label: '6 derniers mois' },
  { value: 365, label: '12 derniers mois' },
  { value: null, label: 'Depuis toujours' },
];
const COMPANY_CATEGORY_LABELS: Record<string, string> = {
  startup: 'Startup (1-200)', scaleup: 'Scale-up (51-1000)', enterprise: 'Grand groupe (1001+)', all: 'Toutes tailles',
};

const tokState = (p?: string): Weight => p === 'MUST_HAVE' ? 'must' : p === 'DOESNT_HAVE' ? 'exclude' : 'should';

function buildChips(f: LinkedInFiltersState): FacetChip[] {
  const chips: FacetChip[] = [];
  // Le tri-état par token n'est offert QUE là où le payload honore réellement
  // la priority — sinon une « exclusion » partirait comme inclusion (classic/
  // Sales Nav envoient des IDs nus pour lieu/école, skills est Recruiter-only).
  const isRecruiter = f.api === 'recruiter';
  const posteMutable = f.api !== 'classic';
  const lieuMutable = isRecruiter;
  const skillsMutable = isRecruiter;
  const ecoleMutable = isRecruiter || f.api === 'database';

  const roleTokens: ChipToken[] = [
    ...f.role.map(r => ({ label: r.keywords, state: tokState(r.priority), mutable: posteMutable })),
    ...f.job_title.map(j => ({ label: j.name, state: tokState(j.priority), mutable: posteMutable })),
  ];
  if (roleTokens.length) chips.push({
    key: 'poste', field: 'Poste', op: roleTokens.length > 1 ? "l'un de" : 'est', tokens: roleTokens,
    weight: roleTokens.some(t => t.state === 'must') ? 'must' : 'should',
    canCycle: true,
    scopeLabel: f.role.length ? (ROLE_SCOPE_LABELS[f.role[0].scope] ?? 'act. ou passé') : undefined,
  });

  if (f.location.length) chips.push({
    key: 'lieu', field: 'Lieu', op: f.location.length > 1 ? "l'un de" : 'est',
    tokens: f.location.map(l => ({ label: l.name, state: tokState(l.priority), mutable: lieuMutable })),
    weight: f.location.some(l => l.priority === 'MUST_HAVE') ? 'must' : 'should', canCycle: true,
  });

  if (f.calculated_experience_min != null || f.calculated_experience_max != null) chips.push({
    key: 'exp', field: 'Exp.', op: 'entre',
    tokens: [{ label: `${f.calculated_experience_min ?? 0}–${f.calculated_experience_max ?? '∞'} ans`, state: 'plain', mutable: false }],
    weight: 'should', canCycle: false,
  });

  if ((f.api === 'recruiter' || f.api === 'sales_navigator') && (f.tenure_at_role_min != null || f.tenure_at_role_max != null)) chips.push({
    key: 'anciennete', field: 'Ancienneté', op: 'poste actuel',
    tokens: [{ label: `${f.tenure_at_role_min ?? 0}–${f.tenure_at_role_max ?? '∞'} ans`, state: 'plain', mutable: false }],
    weight: 'should', canCycle: false,
  });

  const skillTokens: ChipToken[] = [
    ...f.skills.map(s => ({ label: s.name, state: tokState(s.priority), mutable: skillsMutable })),
    ...(f.skills_keywords || []).map(s => ({ label: s, state: 'plain' as const, mutable: false })),
  ];
  if (skillTokens.length) chips.push({
    key: 'skills', field: 'Skills', op: 'contient', tokens: skillTokens,
    weight: f.skills.some(s => s.priority === 'MUST_HAVE') ? 'must' : 'should', canCycle: false,
  });

  const boiteTokens: ChipToken[] = [
    ...f.company.map(c => ({ label: c.name, state: 'plain' as const, mutable: false })),
    ...f.company_keywords.map(c => ({ label: c.keywords, state: tokState(c.priority), mutable: true })),
    ...(f.exclude_consulting ? [{ label: 'ESN / Conseil', state: 'exclude' as const, mutable: false }] : []),
  ];
  if (boiteTokens.length) {
    const exclOnly = boiteTokens.every(t => t.state === 'exclude');
    chips.push({
      key: 'boite', field: 'Boîte', op: exclOnly ? 'exclut' : 'contient', tokens: boiteTokens,
      weight: exclOnly ? 'exclude' : boiteTokens.some(t => t.state === 'must') ? 'must' : 'should', canCycle: false,
      scopeLabel: f.company_keywords.length ? (COMPANY_SCOPE_LABELS[f.company_keywords[0].scope] ?? 'actuelle') : undefined,
    });
  }

  if (f.industry.length) chips.push({
    key: 'secteur', field: 'Secteur', op: f.industry.length > 1 ? "l'un de" : 'est',
    tokens: f.industry.map(i => ({ label: i.name, state: 'plain' as const, mutable: false })),
    weight: 'should', canCycle: false,
  });

  // Taille : tranches explicites, ou catégorie IA (startup/scaleup) qui les
  // pilote silencieusement côté payload quand aucune tranche n'est cochée.
  const tailleTokens: ChipToken[] = f.company_headcount.length
    ? f.company_headcount.map(h => ({ label: COMPANY_HEADCOUNT_OPTIONS.find(o => o.value === h)?.label || h, state: 'plain' as const, mutable: false }))
    : (f.company_category && f.company_category !== 'all'
      ? [{ label: COMPANY_CATEGORY_LABELS[f.company_category] || f.company_category, state: 'plain' as const, mutable: false }]
      : []);
  if (tailleTokens.length) chips.push({
    key: 'taille', field: 'Taille', op: tailleTokens.length > 1 ? "l'une de" : 'est', tokens: tailleTokens,
    weight: 'should', canCycle: false,
  });

  if (f.school.length) chips.push({
    key: 'ecole', field: 'École', op: 'parmi',
    tokens: f.school.map(s => ({ label: s.name, state: s.priority === 'DOESNT_HAVE' ? 'exclude' as const : 'plain' as const, mutable: ecoleMutable })),
    weight: f.school.every(s => s.priority === 'DOESNT_HAVE') ? 'exclude' : 'should', canCycle: false,
  });

  if (f.seniority.length) chips.push({
    key: 'seniorite', field: 'Séniorité', op: f.seniority.length > 1 ? "l'une de" : 'est',
    tokens: f.seniority.map(s => ({ label: SENIORITY_LEVELS.find(sl => sl.value === s)?.label || s, state: 'plain' as const, mutable: false })),
    weight: 'should', canCycle: false,
  });

  if (f.profile_language.length) chips.push({
    key: 'langue', field: 'Langue', op: f.profile_language.length > 1 ? "l'une de" : 'est',
    tokens: f.profile_language.map(l => ({ label: PROFILE_LANGUAGES.find(pl => pl.value === l)?.label || l, state: 'plain' as const, mutable: false })),
    weight: 'should', canCycle: false,
  });

  if (f.keywords?.trim()) chips.push({
    key: 'keywords', field: 'Mots-clés', op: 'booléen',
    tokens: [{ label: f.keywords.length > 34 ? f.keywords.slice(0, 34) + '…' : f.keywords, state: 'plain', mutable: false }],
    weight: 'should', canCycle: false,
  });

  // Méta-filtre Recruiter appliqué par défaut (INITIAL_FILTERS : non contactés
  // depuis 90 j) — visible pour ne plus exclure de profils silencieusement.
  if (f.api === 'recruiter' && f.activity_messages) chips.push({
    key: 'contact', field: 'Contact', op: '',
    tokens: [{
      label: (f.activity_messages === 'without_message' ? 'non contactés' : 'déjà contactés')
        + (f.activity_messages_days ? ` · ${f.activity_messages_days} j` : ' · toujours'),
      state: 'plain', mutable: false,
    }],
    weight: 'should', canCycle: false,
  });

  return chips;
}

function advancedCount(f: LinkedInFiltersState): number {
  return f.function.length + f.degree.length + f.groups.length
    + f.network_distance.length + f.past_company.length + f.past_job_title.length
    + (f.spotlight ? 1 : 0) + (f.open_to_work === true ? 1 : 0) + f.company_type.length;
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
          job_title: f.job_title.map(j => j.priority === 'DOESNT_HAVE' ? j : { ...j, priority: toMust ? 'MUST_HAVE' as const : 'CAN_HAVE' as const }),
        };
      }
      if (key === 'lieu') {
        const toMust = !f.location.some(l => l.priority === 'MUST_HAVE');
        return { ...f, location: f.location.map(l => l.priority === 'DOESNT_HAVE' ? l : ({ ...l, priority: toMust ? 'MUST_HAVE' as const : 'CAN_HAVE' as const })) };
      }
      return f;
    });
  }, [onFiltersEdit]);

  /* ── Retrait d'une facette entière ── */
  const removeFacet = useCallback((key: FacetChip['key']) => {
    onFiltersEdit(f => {
      switch (key) {
        case 'poste': return { ...f, role: [], job_title: [] };
        case 'lieu': return { ...f, location: [], location_within_area: null };
        case 'exp': return { ...f, calculated_experience_min: null, calculated_experience_max: null, years_of_experience_min: null, years_of_experience_max: null };
        case 'anciennete': return { ...f, tenure_at_role_min: null, tenure_at_role_max: null };
        case 'skills': return { ...f, skills: [], skills_keywords: [] };
        case 'boite': return { ...f, company: [], company_keywords: [], exclude_consulting: false };
        case 'secteur': return { ...f, industry: [] };
        case 'taille': return { ...f, company_headcount: [], company_category: '' };
        case 'ecole': return { ...f, school: [] };
        case 'keywords': return { ...f, keywords: '' };
        case 'seniorite': return { ...f, seniority: [] };
        case 'langue': return { ...f, profile_language: [] };
        case 'contact': return { ...f, activity_messages: null, activity_messages_days: null };
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
        case 'secteur': return { ...f, industry: f.industry.filter(i => i.name !== raw) };
        case 'taille': {
          const hv = COMPANY_HEADCOUNT_OPTIONS.find(o => o.label === raw)?.value;
          if (hv) return { ...f, company_headcount: f.company_headcount.filter(h => h !== hv) };
          return { ...f, company_category: '' }; // token catégorie IA (startup/scaleup…)
        }
        case 'ecole': return { ...f, school: f.school.filter(s => s.name !== raw) };
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

  /* ── Tri-état par token : Indispensable / Souhaité / Exclure (pattern
   *    LinkedIn Recruiter — l'exclusion vit au niveau de la valeur). ── */
  const setTokenPriority = useCallback((key: FacetChip['key'], label: string, prio: FilterPriority) => {
    onFiltersEdit(f => {
      switch (key) {
        case 'poste': return {
          ...f,
          role: f.role.map(r => r.keywords === label ? { ...r, priority: prio } : r),
          job_title: f.job_title.map(j => j.name === label ? { ...j, priority: prio } : j),
        };
        case 'lieu': return { ...f, location: f.location.map(l => l.name === label ? { ...l, priority: prio } : l) };
        case 'skills': return { ...f, skills: f.skills.map(s => s.name === label ? { ...s, priority: prio } : s) };
        case 'boite': return { ...f, company_keywords: f.company_keywords.map(c => c.keywords === label ? { ...c, priority: prio } : c) };
        case 'ecole': return { ...f, school: f.school.map(s => s.name === label ? { ...s, priority: prio } : s) };
        default: return f;
      }
    });
  }, [onFiltersEdit]);

  /* ── Portée temporelle de la facette (Poste : actuel/passé — Boîte : + ex-employés) ── */
  const setFacetScope = useCallback((key: 'poste' | 'boite', scope: string) => {
    onFiltersEdit(f => key === 'poste'
      ? { ...f, role: f.role.map(r => ({ ...r, scope: scope as FilterScope })) }
      : { ...f, company_keywords: f.company_keywords.map(c => ({ ...c, scope: scope as CompanyScope })) });
  }, [onFiltersEdit]);

  /** Résolution autocomplete LinkedIn (lieu, secteur, école) → {id, name}. */
  const resolveParam = useCallback(async (type: 'LOCATION' | 'INDUSTRY' | 'SCHOOL', v: string): Promise<{ id: string; name: string } | null> => {
    const { data } = await invokeUnipile({ body: { action: 'get_parameters', account_id: accountId, type, keywords: v, service: 'RECRUITER' } });
    const items = Array.isArray(data?.items) ? (data.items as any[]) : [];
    const norm = v.toLowerCase();
    const best = items.find((it: any) => String(it.title || '').toLowerCase() === norm)
      || items.find((it: any) => String(it.title || '').toLowerCase().includes(norm)) || items[0];
    return best?.id && best?.title ? { id: String(best.id), name: String(best.title) } : null;
  }, [accountId]);

  const addValue = useCallback(async (key: FacetChip['key'], value: string) => {
    const v = value.trim();
    if (!v) return;

    // Facettes à IDs LinkedIn : résolution autocomplete, fallback texte (Base Konekt)
    if (key === 'lieu' || key === 'secteur' || key === 'ecole') {
      const type = key === 'lieu' ? 'LOCATION' as const : key === 'secteur' ? 'INDUSTRY' as const : 'SCHOOL' as const;
      const noun = key === 'lieu' ? 'Localisation' : key === 'secteur' ? 'Secteur' : 'École';
      let item: { id: string; name: string } | null = null;
      if (searchSource === 'linkedin' && accountId) {
        setResolving(true);
        try {
          item = await resolveParam(type, v);
          if (!item) { toast.error(`${noun} « ${v} » introuvable`); return; }
        } catch { toast.error(`Résolution impossible — réessaie`); return; }
        finally { setResolving(false); }
      } else {
        item = { id: v, name: v };
      }
      const it = item;
      onFiltersEdit(f => {
        if (key === 'lieu') return f.location.some(l => l.id === it.id) ? f
          : { ...f, location: [...f.location, { ...it, priority: 'MUST_HAVE' as const, scope: 'CURRENT_OR_OPEN_TO_RELOCATE' as const }] };
        if (key === 'secteur') return f.industry.some(i => i.id === it.id) ? f
          : { ...f, industry: [...f.industry, it] };
        return f.school.some(s => s.id === it.id) ? f
          : { ...f, school: [...f.school, { ...it, priority: 'MUST_HAVE' as const }] };
      });
      return;
    }

    onFiltersEdit(f => {
      switch (key) {
        case 'poste': return { ...f, role: [...f.role, { keywords: v, priority: 'CAN_HAVE' as const, scope: (f.role[0]?.scope ?? 'CURRENT_OR_PAST') as FilterScope }] };
        case 'skills': return { ...f, skills_keywords: [...(f.skills_keywords || []), v] };
        case 'boite': return { ...f, company_keywords: [...f.company_keywords, { keywords: v, priority: 'CAN_HAVE' as const, scope: (f.company_keywords[0]?.scope ?? 'CURRENT') as CompanyScope }] };
        default: return f;
      }
    });
  }, [onFiltersEdit, accountId, searchSource, resolveParam]);

  const toggleOption = useCallback((key: 'seniorite' | 'langue' | 'taille', value: string) => {
    onFiltersEdit(f => {
      if (key === 'seniorite') return { ...f, seniority: f.seniority.includes(value) ? f.seniority.filter(s => s !== value) : [...f.seniority, value] };
      if (key === 'taille') return { ...f, company_headcount: f.company_headcount.includes(value) ? f.company_headcount.filter(h => h !== value) : [...f.company_headcount, value] };
      return { ...f, profile_language: f.profile_language.includes(value) ? f.profile_language.filter(l => l !== value) : [...f.profile_language, value] };
    });
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
        {chips.map(chip => {
          const displayVals = chip.tokens.map(t => t.state === 'exclude' ? `⌀ ${t.label}` : t.label);
          return (
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
                'inline-flex items-center gap-1.5 px-2 py-1',
                chip.op && 'border-r border-[var(--k-hairline)]',
                chip.weight === 'must' ? 'text-[var(--k-text)]' : chip.weight === 'exclude' ? 'text-[var(--k-bad,#e06666)]' : 'text-[var(--k-text-muted)]',
                chip.canCycle ? 'cursor-pointer hover:bg-[var(--k-surface-2)]' : 'cursor-default',
              )}
            >
              {chip.weight === 'must' && <span className="w-[5px] h-[5px] rounded-full bg-[var(--k-accent)]" />}
              {FIELD_ICONS[chip.field]}
              {chip.field}
            </button>
            {chip.op && <span className="inline-flex items-center px-1.5 py-1 text-[11.5px] font-normal text-[var(--k-text-muted)] border-r border-[var(--k-hairline)]">{chip.op}</span>}
            <button
              type="button"
              data-chip-seg
              onClick={() => setOpenKey(openKey === chip.key ? null : chip.key)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)] max-w-[220px]"
            >
              <span className="truncate">
                {displayVals.length > 2 ? `${displayVals.slice(0, 2).join(', ')} +${displayVals.length - 2}` : displayVals.join(', ')}
              </span>
            </button>
            {/* Portée temporelle — pattern LinkedIn Recruiter : change le champ
                du profil visé (actuel / passé / ex-employés), pas les termes. */}
            {chip.scopeLabel && (
              <button
                type="button"
                data-chip-seg
                onClick={() => setOpenKey(openKey === `${chip.key}@scope` ? null : `${chip.key}@scope`)}
                title="Portée — poste/entreprise actuel(le), passé(e)…"
                className="inline-flex items-center gap-0.5 px-1.5 py-1 border-l border-[var(--k-hairline)] text-[11px] font-normal text-[var(--k-text-muted)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text-2)]"
              >
                {chip.scopeLabel}
                <svg viewBox="0 0 24 24" {...svgProps} className="w-2.5 h-2.5"><path d="m7 10 5 5 5-5" /></svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => removeFacet(chip.key)}
              aria-label={`Retirer ${chip.field}`}
              className="inline-flex items-center px-1.5 py-1 border-l border-[var(--k-hairline)] text-[var(--k-text-muted)] hover:text-[var(--k-text)] hover:bg-[var(--k-surface-2)]"
            >
              <XIcon className="w-2.5 h-2.5" />
            </button>

            {/* Popover portée */}
            {openKey === `${chip.key}@scope` && (chip.key === 'poste' || chip.key === 'boite') && (
              <div data-chip-pop className="absolute z-40 top-full left-0 mt-1.5 min-w-[220px] rounded-[10px] border border-[var(--k-hairline-focus)] bg-[var(--k-surface-3)] shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)] px-2 pt-1 pb-1.5">Portée</div>
                {(chip.key === 'poste' ? ROLE_SCOPE_OPTIONS : COMPANY_SCOPE_OPTIONS).map(opt => {
                  const current = chip.key === 'poste' ? filters.role[0]?.scope : filters.company_keywords[0]?.scope;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setFacetScope(chip.key as 'poste' | 'boite', opt.value); setOpenKey(null); }}
                      className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]"
                    >
                      <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                      {current === opt.value && <span className="text-[var(--k-accent)]"><Check /></span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Popover valeurs */}
            {openKey === chip.key && (
              <div data-chip-pop className="absolute z-40 top-full left-0 mt-1.5 min-w-[240px] max-w-[310px] rounded-[10px] border border-[var(--k-hairline-focus)] bg-[var(--k-surface-3)] shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
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
                ) : chip.key === 'anciennete' ? (
                  <div className="flex items-center gap-1.5 px-2 pb-1.5 text-xs text-[var(--k-text-muted)]">
                    <input type="number" min={0} max={40} value={filters.tenure_at_role_min ?? ''} placeholder="min"
                      onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(40, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, tenure_at_role_min: v })); }}
                      className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                    →
                    <input type="number" min={0} max={40} value={filters.tenure_at_role_max ?? ''} placeholder="max"
                      onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(40, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, tenure_at_role_max: v })); }}
                      className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                    ans dans le poste
                  </div>
                ) : chip.key === 'contact' ? (
                  <>
                    {([
                      { v: 'without_message' as const, label: 'Exclure les déjà contactés' },
                      { v: 'with_message' as const, label: 'Seulement les déjà contactés' },
                    ]).map(opt => (
                      <button key={opt.v} type="button"
                        onClick={() => onFiltersEdit(f => ({ ...f, activity_messages: opt.v }))}
                        className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]">
                        <span className="flex-1 min-w-0 truncate">{opt.label}</span>
                        {filters.activity_messages === opt.v && <span className="text-[var(--k-accent)]"><Check /></span>}
                      </button>
                    ))}
                    <div className="border-t border-[var(--k-hairline)] mt-1 pt-1.5 px-2 pb-1">
                      <label className="flex items-center justify-between gap-2 text-xs text-[var(--k-text-muted)]">
                        Période
                        <select
                          value={filters.activity_messages_days ?? ''}
                          onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); onFiltersEdit(f => ({ ...f, activity_messages_days: v })); }}
                          className="h-7 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-1.5 text-xs text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]"
                        >
                          {CONTACT_TIMESPANS.map(o => <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>)}
                        </select>
                      </label>
                      <p className="mt-1.5 text-[11px] leading-snug text-[var(--k-text-muted)]">Messages LinkedIn envoyés par l'équipe.</p>
                    </div>
                  </>
                ) : chip.key === 'keywords' ? (
                  <button type="button" onClick={() => { setOpenKey(null); onOpenAdvanced(); }}
                    className="w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]">
                    Éditer la requête booléenne dans le panneau avancé →
                  </button>
                ) : (chip.key === 'seniorite' || chip.key === 'langue' || chip.key === 'taille') ? (
                  <>
                    {(chip.key === 'seniorite' ? SENIORITY_LEVELS : chip.key === 'taille' ? COMPANY_HEADCOUNT_OPTIONS : PROFILE_LANGUAGES).map(opt => {
                      const checked = chip.key === 'seniorite'
                        ? filters.seniority.includes(opt.value)
                        : chip.key === 'taille'
                          ? filters.company_headcount.includes(opt.value)
                          : filters.profile_language.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleOption(chip.key as 'seniorite' | 'langue' | 'taille', opt.value)}
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
                    {chip.tokens.map(t => (
                      <div key={t.label} className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)]">
                        {t.state === 'must' && <span className="w-[5px] h-[5px] rounded-full bg-[var(--k-accent)] shrink-0" />}
                        <span className={cn('flex-1 min-w-0 truncate', t.state === 'exclude' && 'line-through text-[var(--k-bad,#e06666)]')}>{t.label}</span>
                        {t.mutable && t.state !== 'plain' && chip.key !== 'ecole' && (
                          <button
                            type="button"
                            onClick={() => setTokenPriority(chip.key, t.label, t.state === 'must' ? 'CAN_HAVE' : 'MUST_HAVE')}
                            title={t.state === 'must' ? 'Repasser en souhaité' : 'Rendre indispensable'}
                            className={cn('shrink-0 transition-opacity', t.state === 'must' ? 'text-[var(--k-accent)]' : 'opacity-0 group-hover:opacity-100 text-[var(--k-text-muted)] hover:text-[var(--k-accent)]')}
                          >
                            <svg viewBox="0 0 24 24" className="w-3 h-3"><circle cx="12" cy="12" r="4.5" fill="currentColor" /></svg>
                          </button>
                        )}
                        {t.mutable && (
                          <button
                            type="button"
                            onClick={() => setTokenPriority(chip.key, t.label, t.state === 'exclude' ? (chip.key === 'ecole' ? 'MUST_HAVE' : 'CAN_HAVE') : 'DOESNT_HAVE')}
                            title={t.state === 'exclude' ? 'Ne plus exclure' : 'Exclure cette valeur'}
                            className={cn('shrink-0 transition-opacity', t.state === 'exclude' ? 'text-[var(--k-bad,#e06666)]' : 'opacity-0 group-hover:opacity-100 text-[var(--k-text-muted)] hover:text-[var(--k-bad,#e06666)]')}
                          >
                            <svg viewBox="0 0 24 24" {...svgProps} className="w-3 h-3"><circle cx="12" cy="12" r="7.5" /><path d="M6.9 6.9 17.1 17.1" /></svg>
                          </button>
                        )}
                        {chip.tokens.length > 1 && (
                          <button type="button" onClick={() => removeValue(chip.key, t.label)} aria-label={`Retirer ${t.label}`}
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-[var(--k-text-muted)] hover:text-[var(--k-text)]">
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
                    {chip.key === 'lieu' && (
                      <div className="border-t border-[var(--k-hairline)] mt-1 pt-1.5 px-2 pb-1 flex flex-col gap-1.5">
                        {searchSource === 'linkedin' && (
                          <label className="flex items-center justify-between gap-2 text-xs text-[var(--k-text-muted)]">
                            Rayon
                            <select
                              value={filters.location_within_area ?? ''}
                              onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); onFiltersEdit(f => ({ ...f, location_within_area: v })); }}
                              className="h-7 max-w-[160px] rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-1.5 text-xs text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]"
                            >
                              {LOCATION_RADIUS_OPTIONS.map(o => <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>)}
                            </select>
                          </label>
                        )}
                        <label className="flex items-center justify-between gap-2 text-xs text-[var(--k-text-muted)]">
                          Mobilité
                          <select
                            value={filters.location[0]?.scope ?? 'CURRENT_OR_OPEN_TO_RELOCATE'}
                            onChange={e => { const v = e.target.value as LocationScope; onFiltersEdit(f => ({ ...f, location: f.location.map(l => ({ ...l, scope: v })) })); }}
                            className="h-7 max-w-[160px] rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-1.5 text-xs text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]"
                          >
                            {LOCATION_SCOPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </span>
          );
        })}

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
                  {ADDABLE_FIELDS.filter(fd => {
                    // Aligné sur ce que le payload honore réellement par licence :
                    // contact = recruiting_activity (Recruiter only), ancienneté =
                    // tenure_in_position / tenure_at_role (Recruiter + Sales Nav).
                    if (fd.key === 'contact') return filters.api === 'recruiter';
                    if (fd.key === 'anciennete') return filters.api === 'recruiter' || filters.api === 'sales_navigator';
                    return true;
                  }).map(fd => (
                    <button
                      key={fd.key}
                      type="button"
                      onClick={() => {
                        if (fd.key === 'advanced') { setOpenKey(null); onOpenAdvanced(); return; }
                        if (fd.key === 'contact') {
                          // Applique le défaut le plus courant, réglable ensuite dans la chip
                          onFiltersEdit(f => ({ ...f, activity_messages: f.activity_messages ?? 'without_message', activity_messages_days: f.activity_messages_days ?? 90 }));
                          setOpenKey(null);
                          return;
                        }
                        setAddField(fd.key as FacetKey);
                      }}
                      className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)]"
                    >
                      <span className="flex-1">{fd.label}</span>
                      {fd.hint && <span className="font-mono text-[10px] text-[var(--k-text-muted)]">{fd.hint}</span>}
                    </button>
                  ))}
                </>
              ) : addField === 'anciennete' ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--k-text-muted)]">
                  <input type="number" min={0} max={40} autoFocus placeholder="min"
                    onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(40, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, tenure_at_role_min: v })); }}
                    className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                  →
                  <input type="number" min={0} max={40} placeholder="max"
                    onChange={e => { const v = e.target.value === '' ? null : Math.max(0, Math.min(40, parseInt(e.target.value, 10) || 0)); onFiltersEdit(f => ({ ...f, tenure_at_role_max: v })); }}
                    className="h-7 w-14 rounded-md border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-center text-[var(--k-text-2)] outline-none focus:border-[var(--k-hairline-focus)]" />
                  ans dans le poste
                </div>
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
              ) : (addField === 'seniorite' || addField === 'langue' || addField === 'taille') ? (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)] px-2 pt-1 pb-1.5">
                    {addField === 'seniorite' ? 'Séniorité' : addField === 'taille' ? "Taille d'entreprise" : 'Langue du profil'}
                  </div>
                  {(addField === 'seniorite' ? SENIORITY_LEVELS : addField === 'taille' ? COMPANY_HEADCOUNT_OPTIONS : PROFILE_LANGUAGES).map(opt => {
                    const checked = addField === 'seniorite'
                      ? filters.seniority.includes(opt.value)
                      : addField === 'taille'
                        ? filters.company_headcount.includes(opt.value)
                        : filters.profile_language.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleOption(addField as 'seniorite' | 'langue' | 'taille', opt.value)}
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
