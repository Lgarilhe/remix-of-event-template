import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        // Statuts, à la Qonto (docs/design/01-direction.md, § 2) : fond teinté, texte à l'encre et
        // pastille de 6 px de la couleur du statut. Une icône posée dans le badge prend cette
        // couleur et remplace la pastille. La couleur ne porte jamais le texte.
        destructive:
          "gap-1.5 border-transparent bg-danger-muted text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-danger before:content-[''] has-[>svg]:before:hidden [&>svg]:text-danger",
        danger:
          "gap-1.5 border-transparent bg-danger-muted text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-danger before:content-[''] has-[>svg]:before:hidden [&>svg]:text-danger",
        outline: "text-foreground border-border",
        success:
          "gap-1.5 border-transparent bg-success-muted text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-success before:content-[''] has-[>svg]:before:hidden [&>svg]:text-success",
        warning:
          "gap-1.5 border-transparent bg-warning-muted text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-warning before:content-[''] has-[>svg]:before:hidden [&>svg]:text-warning",
        info: "gap-1.5 border-transparent bg-info-muted text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-info before:content-[''] has-[>svg]:before:hidden [&>svg]:text-info",
        brand:
          "gap-1.5 border-transparent bg-brand/15 text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-brand before:content-[''] has-[>svg]:before:hidden [&>svg]:text-brand",
        // Neutre : encre sur le gris, sans pastille.
        muted: "border-transparent bg-muted text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
