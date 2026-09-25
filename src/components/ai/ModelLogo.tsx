import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModelLogoProps {
  /** Identifiant technique du modèle ; conservé pour les appelants, sans effet visuel. */
  modelId: string;
  className?: string;
  size?: number;
}

/**
 * Icône générique du sélecteur de modèles, décorative : le nom du modèle
 * (« Rapide », « Avancé »…) est écrit à côté. Pas d'étincelle pour dire
 * « IA » (revue design E-47), aucun logo ni nom de fournisseur (CLAUDE.md,
 * Branding).
 */
export const ModelLogo = ({ className, size = 16 }: ModelLogoProps) => (
  <Gauge width={size} height={size} className={cn('shrink-0 text-muted-foreground', className)} aria-hidden="true" />
);
