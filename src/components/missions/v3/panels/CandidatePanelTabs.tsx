// Refonte mission, lot 2 : les quatre onglets de la fiche candidat (conception
// 4.4) : Aperçu, Échanges, Évaluations, Profil. Onglets accessibles au clavier
// (flèches gauche et droite, Début, Fin). Seul l'onglet ouvert est monté : les
// onglets existants lisent leurs données à l'affichage.
import { useId, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import type { CandidatePanelTab } from '../types';

export type CandidatePanelTabKey = CandidatePanelTab['key'];

export interface CandidatePanelTabsProps {
  tabs: readonly CandidatePanelTab[];
  active: CandidatePanelTabKey;
  onChange: (key: CandidatePanelTabKey) => void;
}

export function CandidatePanelTabs({ tabs, active, onChange }: CandidatePanelTabsProps) {
  const baseId = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.key);
    buttons.current[tab.key]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let handled = true;
    if (event.key === 'ArrowRight') focusTab(index + 1);
    else if (event.key === 'ArrowLeft') focusTab(index - 1);
    else if (event.key === 'Home') focusTab(0);
    else if (event.key === 'End') focusTab(tabs.length - 1);
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  if (!current) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Fiche du candidat"
        className="flex shrink-0 gap-1 overflow-x-auto border-y border-border bg-background px-3 sm:px-4"
      >
        {tabs.map((tab, index) => {
          const selected = tab.key === current.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                buttons.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'relative h-10 shrink-0 whitespace-nowrap px-2.5 text-sm transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors duration-150',
                  selected ? 'bg-brand' : 'bg-transparent',
                )}
              />
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${current.key}`}
        aria-labelledby={`${baseId}-tab-${current.key}`}
        tabIndex={0}
        className="min-w-0 flex-1 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
      >
        {current.content}
      </div>
    </div>
  );
}
