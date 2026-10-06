/**
 * TemplatesPicker — liste des modèles, ouverte quand on tape « / » dans le
 * composeur.
 *
 * Liste de suggestions accessible (même motif que CandidateAutocomplete) :
 * le focus reste dans le champ, qui annonce l'option active
 * (aria-activedescendant) ; flèches pour parcourir, Entrée pour insérer,
 * Échap pour fermer. Calque nommé (z-popover) au lieu de z-50 (revue design D-72).
 */

import React, { useEffect, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useMessageTemplates, MessageTemplate } from '@/hooks/useMessageTemplates';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TemplatesPickerProps {
  /** Filtre tapé après le « / » (sans lui). Ex. : « intro » */
  query: string;
  /** Identifiant de la liste, relié au champ par aria-controls. */
  listId: string;
  /** Appelé quand l'user choisit un template → insère le contenu */
  onSelect: (template: MessageTemplate) => void;
  /** Appelé pour fermer le picker */
  onClose: () => void;
  /** Appelé quand l'user veut créer un nouveau template */
  onCreateNew?: () => void;
  /** Option active, pour l'aria-activedescendant du champ (undefined : aucune). */
  onActiveOptionChange?: (optionId: string | undefined) => void;
}

const PANEL =
  'absolute bottom-full left-3 z-popover mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg';

export const TemplatesPicker: React.FC<TemplatesPickerProps> = ({
  query,
  listId,
  onSelect,
  onClose,
  onCreateNew,
  onActiveOptionChange,
}) => {
  const { templates } = useMessageTemplates();
  const [activeIndex, setActiveIndex] = useState(0);
  const optionId = (i: number) => `${listId}-option-${i}`;

  // Filtre sur le nom, le raccourci ou la catégorie
  const lowerQuery = query.toLowerCase().trim();
  const filtered = templates.filter(t => {
    if (!lowerQuery) return true;
    return (
      t.name.toLowerCase().includes(lowerQuery) ||
      (t.shortcut && t.shortcut.toLowerCase().includes(lowerQuery)) ||
      (t.category && t.category.toLowerCase().includes(lowerQuery))
    );
  });

  // Une nouvelle saisie repart de la première option
  useEffect(() => {
    setActiveIndex(0);
  }, [lowerQuery]);

  // Option active annoncée par le champ
  useEffect(() => {
    onActiveOptionChange?.(filtered.length > 0 ? optionId(Math.min(activeIndex, filtered.length - 1)) : undefined);
    return () => onActiveOptionChange?.(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, filtered.length, listId]);

  // Clavier : le focus reste dans le champ, la liste écoute en capture
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const tpl = filtered[activeIndex];
        if (tpl) onSelect(tpl);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [filtered, activeIndex, onSelect, onClose]);

  // Aucun modèle encore
  if (templates.length === 0) {
    return (
      <div className={cn(PANEL, 'p-4')} role="status">
        <div className="mb-2 flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">Aucun modèle pour l'instant</span>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Créez vos modèles (présentation, relance, description du poste) dans Paramètres › Rédaction, puis insérez-les
          en tapant « / ».
        </p>
        {onCreateNew && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="w-full"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCreateNew}
          >
            <Plus aria-hidden="true" />
            Créer un modèle
          </Button>
        )}
      </div>
    );
  }

  // Aucun modèle pour ce filtre
  if (filtered.length === 0) {
    return (
      <div className={cn(PANEL, 'p-3')} role="status">
        <p className="text-center text-xs text-muted-foreground">Aucun modèle ne correspond à « {query} »</p>
      </div>
    );
  }

  return (
    <div className={cn(PANEL, 'overflow-hidden')}>
      <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium text-muted-foreground">Modèles ({filtered.length})</span>
        <span className="ml-auto text-2xs text-muted-foreground">↑ ↓ pour parcourir · Entrée pour insérer</span>
      </div>
      <ul id={listId} role="listbox" aria-label="Modèles de message" className="max-h-60 overflow-y-auto p-1">
        {filtered.map((tpl, idx) => (
          <li
            key={tpl.id}
            id={optionId(idx)}
            role="option"
            aria-selected={idx === activeIndex}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => setActiveIndex(idx)}
            onClick={() => onSelect(tpl)}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-150',
              idx === activeIndex && 'bg-accent',
            )}
          >
            {tpl.emoji && (
              <span className="mt-0.5 shrink-0 text-sm" aria-hidden="true">
                {tpl.emoji}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{tpl.name}</span>
                {tpl.shortcut && (
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
                    {tpl.shortcut}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {tpl.content.slice(0, 80)}{tpl.content.length > 80 ? '…' : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {onCreateNew && (
        <div className="border-t border-border p-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="w-full text-muted-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCreateNew}
          >
            <Plus aria-hidden="true" />
            Nouveau modèle
          </Button>
        </div>
      )}
    </div>
  );
};
