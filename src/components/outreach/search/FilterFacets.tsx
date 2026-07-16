/**
 * Résumé de facettes — la recherche entière visible d'un coup d'œil.
 *
 * Remplace la lecture par accordéons : chaque critère est une puce éditable
 * (clic = bascule obligatoire ↔ souhaité, × = retirer, + Ajouter = saisie
 * inline). La priorité est encodée par un point 5px + voile léger (jamais un
 * aplat saturé). Registre Linear/Qonto via tokens --k-*.
 *
 * Couvre les champs générés par l'IA (role, location, skills_keywords,
 * company_keywords, expérience, séniorité) ; le détail complet (autocomplete
 * LinkedIn, booléen, spotlights…) reste dans LinkedInFilters, replié derrière
 * « Options avancées ».
 */
import React, { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { invokeUnipile } from '@/lib/invokeUnipile';
import {
  LinkedInFiltersState,
  SENIORITY_LEVELS,
} from '@/components/outreach/types';

interface FilterFacetsProps {
  filters: LinkedInFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<LinkedInFiltersState>>;
  accountId: string | null;
  searchSource: 'linkedin' | 'database';
  onClearAll?: () => void;
}

/* ── Icônes facettes — registre géométrique 1.5px (cf. maquette) ── */
const I = {
  poste: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px]"><rect x="3.5" y="8" width="17" height="11" rx="1.25"/><rect x="9" y="5" width="6" height="3" rx="0.75"/><path d="M3.5 12.5h17"/></svg>,
  lieu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="w-[13px] h-[13px]"><path d="M6 10a6 6 0 0 1 12 0L12 21 6 10z"/><circle cx="12" cy="10" r="2.3"/></svg>,
  exp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px]"><circle cx="12" cy="12" r="8"/><path d="M12 12V7.5M12 12l3.5 2"/></svg>,
  skills: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="w-[13px] h-[13px]"><path d="M12 4 20 9l-8 5-8-5 8-5z"/><path d="M4 12.5l8 5 8-5M4 15.5l8 5 8-5"/></svg>,
  boite: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px]"><rect x="5" y="3" width="14" height="18" rx="1"/><rect x="8" y="6" width="2.2" height="2.2"/><rect x="13.8" y="6" width="2.2" height="2.2"/><rect x="8" y="10.4" width="2.2" height="2.2"/><rect x="13.8" y="10.4" width="2.2" height="2.2"/><path d="M10.5 21v-4h3v4"/></svg>,
  senior: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px]"><path d="M5 17h3M5 12h7M5 7h11"/></svg>,
};

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5"><path d="M7 7 17 17M17 7 7 17"/></svg>
);

/* ── Puce éditable ── */
const Chip: React.FC<{
  label: string;
  must?: boolean;
  exclude?: boolean;
  onToggle?: () => void;
  onRemove: () => void;
  title?: string;
}> = ({ label, must, exclude, onToggle, onRemove, title }) => (
  <span
    role={onToggle ? 'button' : undefined}
    tabIndex={onToggle ? 0 : undefined}
    onClick={onToggle}
    onKeyDown={onToggle ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }) : undefined}
    title={title ?? (onToggle ? 'Clic : obligatoire ↔ souhaité' : undefined)}
    className={cn(
      'group inline-flex items-center gap-1.5 min-h-6 rounded-full pl-2.5 pr-1.5 py-0.5 text-[13px] font-medium transition-colors duration-150 select-none',
      onToggle && 'cursor-pointer',
      must
        ? 'bg-[var(--k-accent-tint)] border border-transparent text-[var(--k-text)]'
        : 'bg-transparent border border-[var(--k-hairline)] text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)]'
    )}
  >
    {must && <span className="w-[5px] h-[5px] rounded-full bg-[var(--k-accent)] shrink-0" aria-label="Obligatoire" />}
    {exclude && <span className="font-mono text-[9px] uppercase tracking-wide text-[var(--k-text-muted)]">Exclure</span>}
    <span className="max-w-[180px] truncate">{label}</span>
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onRemove(); }}
      className="w-4 h-4 grid place-items-center rounded text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[var(--k-text)] hover:bg-[var(--k-hairline-hover)] transition-opacity"
      aria-label={`Retirer ${label}`}
    >
      <XIcon />
    </button>
  </span>
);

