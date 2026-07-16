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
import React from 'react';
import { cn } from '@/lib/utils';
import { LinkedInFiltersState } from '@/components/outreach/types';
import {
  TOP_ENGINEERING_SCHOOLS, TOP_BUSINESS_SCHOOLS, ESN_BOOLEAN_GROUPS,
} from './smartOverlayData';

const TOP_SCHOOLS = [...TOP_ENGINEERING_SCHOOLS, ...TOP_BUSINESS_SCHOOLS];
const TOP_SCHOOL_IDS = new Set(TOP_SCHOOLS.map(s => s.id));

const norm = (s: string) => s.trim().toLowerCase();

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
    </div>
  );
};
