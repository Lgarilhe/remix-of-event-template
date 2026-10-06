import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// text-title (28 px, tailwind.config.ts) est une taille de texte : sans cette
// déclaration, twMerge la prendrait pour une couleur et retirerait text-foreground.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["title"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
