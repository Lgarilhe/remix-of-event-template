import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * FilterPill — filtre d'une barre de filtres : un bouton qui ouvre ses
 * options. Actif, il porte le nombre de valeurs choisies dans une pastille
 * d'accent (la sélection est un usage de l'accent, 01-direction.md, § 2). Sur
 * téléphone, le bouton et chaque option font 44 px de haut.
 *
 * Usage :
 *   <FilterPill label="Catégorie" icon={Filter} count={n}>
 *     <FilterOption checked={…} onCheckedChange={…}>Relance</FilterOption>
 *   </FilterPill>
 */
interface FilterPillProps {
  label: string;
  /** Nombre de valeurs choisies ; 0 = filtre inactif. */
  count: number;
  icon?: React.ElementType;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
}

export function FilterPill({ label, count, icon: Icon, children, align = "start", contentClassName }: FilterPillProps) {
  const active = count > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${label} : ${count} choisi${count > 1 ? "s" : ""}` : label}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 max-md:h-11 whitespace-nowrap rounded-lg border px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0",
            active ? "border-border-strong" : "border-border",
          )}
        >
          {Icon && <Icon className="text-muted-foreground" aria-hidden="true" />}
          {label}
          {active && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand/15 px-1 text-3xs font-semibold tabular-nums text-brand">
              {count}
            </span>
          )}
          <ChevronDown className="text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-60 p-1.5", contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface FilterOptionProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
  /** Ligne secondaire (client d'une mission…). */
  description?: React.ReactNode;
}

/** Une option cochable d'un FilterPill : toute la ligne est cliquable. */
export function FilterOption({ checked, onCheckedChange, children, description }: FilterOptionProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent max-md:min-h-11 max-md:py-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
