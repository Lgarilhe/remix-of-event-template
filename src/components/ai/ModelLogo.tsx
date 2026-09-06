import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModelLogoProps {
  /** Identifiant technique du modèle ; conservé pour les appelants, sans effet visuel. */
  modelId: string;
  className?: string;
  size?: number;
}

/**
 * Icône générique « IA Konekt » du sélecteur de modèles.
 * Règle branding (CLAUDE.md) : aucun logo ni nom de fournisseur côté utilisateur,
 * quel que soit le modèle sous-jacent.
 */
export const ModelLogo = ({ className, size = 16 }: ModelLogoProps) => (
  <Sparkles
    width={size}
    height={size}
    className={cn('shrink-0 text-primary', className)}
    aria-label="IA Konekt"
  />
);

/** Petit badge neutre, même libellé pour tous les modèles. */
export const ProviderLabel = (_props: { modelId: string }) => (
  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IA Konekt</span>
);
