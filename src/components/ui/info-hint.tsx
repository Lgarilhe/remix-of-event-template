import * as React from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * InfoHint : bouton « i » qui ouvre une explication courte (définition d'une
 * mesure, précision sur un réglage). Il s'ouvre au clic, au doigt et au
 * clavier ; une infobulle au survol ne s'ouvre pas au doigt. Échap ou un clic
 * ailleurs le referme. 44 px de cible sur téléphone.
 *
 * Usage :
 *   <InfoHint label="Définition : Taux de réussite">Part des candidats gagnés…</InfoHint>
 */
interface InfoHintProps {
  /** Nom du bouton, lu par les lecteurs d'écran (« Définition : Taux de réussite »). */
  label: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function InfoHint({ label, children, side = "top", className }: InfoHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className={cn(
            "h-6 w-6 rounded-md text-muted-foreground hover:text-foreground data-[state=open]:text-foreground [&_svg]:size-3.5 max-md:h-11 max-md:w-11",
            className,
          )}
        >
          <Info aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-64 p-3 text-xs leading-relaxed text-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}
