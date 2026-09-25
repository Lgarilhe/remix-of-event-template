import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-7 w-7",
} as const;

interface SpinnerProps {
  /** Texte lu par les lecteurs d'écran. */
  label?: string;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * Indicateur de chargement unique, pour une action ponctuelle ou une page qui
 * arrive (docs/design/01-direction.md, § 8). Une liste ou un tableau prend un
 * squelette (Skeleton), jamais les deux. Avec le mouvement réduit, l'icône
 * reste visible et cesse de tourner (règle globale de src/index.css).
 */
export function Spinner({ label = "Chargement", size = "md", className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex items-center justify-center text-muted-foreground", className)}>
      <Loader2 className={cn("animate-spin", SIZES[size])} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
