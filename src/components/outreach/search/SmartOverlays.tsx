/**
 * SmartOverlays — surcouches de filtres en un clic.
 *
 * Une rangée de toggles au-dessus des résultats (pattern « spotlights »
 * LinkedIn Recruiter) : chaque surcouche applique/retire un PAQUET de
 * filtres déterministe dans LinkedInFiltersState. Rien de magique : les
 * valeurs ajoutées apparaissent dans les pilules et restent éditables
 * individuellement ; la recherche n'est relancée que via « Relancer »
 * (exploration éphémère, pattern Attio).
 */
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState } from '@/components/outreach/types';
import {
  TOP_ENGINEERING_SCHOOLS, TOP_BUSINESS_SCHOOLS, ESN_BOOLEAN_GROUPS,
} from './smartOverlayData';

const TOP_SCHOOLS = [...TOP_ENGINEERING_SCHOOLS, ...TOP_BUSINESS_SCHOOLS];
const TOP_SCHOOL_IDS = new Set(TOP_SCHOOLS.map(s => s.id));

const norm = (s: string) => s.trim().toLowerCase();

/* ── Levées de fonds : annuaire Konekt des sociétés financées (EU, rafraîchi
 *    mensuellement), IDs LinkedIn résolus. LinkedIn n'a pas de filtre funding
 *    natif — on injecte les sociétés du stade choisi en boîte ACTUELLE. ── */
const FUNDING_STAGES = [
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Série A' },
  { value: 'series_b', label: 'Série B' },
  { value: 'series_c', label: 'Série C' },
];
// Cap par stade : au-delà, le payload LinkedIn devient trop lourd (erreurs
// « combinaison de filtres trop lourde ») — on prend les mieux classées (tier).
const FUNDED_CAP = 100;
type FundedScope = 'FR' | 'EU';
interface FundedStage { list: { id: string; name: string }[]; total: number }
const fundedCache = new Map<string, FundedStage>();

async function fetchFundedCompanies(stage: string, scope: FundedScope): Promise<FundedStage> {
  const cacheKey = `${stage}:${scope}`;
  const cached = fundedCache.get(cacheKey);
  if (cached) return cached;
  let query = supabase
    .from('pedigree_company_directory' as never)
    .select('canonical_name, linkedin_company_id, tier')
    .eq('funding_stage', stage)
    .not('linkedin_company_id', 'is', null);
  if (scope === 'FR') query = query.eq('country', 'FR');
  const { data, error } = await query
    .order('tier', { ascending: true })
    .order('canonical_name', { ascending: true });
  if (error) throw error;
  // IDs NUMÉRIQUES uniquement : le schéma LinkedIn Recruiter rejette les slugs
  // ("21-invest") avec un 400 invalid_parameters — les entrées slug sont celles
  // que le cron de résolution n'a pas encore converties.
  const numeric = ((data ?? []) as unknown as Array<{ canonical_name: string; linkedin_company_id: string }>)
    .filter(r => /^\d+$/.test(String(r.linkedin_company_id)))
    .map(r => ({ id: String(r.linkedin_company_id), name: r.canonical_name }));
  const entry = { list: numeric.slice(0, FUNDED_CAP), total: numeric.length };
  fundedCache.set(cacheKey, entry);
  return entry;
}

interface SmartOverlaysProps {
  filters: LinkedInFiltersState;
  onFiltersEdit: (updater: (prev: LinkedInFiltersState) => LinkedInFiltersState) => void;
  /** alt_companies suggérées par l'IA (jamais affichées ailleurs) */
  suggestedCompanies: string[];
  searchSource: 'linkedin' | 'database';
}

interface OverlayDef {
  key: string;
  label: string;
  title: string;
  active: (f: LinkedInFiltersState) => boolean;
  toggle: (f: LinkedInFiltersState, active: boolean) => LinkedInFiltersState;
  /** Masquée si non pertinente pour la source courante */
  show?: (searchSource: 'linkedin' | 'database', f: LinkedInFiltersState) => boolean;
}

/** Catégories de taille mutuellement exclusives (boîte ACTUELLE du candidat). */
const sizeOverlay = (key: 'startup' | 'scaleup' | 'enterprise', label: string, title: string): OverlayDef => ({
  key, label, title,
  active: f => f.company_category === key,
  // company_headcount vidé : des tranches explicites court-circuitent la
  // catégorie côté payload (guard buildSearchParams) — on évite le conflit muet.
  toggle: (f, active) => active
    ? { ...f, company_category: '' }
    : { ...f, company_category: key, company_headcount: [] },
  show: src => src === 'linkedin',
});

