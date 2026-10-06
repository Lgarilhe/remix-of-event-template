import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Cartes à plat (design simplifié, docs/design/06-simplicite.md, règle 3) : sous
 * un CardPlainProvider, une carte perd son cadre, son fond, son rayon et ses
 * marges latérales, et ses blocs commencent au ras du texte ; deux cartes voisines
 * se séparent par un filet. Sans fournisseur, rendu inchangé. Les Paramètres
 * l'activent par rubrique (SettingsAnchor).
 */
const CardPlainContext = React.createContext(false);

const CardPlainProvider = ({ children }: { children: React.ReactNode }) => (
  <CardPlainContext.Provider value={true}>{children}</CardPlainContext.Provider>
);

// La carte se détache du fond par sa luminosité (sombre) ou son ombre légère (clair), et garde
// son filet. L'ombre marquée reste aux éléments qui flottent (menus, dialogues, toasts ;
// 01-direction.md, § 4). À plat, aucune ombre : la carte n'a plus de fond ni de cadre à relever.
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
  const plain = React.useContext(CardPlainContext);
  return (
    <div
      ref={ref}
      className={cn(
        // À plat, la carte ne reçoit ni rayon, ni cadre, ni fond.
        plain ? "text-card-foreground" : "rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
        // Une carte qui suit une autre dans son conteneur s'en sépare par un filet.
        plain && "border-0 bg-transparent px-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-6",
      )}
      {...props}
    />
  );
});
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const plain = React.useContext(CardPlainContext);
    return <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className, plain && "px-0 pt-0")} {...props} />;
  },
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-base font-semibold leading-snug", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const plain = React.useContext(CardPlainContext);
    return <div ref={ref} className={cn("p-6 pt-0", className, plain && "px-0 pb-0")} {...props} />;
  },
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const plain = React.useContext(CardPlainContext);
    return <div ref={ref} className={cn("flex items-center p-6 pt-0", className, plain && "px-0 pb-0")} {...props} />;
  },
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, CardPlainProvider };