/* ── Ajout inline : "+ Ajouter" ↔ input chip ── */
const AddChip: React.FC<{ placeholder: string; onAdd: (v: string) => void; busy?: boolean }> = ({ placeholder, onAdd, busy }) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const commit = () => {
    const v = val.trim();
    if (v) onAdd(v);
    setVal('');
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setEditing(true); requestAnimationFrame(() => ref.current?.focus()); }}
        className="inline-flex items-center gap-1 min-h-6 rounded-full border border-dashed border-[var(--k-hairline)] px-2.5 py-0.5 text-xs font-medium text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] hover:border-[var(--k-hairline-hover)] transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3 h-3"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>
        Ajouter
      </button>
    );
  }
  return (
    <input
      ref={ref}
      value={val}
      disabled={busy}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setVal(''); setEditing(false); }
      }}
      placeholder={placeholder}
      className="h-6 w-40 rounded-full border border-[var(--k-hairline-focus)] bg-[var(--k-surface)] px-2.5 text-[13px] text-[var(--k-text)] placeholder:text-[var(--k-text-placeholder)] focus:outline-none"
    />
  );
};

/* ── Ligne de facette ── */
const FacetRow: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="grid grid-cols-[72px_1fr] gap-2.5 items-start">
    <div className="flex items-center gap-1.5 pt-[5px] text-[var(--k-text-muted)]">
      {icon}
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em]">{label}</span>
    </div>
    <div className="flex flex-wrap gap-1.5 min-w-0">{children}</div>
  </div>
);

/* ── Éditeur de plage d'expérience ── */
const ExpRange: React.FC<{
  min: number | null; max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}> = ({ min, max, onChange }) => {
  const parse = (v: string) => (v === '' ? null : Math.max(0, Math.min(50, parseInt(v, 10) || 0)));
  const box = 'h-6 w-14 rounded-[7px] border border-[var(--k-hairline)] bg-[var(--k-surface)] px-2 font-mono text-xs text-[var(--k-text-2)] text-center focus:outline-none focus:border-[var(--k-hairline-focus)] placeholder:text-[var(--k-text-placeholder)]';
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--k-text-muted)]">
      <input type="number" min={0} max={50} value={min ?? ''} placeholder="min" className={box}
        onChange={e => onChange(parse(e.target.value), max)} />
      <span aria-hidden="true">→</span>
      <input type="number" min={0} max={50} value={max ?? ''} placeholder="max" className={box}
        onChange={e => onChange(min, parse(e.target.value))} />
      <span>ans</span>
    </span>
  );
};

