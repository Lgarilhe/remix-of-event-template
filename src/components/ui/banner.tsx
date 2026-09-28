import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type BannerTone = "neutral" | "info" | "warning" | "danger";

const TONES: Record<BannerTone, { box: string; icon: string }> = {
  neutral: { box: "border-border bg-muted/60", icon: "text-muted-foreground" },
  info: { box: "border-info/25 bg-info-muted", icon: "text-info" },
  warning: { box: "border-warning/25 bg-warning-muted", icon: "text-warning" },
  danger: { box: "border-danger/25 bg-danger-muted", icon: "text-danger" },
};

interface BannerProps {
  tone?: BannerTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  /** Action à droite du texte (lien ou bouton), voir bannerActionClass. */
  action?: React.ReactNode;
  /** Affiche un bouton de fermeture. */
  onDismiss?: () => void;
  dismissLabel?: string;
  role?: "status" | "alert";
  className?: string;
}

/** Style d'une action de bandeau (lien ou bouton texte). */
export const bannerActionClass =
  "inline-flex shrink-0 items-center gap-1 rounded-md font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Bandeau d'information pleine largeur, posé sous l'en-tête de l'application
 * (essai, crédits IA…). Le fond porte le ton, le texte reste lisible
 * (docs/design/01-direction.md, § 2).
 */
export function Banner({
  tone = "neutral",
  icon: Icon,
  children,
  action,
  onDismiss,
  dismissLabel = "Fermer le bandeau",
  role = "status",
  className,
}: BannerProps) {
  const t = TONES[tone];
  return (
    <div role={role} className={cn("flex items-center gap-3 border-b px-4 py-2 text-sm", t.box, className)}>
      {Icon && <Icon className={cn("h-4 w-4 shrink-0", t.icon)} aria-hidden="true" />}
      <p className="min-w-0 flex-1 text-foreground">{children}</p>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-9 max-md:w-9"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
