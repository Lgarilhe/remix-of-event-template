/**
 * CalendarFiltersBar — barre de filtres de l'agenda.
 *
 * - Périmètre (Mon agenda / Équipe) : mêmes mots et même contrôle que
 *   « Mes tâches / Équipe » sur la page Tâches (revue design A-45).
 * - Type, format, étape, animateur, mission : FilterPill (options cochables).
 * - Vues enregistrées : une combinaison de filtres nommée, rechargeable,
 *   supprimable après confirmation.
 */

import React, { useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Briefcase, CheckCircle2, Filter, Trash2, User as UserIcon, Video, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FilterOption, FilterPill } from '@/components/ui/filter-pill';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type {
  CalendarEvent,
  CalendarEventFormat,
  CalendarEventType,
} from '@/hooks/useCalendarEvents';

/** Preset typing déclaré ici pour éviter une circular dep avec le hook
 *  useCalendarFiltersPersistence (qui importe CalendarFilters d'ici). */
export interface CalendarFilterPreset {
  id: string;
  name: string;
  filters: CalendarFilters;
  createdAt: string;
}

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
  /** Vues enregistrées par l'utilisateur (combinaisons de filtres nommées) */
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

const FORMAT_OPTIONS: { value: CalendarEventFormat; label: string }[] = [
  { value: 'video', label: 'Visio' },
  { value: 'in_person', label: 'Présentiel' },
  { value: 'phone', label: 'Téléphone' },
];

// Mêmes libellés que la fenêtre « Programmer un entretien » et que les cartes.
const ROUND_OPTIONS = [
  { value: '1', label: '1er entretien' },
  { value: '2', label: '2e entretien' },
  { value: '3', label: '3e entretien' },
  { value: 'final', label: 'Entretien final' },
];