export const FilterFacets: React.FC<FilterFacetsProps> = ({
  filters,
  setFilters,
  accountId,
  searchSource,
  onClearAll,
}) => {
  const [resolvingLocation, setResolvingLocation] = useState(false);

  /* ── Poste (role[] + job_title[]) ── */
  const toggleRole = useCallback((i: number) => {
    setFilters(f => ({
      ...f,
      role: f.role.map((r, k) => k === i
        ? { ...r, priority: r.priority === 'MUST_HAVE' ? 'CAN_HAVE' as const : 'MUST_HAVE' as const }
        : r),
    }));
  }, [setFilters]);

  const addRole = useCallback((keywords: string) => {
    setFilters(f => ({
      ...f,
      role: [...f.role, { keywords, priority: 'CAN_HAVE' as const, scope: 'CURRENT_OR_PAST' as const }],
    }));
  }, [setFilters]);

  /* ── Lieu — résolution geo ID LinkedIn si compte dispo, sinon nom brut (Base Konekt) ── */
  const addLocation = useCallback(async (name: string) => {
    if (searchSource === 'linkedin' && accountId) {
      setResolvingLocation(true);
      try {
        const { data } = await invokeUnipile({
          body: { action: 'get_parameters', account_id: accountId, type: 'LOCATION', keywords: name, service: 'RECRUITER' },
        });
        const items = Array.isArray(data?.items) ? (data.items as any[]) : [];
        const normalized = name.toLowerCase();
        const best =
          items.find((it: any) => String(it.title || '').toLowerCase() === normalized) ||
          items.find((it: any) => String(it.title || '').toLowerCase().includes(normalized)) ||
          items[0];
        if (best?.id && best?.title) {
          setFilters(f => f.location.some(l => l.id === String(best.id)) ? f : ({
            ...f,
            location: [...f.location, { id: String(best.id), name: String(best.title), priority: 'MUST_HAVE' as const, scope: 'CURRENT_OR_OPEN_TO_RELOCATE' as const }],
          }));
        } else {
          toast.error(`Localisation « ${name} » introuvable sur LinkedIn`);
        }
      } catch {
        toast.error('Impossible de résoudre la localisation, réessayez.');
      } finally {
        setResolvingLocation(false);
      }
    } else {
      // Base Konekt : le nom suffit (mapping texte côté edge function)
      setFilters(f => ({
        ...f,
        location: [...f.location, { id: name, name, priority: 'MUST_HAVE' as const, scope: 'CURRENT_OR_OPEN_TO_RELOCATE' as const }],
      }));
    }
  }, [accountId, searchSource, setFilters]);

  /* ── Skills (skills[] à IDs + skills_keywords[] IA) ── */
  const addSkillKeyword = useCallback((v: string) => {
    setFilters(f => ({ ...f, skills_keywords: [...(f.skills_keywords || []), v] }));
  }, [setFilters]);

  /* ── Boîte (company[] + company_keywords[] + exclude_consulting) ── */
  const addCompanyKeyword = useCallback((v: string) => {
    setFilters(f => ({
      ...f,
      company_keywords: [...f.company_keywords, { keywords: v, priority: 'CAN_HAVE' as const, scope: 'CURRENT' as const }],
    }));
  }, [setFilters]);

  const toggleCompanyKeyword = useCallback((i: number) => {
    setFilters(f => ({
      ...f,
      company_keywords: f.company_keywords.map((c, k) => k === i
        ? { ...c, priority: c.priority === 'MUST_HAVE' ? 'CAN_HAVE' as const : c.priority === 'CAN_HAVE' ? 'MUST_HAVE' as const : c.priority }
        : c),
    }));
  }, [setFilters]);

  const hasAny =
    filters.role.length > 0 || filters.job_title.length > 0 || filters.location.length > 0 ||
    filters.skills.length > 0 || (filters.skills_keywords || []).length > 0 ||
    filters.company.length > 0 || filters.company_keywords.length > 0 ||
    filters.seniority.length > 0 || filters.exclude_consulting ||
    filters.calculated_experience_min !== null || filters.calculated_experience_max !== null;

  return (
    <div className="rounded-xl border border-[var(--k-hairline)] bg-[var(--k-surface-2)] p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--k-text-muted)]">
          Filtres · éditables
        </h3>
        {hasAny && onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-medium text-[var(--k-text-muted)] hover:text-[var(--k-text-2)] transition-colors"
          >
            Tout effacer
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5 stagger-in">
        <FacetRow icon={I.poste} label="Poste">
          {filters.role.map((r, i) => (
            <Chip
              key={`role-${i}-${r.keywords}`}
              label={r.keywords}
              must={r.priority === 'MUST_HAVE'}
              exclude={r.priority === 'DOESNT_HAVE'}
              onToggle={r.priority !== 'DOESNT_HAVE' ? () => toggleRole(i) : undefined}
              onRemove={() => setFilters(f => ({ ...f, role: f.role.filter((_, k) => k !== i) }))}
            />
          ))}
          {filters.job_title.map(j => (
            <Chip
              key={`jt-${j.id}`}
              label={j.name}
              must={j.priority === 'MUST_HAVE'}
              onRemove={() => setFilters(f => ({ ...f, job_title: f.job_title.filter(x => x.id !== j.id) }))}
            />
          ))}
          <AddChip placeholder="Ex. Account Manager" onAdd={addRole} />
        </FacetRow>

        <FacetRow icon={I.lieu} label="Lieu">
          {filters.location.map(l => (
            <Chip
              key={`loc-${l.id}`}
              label={l.name}
              onRemove={() => setFilters(f => ({ ...f, location: f.location.filter(x => x.id !== l.id) }))}
            />
          ))}
          <AddChip placeholder="Ex. Île-de-France" onAdd={addLocation} busy={resolvingLocation} />
        </FacetRow>

        <FacetRow icon={I.exp} label="Exp.">
          <ExpRange
            min={filters.calculated_experience_min}
            max={filters.calculated_experience_max}
            onChange={(min, max) => setFilters(f => ({
              ...f,
              calculated_experience_min: min,
              calculated_experience_max: max,
              years_of_experience_min: min,
              years_of_experience_max: max,
            }))}
          />
        </FacetRow>

        <FacetRow icon={I.skills} label="Skills">
          {filters.skills.map(s => (
            <Chip
              key={`sk-${s.id}`}
              label={s.name}
              must={s.priority === 'MUST_HAVE'}
              onRemove={() => setFilters(f => ({ ...f, skills: f.skills.filter(x => x.id !== s.id) }))}
            />
          ))}
          {(filters.skills_keywords || []).map((s, i) => (
            <Chip
              key={`skw-${i}-${s}`}
              label={s}
              onRemove={() => setFilters(f => ({ ...f, skills_keywords: (f.skills_keywords || []).filter((_, k) => k !== i) }))}
            />
          ))}
          <AddChip placeholder="Ex. Grands comptes" onAdd={addSkillKeyword} />
        </FacetRow>

        <FacetRow icon={I.boite} label="Boîte">
          {filters.exclude_consulting && (
            <Chip
              label="ESN / Conseil"
              exclude
              onRemove={() => setFilters(f => ({ ...f, exclude_consulting: false }))}
            />
          )}
          {filters.company.map(c => (
            <Chip
              key={`co-${c.id}`}
              label={c.name}
              onRemove={() => setFilters(f => ({ ...f, company: f.company.filter(x => x.id !== c.id) }))}
            />
          ))}
          {filters.company_keywords.map((c, i) => (
            <Chip
              key={`cok-${i}-${c.keywords}`}
              label={c.keywords}
              must={c.priority === 'MUST_HAVE'}
              exclude={c.priority === 'DOESNT_HAVE'}
              onToggle={c.priority !== 'DOESNT_HAVE' ? () => toggleCompanyKeyword(i) : undefined}
              onRemove={() => setFilters(f => ({ ...f, company_keywords: f.company_keywords.filter((_, k) => k !== i) }))}
            />
          ))}
          <AddChip placeholder="Ex. éditeur SaaS" onAdd={addCompanyKeyword} />
        </FacetRow>

        {filters.seniority.length > 0 && (
          <FacetRow icon={I.senior} label="Niveau">
            {filters.seniority.map(s => (
              <Chip
                key={`sen-${s}`}
                label={SENIORITY_LEVELS.find(sl => sl.value === s)?.label || s}
                onRemove={() => setFilters(f => ({ ...f, seniority: f.seniority.filter(x => x !== s) }))}
              />
            ))}
          </FacetRow>
        )}
      </div>

      <div className="flex gap-4 mt-3 pt-2.5 border-t border-[var(--k-hairline)] text-[11px] text-[var(--k-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-[5px] h-[5px] rounded-full bg-[var(--k-accent)]" /> Obligatoire
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full border border-[var(--k-hairline)]" /> Souhaité — clic sur une puce pour basculer
        </span>
      </div>
    </div>
  );
};
