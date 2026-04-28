/**
 * TemplatesPicker — Popover qui s'ouvre quand l'user tape "/" dans le composer.
 *
 * Affiche la liste des templates filtrée par le texte tapé après "/".
 * Click ou Enter → insère le contenu du template + remplace le slash command.
 *
 * UX inspirée de Notion / Slack / Linear (slash commands).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useMessageTemplates, MessageTemplate } from '@/hooks/useMessageTemplates';
import { cn } from '@/lib/utils';
import { FileText, Plus, ArrowRight } from 'lucide-react';

export interface TemplatesPickerProps {
  /** Filtre tapé par l'user (sans le "/" initial). Ex: "intro" */
  query: string;
  /** Position absolute au-dessus du curseur (px depuis composer) */
  position?: { top: number; left: number };
  /** Appelé quand l'user choisit un template → insère le contenu */
  onSelect: (template: MessageTemplate) => void;
  /** Appelé pour fermer le picker */
  onClose: () => void;
  /** Appelé quand l'user veut créer un nouveau template */
  onCreateNew?: () => void;
}

export const TemplatesPicker: React.FC<TemplatesPickerProps> = ({
  query,
  onSelect,
  onClose,
  onCreateNew,
}) => {
  const { templates } = useMessageTemplates();
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter par nom OU shortcut (sans le "/")
  const lowerQuery = query.toLowerCase().trim();
  const filtered = templates.filter(t => {
    if (!lowerQuery) return true;
    return (
      t.name.toLowerCase().includes(lowerQuery) ||
      (t.shortcut && t.shortcut.toLowerCase().includes(lowerQuery)) ||
      (t.category && t.category.toLowerCase().includes(lowerQuery))
    );
  });

  // Reset l'index quand la liste change
  useEffect(() => {
    setActiveIndex(0);
  }, [lowerQuery]);

  // Keyboard navigation
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

  // Empty state : pas de templates du tout
  if (templates.length === 0) {
    return (
      <div
        ref={containerRef}
        className="absolute bottom-full left-4 mb-2 w-80 bg-popover border border-border rounded-lg shadow-lg z-50 p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Templates</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Créez vos premiers templates (intro, relance, présentation poste...)
          pour les insérer rapidement avec un slash command.
        </p>
        {onCreateNew && (
          <button
            type="button"
            onClick={onCreateNew}
            className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3 h-3" />
            <span>Créer mon premier template</span>
          </button>
        )}
      </div>
    );
  }

  // Empty state filtré
  if (filtered.length === 0) {
    return (
      <div
        ref={containerRef}
        className="absolute bottom-full left-4 mb-2 w-80 bg-popover border border-border rounded-lg shadow-lg z-50 p-3"
      >
        <p className="text-xs text-muted-foreground text-center">
          Aucun template trouvé pour "{query}"
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-4 mb-2 w-80 max-h-72 overflow-y-auto bg-popover border border-border rounded-lg shadow-lg z-50"
    >
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Templates {filtered.length > 0 && `(${filtered.length})`}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            ↑↓ pour naviguer · ↵ pour insérer
          </span>
        </div>
      </div>
      <ul className="py-1">
        {filtered.map((tpl, idx) => (
          <li key={tpl.id}>
            <button
              type="button"
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => onSelect(tpl)}
              className={cn(
                'w-full text-left px-3 py-2 transition-colors flex items-start gap-2',
                idx === activeIndex ? 'bg-accent' : 'hover:bg-muted/50',
              )}
            >
              {tpl.emoji && (
                <span className="text-base shrink-0 mt-0.5">{tpl.emoji}</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {tpl.name}
                  </span>
                  {tpl.shortcut && (
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                      {tpl.shortcut}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {tpl.content.slice(0, 80)}{tpl.content.length > 80 ? '…' : ''}
                </p>
              </div>
              {idx === activeIndex && (
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {onCreateNew && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={onCreateNew}
            className="w-full inline-flex items-center justify-center gap-1.5 h-7 px-2 text-[11px] text-muted-foreground hover:bg-muted/50 rounded-md transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Nouveau template</span>
          </button>
        </div>
      )}
    </div>
  );
};