const toggle = <T,>(list: T[], value: T, on: boolean): T[] =>
  on ? [...list, value] : list.filter((v) => v !== value);

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
  const [presetToDelete, setPresetToDelete] = useState<CalendarFilterPreset | null>(null);

  // Animateurs vus dans la période
  const managers = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string }>();
    for (const e of allEvents) {
      const m = e.meta?.manager;
      if (m?.userId && !map.has(m.userId)) {
        map.set(m.userId, { userId: m.userId, displayName: m.displayName || 'Membre sans nom' });
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }, [allEvents]);

  // Missions vues dans la période
  const projects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; client: string | null }>();
    for (const e of allEvents) {
      const p = e.meta?.projectId;
      if (p && !map.has(p)) {
        map.set(p, { id: p, name: e.meta?.projectName || e.meta?.jobTitle || 'Mission', client: e.meta?.clientName ?? null });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allEvents]);

  // Le périmètre (Mon agenda / Équipe) ne compte pas : « Effacer » ne le touche pas.
  const filterCount =
    filters.types.length + filters.managerUserIds.length + filters.projectIds.length + filters.formats.length + filters.rounds.length;
  const canSavePreset = filterCount > 0 || filters.myEventsOnly;

  const savePreset = () => {
    if (!onSavePreset || !presetName.trim() || !canSavePreset) return;
    onSavePreset(presetName.trim());
    setPresetName('');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {currentUserId && (
        <SegmentedControl
          aria-label="Périmètre de l'agenda"
          value={filters.myEventsOnly ? 'mine' : 'team'}
          onValueChange={(v) => onFiltersChange({ ...filters, myEventsOnly: v === 'mine' })}
          options={[
            { value: 'mine', label: 'Mon agenda', title: 'Les événements que vous animez' },
            { value: 'team', label: 'Équipe', title: "Les événements de toute l'équipe" },
          ]}
        />
      )}

      <FilterPill label="Type" icon={Filter} count={filters.types.length}>
        {TYPE_OPTIONS.map((opt) => (
          <FilterOption
            key={opt.value}
            checked={filters.types.includes(opt.value)}
            onCheckedChange={(on) => onFiltersChange({ ...filters, types: toggle(filters.types, opt.value, on) })}
          >
            {opt.label}
          </FilterOption>
        ))}
      </FilterPill>

      <FilterPill label="Format" icon={Video} count={filters.formats.length}>
        {FORMAT_OPTIONS.map((opt) => (
          <FilterOption
            key={opt.value}
            checked={filters.formats.includes(opt.value)}
            onCheckedChange={(on) => onFiltersChange({ ...filters, formats: toggle(filters.formats, opt.value, on) })}
          >
            {opt.label}
          </FilterOption>
        ))}
      </FilterPill>

      <FilterPill label="Étape" icon={CheckCircle2} count={filters.rounds.length}>
        {ROUND_OPTIONS.map((opt) => (
          <FilterOption
            key={opt.value}
            checked={filters.rounds.includes(opt.value)}
            onCheckedChange={(on) => onFiltersChange({ ...filters, rounds: toggle(filters.rounds, opt.value, on) })}
          >
            {opt.label}
          </FilterOption>
        ))}
      </FilterPill>

      {managers.length > 1 && (
        <FilterPill label="Animé par" icon={UserIcon} count={filters.managerUserIds.length} contentClassName="max-h-72 overflow-y-auto">
          {managers.map((m) => (
            <FilterOption
              key={m.userId}
              checked={filters.managerUserIds.includes(m.userId)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, managerUserIds: toggle(filters.managerUserIds, m.userId, on) })}
            >
              {m.displayName}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {projects.length > 0 && (
        <FilterPill label="Mission" icon={Briefcase} count={filters.projectIds.length} contentClassName="max-h-72 overflow-y-auto">
          {projects.map((p) => (
            <FilterOption
              key={p.id}
              checked={filters.projectIds.includes(p.id)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, projectIds: toggle(filters.projectIds, p.id, on) })}
              description={p.client}
            >
              {p.name}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {onSavePreset && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Bookmark aria-hidden="true" />
              Vues{presets.length > 0 ? ` (${presets.length})` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3 p-3" align="end">
            <div className="space-y-1.5">
              <Label htmlFor="calendar-preset-name">Enregistrer ces filtres</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="calendar-preset-name"
                  placeholder="Mes entretiens de la semaine"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      savePreset();
                    }
                  }}
                  className="h-8"
                  aria-describedby={!canSavePreset ? 'calendar-preset-hint' : undefined}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="icon-sm"
                  onClick={savePreset}
                  disabled={!presetName.trim() || !canSavePreset}
                  aria-label="Enregistrer la vue"
                >
                  <BookmarkPlus aria-hidden="true" />
                </Button>
              </div>
              {!canSavePreset && (
                <p id="calendar-preset-hint" className="text-xs text-muted-foreground">
                  Choisissez au moins un filtre pour l'enregistrer.
                </p>
              )}
            </div>

            {presets.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5">Vues enregistrées</p>
                <ul className="space-y-0.5">
                  {presets.map((p) => (
                    <li key={p.id} className="flex items-center gap-1 rounded-md hover:bg-accent">
                      <button
                        type="button"
                        onClick={() => onLoadPreset?.(p.id)}
                        className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {p.name}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-danger"
                        onClick={() => setPresetToDelete(p)}
                        aria-label={`Supprimer la vue « ${p.name} »`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}

      {filterCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, myEventsOnly: filters.myEventsOnly })}
        >
          <X aria-hidden="true" />
          Effacer les filtres
        </Button>
      )}

      <AlertDialog open={!!presetToDelete} onOpenChange={(o) => !o && setPresetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la vue ?</AlertDialogTitle>
            <AlertDialogDescription>
              La vue « {presetToDelete?.name} » sera supprimée. Les événements ne sont pas touchés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (presetToDelete) onDeletePreset?.(presetToDelete.id);
                setPresetToDelete(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