const OVERLAYS: OverlayDef[] = [
  /* ── Timing & engagement (signaux LinkedIn Recruiter natifs) ── */
  {
    key: 'prets-a-bouger',
    label: 'Prêts à bouger',
    title: "À l'écoute (open to work) OU actifs récemment sur LinkedIn — les plus susceptibles de répondre",
    active: f => f.open_to_work === true && f.spotlight === 'ACTIVE_TALENT',
    toggle: (f, active) => active
      ? { ...f, open_to_work: null, spotlight: '' as LinkedInFiltersState['spotlight'] }
      : { ...f, open_to_work: true, spotlight: 'ACTIVE_TALENT' as LinkedInFiltersState['spotlight'] },
    show: (_src, f) => f.api === 'recruiter',
  },
  {
    key: 'murs-bouger',
    label: 'Mûrs pour bouger',
    title: '3 ans ou plus dans le poste actuel sans évolution — la fenêtre de départ classique',
    active: f => f.tenure_at_role_min != null && f.tenure_at_role_min >= 3,
    toggle: (f, active) => active
      ? { ...f, tenure_at_role_min: null, tenure_at_role_max: null }
      : { ...f, tenure_at_role_min: 3, tenure_at_role_max: null },
    show: (_src, f) => f.api === 'recruiter' || f.api === 'sales_navigator',
  },
  {
    key: 'jamais-contactes',
    label: 'Jamais contactés · 12 mois',
    title: "Exclut les profils déjà messagés par l'équipe sur le contrat Recruiter ces 12 derniers mois",
    active: f => f.activity_messages === 'without_message' && f.activity_messages_days === 365,
    toggle: (f, active) => active
      ? { ...f, activity_messages: null, activity_messages_days: null }
      : { ...f, activity_messages: 'without_message' as LinkedInFiltersState['activity_messages'], activity_messages_days: 365 },
    show: (_src, f) => f.api === 'recruiter',
  },
  {
    key: 'deja-croises',
    label: 'Déjà croisés',
    title: "Candidats déjà apparus dans d'anciennes recherches de l'équipe — le stock dormant à requalifier",
    active: f => f.spotlight === 'REDISCOVERED_CANDIDATES',
    toggle: (f, active) => ({ ...f, spotlight: (active ? '' : 'REDISCOVERED_CANDIDATES') as LinkedInFiltersState['spotlight'] }),
    show: (_src, f) => f.api === 'recruiter',
  },
  {
    key: 'warm-intro',
    label: 'Warm intro',
    title: 'Réseau 1er et 2e degré du compte connecté — une connexion commune peut faire l\'intro',
    active: f => f.network_distance.length > 0 && f.network_distance.every(d => d === 1 || d === 2),
    toggle: (f, active) => active
      ? { ...f, network_distance: [] }
      : { ...f, network_distance: [1, 2] },
    show: src => src === 'linkedin',
  },
  /* ── Profil & parcours ── */
  {
    key: 'top-ecoles',
    label: 'Top écoles',
    title: `${TOP_SCHOOLS.length} grandes écoles FR (HEC, Polytechnique, Centrale…) ajoutées au filtre École — « au moins une »`,
    active: f => TOP_SCHOOLS.filter(s => f.school.some(sc => sc.id === s.id)).length >= 10,
    toggle: (f, active) => active
      ? { ...f, school: f.school.filter(sc => !TOP_SCHOOL_IDS.has(sc.id)) }
      : {
        ...f,
        school: [
          ...f.school,
          ...TOP_SCHOOLS.filter(s => !f.school.some(sc => sc.id === s.id))
            .map(s => ({ ...s, priority: 'MUST_HAVE' as const })),
        ],
      },
  },
  sizeOverlay('startup', 'Startup', 'Boîte actuelle de 1 à 200 personnes'),
  sizeOverlay('scaleup', 'Scale-up', 'Boîte actuelle de 51 à 1000 personnes'),
  sizeOverlay('enterprise', 'Grand groupe', 'Boîte actuelle de 1001+ personnes'),
  {
    key: 'hors-esn',
    label: 'Hors ESN',
    title: 'Exclut les profils en ESN / cabinet de conseil',
    active: f => f.exclude_consulting === true,
    toggle: (f, active) => ({ ...f, exclude_consulting: !active }),
  },
  {
    key: 'ex-esn',
    label: 'Ex-ESN',
    title: 'Est passé par une grande ESN (Capgemini, Alten, Sopra…) mais n\'y est plus — profils rompus au delivery, sortis du conseil',
    active: f => f.company_keywords.some(c => ESN_BOOLEAN_GROUPS.includes(c.keywords)),
    toggle: (f, active) => active
      ? { ...f, company_keywords: f.company_keywords.filter(c => !ESN_BOOLEAN_GROUPS.includes(c.keywords)) }
      : {
        ...f,
        company_keywords: [
          ...f.company_keywords,
          ...ESN_BOOLEAN_GROUPS
            .filter(g => !f.company_keywords.some(c => c.keywords === g))
            .map(g => ({ keywords: g, priority: 'CAN_HAVE' as const, scope: 'PAST_NOT_CURRENT' as const })),
        ],
      },
    show: src => src === 'linkedin',
  },
  {
    key: 'vivier',
    label: 'Vivier suggéré',
    title: '', // rempli dynamiquement avec les noms
    active: () => false, // surchargé dynamiquement
    toggle: f => f, // surchargé dynamiquement
    show: (_src, _f) => true,
  },
];

