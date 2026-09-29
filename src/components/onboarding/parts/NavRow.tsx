import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  /** Action facultative, à gauche de « Continuer » (« Passer », « Plus tard »). */
  skipLabel?: string;
  onSkip?: () => void;
  className?: string;
}

/** Rangée d'actions d'une scène : retour à gauche, suite à droite, Entrée pour valider. */
export const NavRow: React.FC<Props> = ({ onBack, onNext, nextLabel = 'Continuer', nextDisabled, loading, skipLabel, onSkip, className }) => (
  <div className={cn('flex items-center gap-2 pt-2', onBack ? 'justify-between' : 'justify-end', className)}>
    {onBack && (
      <Button variant="ghost" onClick={onBack} className="min-h-11 md:min-h-0">
        <ArrowLeft aria-hidden="true" />
        Retour
      </Button>
    )}
    <div className="flex items-center gap-2">
      {skipLabel && onSkip && (
        <Button variant="ghost" onClick={onSkip} className="min-h-11 text-muted-foreground md:min-h-0">
          {skipLabel}
        </Button>
      )}
      <Button variant="primary" size="lg" onClick={onNext} disabled={nextDisabled} loading={loading} className="min-h-11 md:min-h-0">
        {nextLabel}
        {!loading && <ArrowRight aria-hidden="true" />}
      </Button>
    </div>
  </div>
);
