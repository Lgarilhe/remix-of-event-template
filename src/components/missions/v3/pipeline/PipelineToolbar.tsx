// Refonte mission, lot 2 : ligne d'outils du Pipeline (conception 4.2) : lien
// vers les profils jamais ouverts (au Sourcing), bascule Liste / Par étape,
// Bilan, Prise de contact. Design simplifié (04/10/2026) : aucun bouton encadré
// (un seul bouton plein par écran, celui de la carte « Maintenant »), Bilan et
// Prise de contact en boutons discrets ; sur téléphone, l'icône seule, le nom
// restant lisible par les lecteurs d'écran.
// Lot 5f-2b : pastille de Prise de contact (« 2 réponses », sinon « 1 bloqué »),
// jamais de zéro ; son texte complet est la description du bouton, dont le nom
// reste « Prise de contact ».

import { BarChart3, LayoutGrid, List, Send, UserSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ContactBadge } from '@/lib/contactedGroups';
import { cn } from '@/lib/utils';
import { unopenedLinkText, type PipelineViewMode } from '../types';

interface PipelineToolbarProps {
  /** Profils jamais ouverts ; null si les effectifs manquent. */
  unopened: number | null;
  onOpenSourcing: () => void;
  view: PipelineViewMode;
  onViewChange: (view: PipelineViewMode) => void;
  bilanOpen: boolean;
  onToggleBilan: () => void;
  onOpenContact: () => void;
  /** Pastille de Prise de contact ; null sans réponse ni candidat bloqué, ou interrupteur des séquences éteint. */
  contactBadge?: ContactBadge | null;
}

const CONTACT_BADGE_ID = 'pipeline-contact-badge';

const TOGGLE = [
  { value: 'liste' as const, label: 'Liste', icon: List },
  { value: 'etapes' as const, label: 'Par étape', icon: LayoutGrid },
];

export function PipelineToolbar({
  unopened,
  onOpenSourcing,
  view,
  onViewChange,
  bilanOpen,
  onToggleBilan,
  onOpenContact,
  contactBadge = null,
}: PipelineToolbarProps) {
  const unopenedText = unopenedLinkText(unopened);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unopenedText && (
        <button
          type="button"
          data-testid="unopened-link"
          onClick={onOpenSourcing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-1 text-sm text-brand underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserSearch className="h-4 w-4" aria-hidden="true" />
          {unopenedText}
        </button>
      )}
      <div className="ml-auto flex items-center gap-1">
        <div role="group" aria-label="Affichage" className="inline-flex items-center rounded-lg bg-muted p-0.5">
          {TOGGLE.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => onViewChange(value)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors duration-150 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === value ? 'bg-card font-semibold text-foreground dark:bg-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Bilan"
          aria-expanded={bilanOpen}
          onClick={onToggleBilan}
          className={cn('max-sm:min-h-11 max-sm:min-w-11 max-sm:px-0', bilanOpen && 'bg-muted')}
        >
          <BarChart3 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
          <span className="max-sm:hidden">Bilan</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Prise de contact"
          aria-describedby={contactBadge ? CONTACT_BADGE_ID : undefined}
          onClick={onOpenContact}
          className={cn('max-sm:min-h-11 max-sm:min-w-11 max-sm:px-0', contactBadge && 'max-sm:relative')}
        >
          <Send className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
          <span className="max-sm:hidden">Prise de contact</span>
          {contactBadge && (
            <>
              <span id={CONTACT_BADGE_ID} className="sr-only">{contactBadge.description}</span>
              <span
                aria-hidden="true"
                data-testid="contact-badge"
                className={cn(
                  'ml-1.5 text-xs font-medium tabular-nums max-sm:hidden',
                  contactBadge.tone === 'brand' ? 'text-brand' : 'text-warning',
                )}
              >
                {contactBadge.text}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute right-1.5 top-1.5 h-2 w-2 rounded-full sm:hidden',
                  contactBadge.tone === 'brand' ? 'bg-brand' : 'bg-warning',
                )}
              />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
