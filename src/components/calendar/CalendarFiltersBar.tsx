/**
 * CalendarFiltersBar — barre de filtres pills pour la page Calendar.
 *
 * Filtres disponibles :
 * - Type d'événement (entretien / inmail / séquence)
 * - Mes RDV (toggle : créés par l'utilisateur courant)
 * - Manager (multi-select parmi les managers vus dans la semaine)
 * - Mission (multi-select parmi les missions vues dans la semaine)
 * - Format (visio / présentiel / téléphone)
 * - Round (1er / 2e / final — uniquement pour les qualifs)
 *
 * Pattern Linear : pills clickables qui ouvrent un popover avec checkboxes.
 * Active filter count badge sur la pill, "Effacer" CTA quand filtres actifs.
 */

import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  User as UserIcon,
  Building2,
  Video,
  X,
  CheckCircle2,
  Filter,
  Bookmark,
  BookmarkPlus,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type {
  CalendarEvent,
  CalendarEventFormat,
  CalendarEventType,
} from '@/hooks/useCalendarEvents';
import type { CalendarFilterPreset } from '@/hooks/useCalendarFiltersPersistence';

export interface CalendarFilters {
  /** Types autorisés. Vide = tous. */
  types: CalendarEventType[];
  /** Si true, n'affiche que les events dont le manager = currentUserId */
  myEventsOnly: boolean;
  /** UserIds des managers à afficher. Vide = tous. */
  managerUserIds: string[];
  /** ProjectIds (mission) à afficher. Vide = toutes. */
  projectIds: string[];
  /** Formats autorisés. Vide = tous. */
  formats: CalendarEventFormat[];
  /** Rounds autorisés ('1' / '2' / '3' / 'final'). Vide = tous. */
  rounds: string[];
}

export const DEFAULT_FILTERS: CalendarFilters = {
  types: [],
  myEventsOnly: false,
  managerUserIds: [],
  projectIds: [],
  formats: [],
  rounds: [],
};

interface CalendarFiltersBarProps {
  filters: CalendarFilters;
  onFiltersChange: (filters: CalendarFilters) => void;
  /** Tous les events de la semaine — sert à dériver les options uniques (managers/missions) */
  allEvents: CalendarEvent[];
  currentUserId: string | null;
  /** Presets sauvegardés par l'user (filter combos nommés) */
  presets?: CalendarFilterPreset[];
  onSavePreset?: (name: string) => void;
  onLoadPreset?: (presetId: string) => void;
  onDeletePreset?: (presetId: string) => void;
}

const TYPE_OPTIONS: { value: CalendarEventType; label: string }[] = [
  { value: 'qualification', label: 'Entretiens' },
  { value: 'inmail', label: 'InMails' },
  { value: 'sequence_step', label: 'Séquences' },
];

const FORMAT_OPTIONS: { value: CalendarEventFormat; label: string; icon: React.ReactNode }[] = [
  { value: 'video', label: 'Visio', icon: <Video className="w-3.5 h-3.5" /> },
  { value: 'in_person', label: 'Présentiel', icon: <Building2 className="w-3.5 h-3.5" /> },
  { value: 'phone', label: 'Téléphone', icon: <Briefcase className="w-3.5 h-3.5" /> },
];

const ROUND_OPTIONS = [
  { value: '1', label: '1er entretien' },
  { value: '2', label: '2e entretien' },
  { value: '3', label: '3e entretien' },
  { value: 'final', label: 'Final' },
];

const FilterPill: React.FC<{
  label: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, count, icon, children }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors shrink-0 whitespace-nowrap',
          count > 0
            ? 'bg-foreground text-background border-foreground'
            : 'border-border bg-background hover:bg-accent text-foreground',
        )}
      >
        {icon}
        {label}
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-background text-foreground text-[10px] font-bold tabular-nums">
            {count}
          </span>
        )}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-56 p-3 rounded-xl border-border" align="start">
      {children}
    </PopoverContent>
  </Popover>
);

