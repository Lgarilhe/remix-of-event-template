import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SaveStatus — état d'enregistrement d'un éditeur, en mots (03-lots.md,
 * « Composants partagés »). Quatre états : « Enregistré »,
 * « Enregistrement… », « Modifications non enregistrées », « Échec de
 * l'enregistrement ». Annoncé poliment aux lecteurs d'écran ; l'état ne passe
 * jamais par la seule couleur.
 */
export type SaveState = "saved" | "saving" | "unsaved" | "error";

const LABELS: Record<SaveState, string> = {
  saved: "Enregistré",
  saving: "Enregistrement…",
  unsaved: "Modifications non enregistrées",
  error: "Échec de l'enregistrement",
};

interface SaveStatusProps {
  state: SaveState;
  className?: string;
}

export function SaveStatus({ state, className }: SaveStatusProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs",
        state === "error" ? "text-danger" : "text-muted-foreground",
        className,
      )}
    >
      {state === "saved" && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {state === "unsaved" && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
      {state === "error" && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      {LABELS[state]}
    </span>
  );
}