export const SmartOverlays: React.FC<SmartOverlaysProps> = ({
  filters, onFiltersEdit, suggestedCompanies, searchSource,
}) => {
  const vivier = suggestedCompanies.filter(c => c?.trim()).slice(0, 6);

  /* ── Picker « A levé des fonds » ── */
  const [stageOpen, setStageOpen] = useState(false);
  const [stageLoading, setStageLoading] = useState<string | null>(null);
  const [fundedScope, setFundedScope] = useState<FundedScope>('FR');
  const [, bumpCache] = useState(0); // re-render quand fundedCache se remplit
  const pickerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!stageOpen) return;
    const close = (e: MouseEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setStageOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setStageOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [stageOpen]);

  // Pré-charge les 4 stades à la 1re ouverture (états actifs + compteurs)
  useEffect(() => {
    if (!stageOpen) return;
    const missing = FUNDING_STAGES.filter(s => !fundedCache.has(`${s.value}:${fundedScope}`));
    if (!missing.length) return;
    Promise.allSettled(missing.map(s => fetchFundedCompanies(s.value, fundedScope))).then(() => bumpCache(x => x + 1));
  }, [stageOpen, fundedScope]);

  const stageActive = (stage: string): boolean => {
    const list = fundedCache.get(`${stage}:${fundedScope}`)?.list;
    if (!list?.length) return false;
    const present = list.filter(c => filters.company.some(fc => fc.id === c.id)).length;
    return present >= Math.min(10, list.length);
  };

  const toggleStage = async (stage: string) => {
    if (stageLoading) return;
    setStageLoading(stage);
    try {
      const { list } = await fetchFundedCompanies(stage, fundedScope);
      bumpCache(x => x + 1);
      if (!list.length) { toast.info('Annuaire en cours de résolution pour ce stade — réessaie dans quelques minutes'); return; }
      const active = list.filter(c => filters.company.some(fc => fc.id === c.id)).length >= Math.min(10, list.length);
      onFiltersEdit(f => active
        ? { ...f, company: f.company.filter(c => !list.some(l => l.id === c.id)) }
        : { ...f, company: [...f.company, ...list.filter(l => !f.company.some(c => c.id === l.id))] });
    } catch {
      toast.error('Annuaire des levées de fonds indisponible');
    } finally {
      setStageLoading(null);
    }
  };

  const anyStageActive = FUNDING_STAGES.some(s => stageActive(s.value));

  const defs = OVERLAYS
    .filter(d => d.key !== 'vivier' || vivier.length > 0)
    .filter(d => !d.show || d.show(searchSource, filters))
    .map(d => {
      if (d.key !== 'vivier') return d;
      const present = vivier.filter(name => filters.company_keywords.some(c => norm(c.keywords) === norm(name)));
      return {
        ...d,
        title: `Entreprises où ce profil se trouve souvent, suggérées par l'IA : ${vivier.join(', ')}`,
        active: () => present.length === vivier.length,
        toggle: (f: LinkedInFiltersState, active: boolean) => active
          ? { ...f, company_keywords: f.company_keywords.filter(c => !vivier.some(name => norm(name) === norm(c.keywords))) }
          : {
            ...f,
            company_keywords: [
              ...f.company_keywords,
              ...vivier
                .filter(name => !f.company_keywords.some(c => norm(c.keywords) === norm(name)))
                .map(name => ({ keywords: name, priority: 'CAN_HAVE' as const, scope: 'CURRENT' as const })),
            ],
          },
      } as OverlayDef;
    });

  if (!defs.length) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--k-text-muted)] mr-1">
        Surcouches
      </span>
      {defs.map(d => {
        const isActive = d.active(filters);
        return (
          <button
            key={d.key}
            type="button"
            role="switch"
            aria-checked={isActive}
            title={d.title}
            onClick={() => onFiltersEdit(f => d.toggle(f, d.active(f)))}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
              isActive
                ? 'bg-[var(--k-accent-tint)] border-[color-mix(in_srgb,var(--k-accent)_40%,var(--k-hairline))] text-[var(--k-text)]'
                : 'border-[var(--k-hairline)] text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)]',
            )}
          >
            {isActive && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} className="w-2.5 h-2.5 text-[var(--k-accent)]"><path d="M20 7 10 17l-5-5" /></svg>
            )}
            {d.label}
          </button>
        );
      })}

      {/* A levé des fonds — sous-menu par stade, sociétés de l'annuaire Konekt */}
      {searchSource === 'linkedin' && (
        <span ref={pickerRef} className="relative">
          <button
            type="button"
            title="Boîte actuelle parmi les sociétés financées connues (annuaire Konekt, EU, rafraîchi chaque mois) — choisis le stade de levée"
            onClick={() => setStageOpen(o => !o)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
              anyStageActive
                ? 'bg-[var(--k-accent-tint)] border-[color-mix(in_srgb,var(--k-accent)_40%,var(--k-hairline))] text-[var(--k-text)]'
                : 'border-[var(--k-hairline)] text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)]',
            )}
          >
            {anyStageActive && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} className="w-2.5 h-2.5 text-[var(--k-accent)]"><path d="M20 7 10 17l-5-5" /></svg>
            )}
            A levé
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-2.5 h-2.5"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          {stageOpen && (
            <div className="absolute z-40 top-full left-0 mt-1.5 min-w-[220px] rounded-[10px] border border-[var(--k-hairline-focus)] bg-[var(--k-surface-3)] shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
              <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--k-text-muted)]">Stade de levée</span>
                <span className="inline-flex rounded-md border border-[var(--k-hairline)] overflow-hidden">
                  {(['FR', 'EU'] as const).map(sc => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setFundedScope(sc)}
                      title={sc === 'FR' ? 'Sociétés collectées via la recherche France' : 'Toute la collecte européenne (FR, DE, UK, ES, NL, BE, CH, IT)'}
                      className={cn(
                        'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                        fundedScope === sc
                          ? 'bg-[var(--k-surface-2)] text-[var(--k-text)]'
                          : 'text-[var(--k-text-muted)] hover:text-[var(--k-text-2)]',
                      )}
                    >
                      {sc === 'FR' ? 'France' : 'Europe'}
                    </button>
                  ))}
                </span>
              </div>
              {FUNDING_STAGES.map(s => {
                const entry = fundedCache.get(`${s.value}:${fundedScope}`);
                const active = stageActive(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    role="checkbox"
                    aria-checked={active}
                    disabled={stageLoading !== null}
                    onClick={() => toggleStage(s.value)}
                    className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-[13px] text-[var(--k-text-2)] hover:bg-[var(--k-surface-2)] hover:text-[var(--k-text)] disabled:opacity-60"
                  >
                    <span className="flex-1 min-w-0 truncate">{s.label}</span>
                    {entry && (
                      <span className="font-mono text-[10px] text-[var(--k-text-muted)]">
                        {entry.list.length === 0 ? 'en résolution…'
                          : entry.total > entry.list.length ? `top ${entry.list.length} / ${entry.total}`
                          : `${entry.list.length} boîtes`}
                      </span>
                    )}
                    {stageLoading === s.value
                      ? <Loader2 className="w-3 h-3 animate-spin text-[var(--k-text-muted)]" />
                      : active && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} className="w-2.5 h-2.5 text-[var(--k-accent)]"><path d="M20 7 10 17l-5-5" /></svg>}
                  </button>
                );
              })}
              <p className="px-2 pt-1 pb-0.5 text-[11px] leading-snug text-[var(--k-text-muted)]">
                Les {FUNDED_CAP} sociétés les mieux classées du stade sont injectées comme boîte actuelle
                (au-delà, LinkedIn rejette la recherche). Élagables une à une dans la pilule Boîte.
              </p>
            </div>
          )}
        </span>
      )}
    </div>
  );
};