export const CalendarFiltersBar: React.FC<CalendarFiltersBarProps> = ({
  filters,
  onFiltersChange,
  allEvents,
  currentUserId,
  presets = [],
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
}) => {
  const [presetName, setPresetName] = useState('');
  // Dérive les managers uniques depuis les events de la semaine
  const managers = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string }>();
    for (const e of allEvents) {
      const m = e.meta?.manager;
      if (m?.userId && !map.has(m.userId)) {
        map.set(m.userId, {
          userId: m.userId,
          displayName: m.displayName || m.userId.slice(0, 8),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.displayName || '').localeCompare(b.displayName || ''),
    );
  }, [allEvents]);

  // Dérive les missions uniques
  const projects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; client: string | null }>();
    for (const e of allEvents) {
      const p = e.meta?.projectId;
      if (p && !map.has(p)) {
        map.set(p, {
          id: p,
          name: e.meta?.projectName || e.meta?.jobTitle || 'Mission',
          client: e.meta?.clientName ?? null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allEvents]);

  const activeCount =
    filters.types.length +
    (filters.myEventsOnly ? 1 : 0) +
    filters.managerUserIds.length +
    filters.projectIds.length +
    filters.formats.length +
    filters.rounds.length;

  const clearAll = () => onFiltersChange(DEFAULT_FILTERS);

  // Helpers toggle
  const toggleArrayValue = <T,>(arr: T[], value: T): T[] =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-wrap">
      {/* Mes RDV toggle */}
      {currentUserId && (
        <button
          onClick={() => onFiltersChange({ ...filters, myEventsOnly: !filters.myEventsOnly })}
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors shrink-0',
            filters.myEventsOnly
              ? 'bg-foreground text-background border-foreground'
              : 'border-border bg-background hover:bg-accent text-foreground',
          )}
        >
          <UserIcon className="w-3.5 h-3.5" />
          Mes RDV
        </button>
      )}

      {/* Type */}
      <FilterPill
        label="Type"
        count={filters.types.length}
        icon={<Filter className="w-3.5 h-3.5" />}
      >
        <div className="space-y-2">
          {TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={filters.types.includes(opt.value)}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    types: checked
                      ? [...filters.types, opt.value]
                      : filters.types.filter((t) => t !== opt.value),
                  })
                }
              />
              {opt.label}
            </label>
          ))}
        </div>
      </FilterPill>

      {/* Format */}
      <FilterPill
        label="Format"
        count={filters.formats.length}
        icon={<Video className="w-3.5 h-3.5" />}
      >
        <div className="space-y-2">
          {FORMAT_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <Checkbox
                checked={filters.formats.includes(opt.value)}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    formats: checked
                      ? [...filters.formats, opt.value]
                      : filters.formats.filter((f) => f !== opt.value),
                  })
                }
              />
              <span className="text-muted-foreground">{opt.icon}</span>
              {opt.label}
            </label>
          ))}
        </div>
      </FilterPill>

      {/* Round / Étape — pertinent surtout pour les entretiens */}
      <FilterPill
        label="Étape"
        count={filters.rounds.length}
        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
      >
        <div className="space-y-2">
          {ROUND_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={filters.rounds.includes(opt.value)}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    rounds: checked
                      ? [...filters.rounds, opt.value]
                      : filters.rounds.filter((r) => r !== opt.value),
                  })
                }
              />
              {opt.label}
            </label>
          ))}
        </div>
      </FilterPill>

      {/* Manager (uniquement si > 1 manager dans la semaine) */}
      {managers.length > 1 && (
        <FilterPill
          label="Manager"
          count={filters.managerUserIds.length}
          icon={<UserIcon className="w-3.5 h-3.5" />}
        >
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {managers.map((m) => (
              <label
                key={m.userId}
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <Checkbox
                  checked={filters.managerUserIds.includes(m.userId)}
                  onCheckedChange={(checked) =>
                    onFiltersChange({
                      ...filters,
                      managerUserIds: checked
                        ? [...filters.managerUserIds, m.userId]
                        : filters.managerUserIds.filter((u) => u !== m.userId),
                    })
                  }
                />
                <span className="truncate">{m.displayName}</span>
              </label>
            ))}
          </div>
        </FilterPill>
      )}

      {/* Mission */}
      {projects.length > 0 && (
        <FilterPill
          label="Mission"
          count={filters.projectIds.length}
          icon={<Briefcase className="w-3.5 h-3.5" />}
        >
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={filters.projectIds.includes(p.id)}
                  onCheckedChange={(checked) =>
                    onFiltersChange({
                      ...filters,
                      projectIds: checked
                        ? [...filters.projectIds, p.id]
                        : filters.projectIds.filter((i) => i !== p.id),
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name}</div>
                  {p.client && (
                    <div className="text-[10px] text-muted-foreground truncate">{p.client}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </FilterPill>
      )}

      {/* Presets dropdown — uniquement si onSavePreset fourni */}
      {onSavePreset && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium text-foreground transition-colors shrink-0',
                presets.length > 0 && 'gap-2',
              )}
              title="Filtres sauvegardés"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Vues</span>
              {presets.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold tabular-nums">
                  {presets.length}
                </span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3 rounded-xl border-border" align="end">
            <div className="space-y-3">
              {/* Save current as preset */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Sauvegarder cette vue
                </label>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <input
                    type="text"
                    placeholder="Ex: Mes entretiens semaine"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && presetName.trim() && activeCount > 0) {
                        onSavePreset(presetName.trim());
                        setPresetName('');
                      }
                    }}
                    className="flex-1 h-8 px-2.5 rounded-lg bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
                  />
                  <button
                    onClick={() => {
                      if (presetName.trim() && activeCount > 0) {
                        onSavePreset(presetName.trim());
                        setPresetName('');
                      }
                    }}
                    disabled={!presetName.trim() || activeCount === 0}
                    className="h-8 w-8 flex items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                    title={activeCount === 0 ? 'Active des filtres pour sauver' : 'Sauvegarder'}
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {activeCount === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Active au moins 1 filtre pour pouvoir le sauvegarder.
                  </p>
                )}
              </div>

              {/* Saved presets list */}
              {presets.length > 0 && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Vues sauvegardées
                  </label>
                  <div className="mt-1.5 space-y-1">
                    {presets.map((p) => (
                      <div
                        key={p.id}
                        className="group flex items-center gap-1 rounded-lg hover:bg-muted/40 transition-colors"
                      >
                        <button
                          onClick={() => onLoadPreset?.(p.id)}
                          className="flex-1 text-left px-2.5 py-1.5 text-xs font-medium text-foreground truncate"
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => onDeletePreset?.(p.id)}
                          className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-destructive/40 bg-destructive/5 hover:bg-destructive/10 text-destructive text-[11.5px] font-medium transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          Effacer ({activeCount})
        </button>
      )}
    </div>
  );
};

