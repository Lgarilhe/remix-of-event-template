import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

/**
 * Ancienne API de toast (shadcn), conservée pour ses appelants : elle passe
 * désormais par sonner, seul système de toast monté dans l'application
 * (docs/design/01-direction.md, § 6). Le nouveau code importe `toast` de
 * `sonner` directement.
 */
type LegacyToast = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
  duration?: number;
};

function toast({ title, description, variant, duration }: LegacyToast) {
  const show = variant === "destructive" ? sonnerToast.error : sonnerToast;
  const id = show(title ?? description, { description: title ? description : undefined, duration });
  return { id: String(id), dismiss: () => sonnerToast.dismiss(id) };
}

function useToast() {
  return { toast, dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId) };
}

export { useToast, toast };
