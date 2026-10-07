// Pastille de statut d'une séquence (lot 5c-2) : « Brouillon » (aucune
// inscription, jamais), « Active » ou « En pause ». Sans cadre ni point de
// couleur, comme le statut de l'en-tête de mission ; seule « En pause » prend
// la couleur d'attention (06-simplicite, règle 7). Un clic ouvre « Mettre en
// pause la séquence » ou « Réactiver la séquence » (gestes de la liste : pause
// immédiate avec « Annuler », réactivation derrière sa confirmation).
import { ChevronDown, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SequenceStatusKind = 'draft' | 'active' | 'paused';

const LABELS: Record<SequenceStatusKind, string> = {
  draft: 'Brouillon',
  active: 'Active',
  paused: 'En pause',
};

interface SequenceStatusPillProps {
  status: SequenceStatusKind;
  isActive: boolean;
  /** Interrupteur proposé (auteur ou membre qui gère la séquence). */
  canToggle: boolean;
  disabled?: boolean;
  /** Mise en pause réservée : l'élément reste visible et dit pourquoi au clic. */
  lockedHint?: string;
  onToggle: () => void;
}

export function SequenceStatusPill({ status, isActive, canToggle, disabled, lockedHint, onToggle }: SequenceStatusPillProps) {
  const label = LABELS[status];
  // Libellé à l'encre (le mot dit le statut) ; la pause garde sa couleur : elle demande d'agir.
  const tone = status === 'paused' ? 'text-warning' : 'text-foreground';
  if (!canToggle) {
    return <span className={cn('text-sm font-medium', tone)}>{label}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Statut de la séquence : ${label}`}
          className={cn('gap-1 px-2 font-medium max-md:h-11', tone)}
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onToggle} className="items-start gap-2 max-md:min-h-11" title={lockedHint}>
          {isActive ? <Pause className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Play className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="flex min-w-0 flex-col">
            {/* Brouillon jamais activé : « Activer », pas « Réactiver ». */}
            <span>{isActive ? 'Mettre en pause la séquence' : status === 'draft' ? 'Activer la séquence' : 'Réactiver la séquence'}</span>
            {lockedHint && <span className="max-w-[16rem] whitespace-normal text-xs text-muted-foreground">{lockedHint}</span>}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
