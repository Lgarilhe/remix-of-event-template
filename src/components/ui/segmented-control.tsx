import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SegmentedControl — choix exclusif entre deux à quatre options visibles
 * (« Mes tâches / Équipe », « Semaine / Jour / Liste »). Chaque option est un
 * bouton qui annonce son état (aria-pressed), dans un groupe nommé.
 * Hauteur 32 px (sm) ou 36 px, comme les autres contrôles ; sur téléphone,
 * chaque option fait 44 px de haut (01-direction.md, § 5).
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Icône lucide, rendue avant le libellé. */
  icon?: React.ElementType;
  /** Infobulle native (raccourci clavier…). */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Nom du groupe, lu par les lecteurs d'écran. */
  "aria-label": string;
  size?: "sm" | "default";
  /**
   * « quiet » (design simplifié) : sans ombre ni filet, l'option choisie en gras
   * sur fond clair, comme la bascule d'affichage de la page mission. Par défaut,
   * le rendu d'avant.
   */
  variant?: "default" | "quiet";
  /** Sur téléphone, les icônes seules en carrés de 44 px ; le libellé reste lu. */
  iconsOnlyOnPhone?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "sm",
  variant = "default",
  iconsOnlyOnPhone = false,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const quiet = variant === "quiet";
  return (
    <div
      role="group"
      aria-label={props["aria-label"]}
      className={cn(
        quiet
          ? "inline-flex shrink-0 items-center rounded-lg bg-muted/60 p-0.5"
          : "inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5",
        !quiet && (size === "sm" ? "h-8" : "h-9"),
        "max-md:h-auto",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onValueChange(option.value)}
            className={cn(
              quiet
                ? "inline-flex h-8 items-center justify-center gap-1.5 max-md:h-11 whitespace-nowrap rounded-md px-3 text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0"
                : "inline-flex h-full items-center justify-center gap-1.5 max-md:h-11 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0",
              active
                ? quiet
                  ? "bg-background font-semibold text-foreground"
                  : "bg-background text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
              iconsOnlyOnPhone && Icon && "max-sm:min-w-11 max-sm:px-0",
            )}
          >
            {Icon && <Icon aria-hidden="true" />}
            <span className={iconsOnlyOnPhone && Icon ? "max-sm:sr-only" : undefined}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
