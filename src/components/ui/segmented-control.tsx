import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SegmentedControl — choix exclusif entre deux à quatre options visibles
 * (« Mes tâches / Équipe », « Semaine / Jour / Liste »). Chaque option est un
 * bouton qui annonce son état (aria-pressed), dans un groupe nommé.
 * Hauteur 32 px (sm) ou 36 px, comme les autres contrôles (01-direction.md, § 5).
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
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "sm",
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={props["aria-label"]}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5",
        size === "sm" ? "h-8" : "h-9",
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
              "inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0",
              active
                ? "bg-background text-foreground shadow-sm ring-1 ring-border-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