/**
 * Applique les filtres à une liste d'events. Utilisé par CalendarPage.
 */
export function applyCalendarFilters(
  events: CalendarEvent[],
  filters: CalendarFilters,
  currentUserId: string | null,
): CalendarEvent[] {
  return events.filter((e) => {
    // Type
    if (filters.types.length > 0 && !filters.types.includes(e.type)) return false;

    // Mes RDV
    if (filters.myEventsOnly) {
      if (!currentUserId || e.meta?.manager?.userId !== currentUserId) return false;
    }

    // Manager
    if (filters.managerUserIds.length > 0) {
      if (!e.meta?.manager?.userId || !filters.managerUserIds.includes(e.meta.manager.userId))
        return false;
    }

    // Mission
    if (filters.projectIds.length > 0) {
      if (!e.meta?.projectId || !filters.projectIds.includes(e.meta.projectId)) return false;
    }

    // Format
    if (filters.formats.length > 0) {
      const fmt = e.meta?.format || 'unknown';
      if (!filters.formats.includes(fmt)) return false;
    }

    // Round
    if (filters.rounds.length > 0) {
      const r = e.meta?.round;
      if (!r) return false;
      const value = r.kind === 'final' ? 'final' : String(r.n);
      if (!filters.rounds.includes(value)) return false;
    }

    return true;
  });
}
