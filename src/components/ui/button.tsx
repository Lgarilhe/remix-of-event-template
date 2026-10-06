import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Trois styles, comme Qonto (docs/design/01-direction.md, § 6) : primary, l'action de la
        // zone, aplat d'encre (une seule par zone) ; default, outline et secondary, une action qui
        // fait avancer, contour d'encre (blanc à 70 % en sombre) ; ghost et link, discrets à
        // l'encre. Un geste de retrait ajoute text-muted-foreground à l'appel. Désactivé : libellé
        // gris sans opacité ; en chargement (aria-busy), un aplat garde sa couleur.
        default:
          "border border-foreground bg-transparent text-foreground hover:bg-accent dark:border-foreground/70 disabled:border-border disabled:text-muted-foreground dark:disabled:border-border",
        primary:
          "bg-primary font-semibold text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground aria-busy:bg-primary aria-busy:text-primary-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground aria-busy:bg-destructive aria-busy:text-destructive-foreground",
        outline:
          "border border-foreground bg-transparent text-foreground hover:bg-accent dark:border-foreground/70 disabled:border-border disabled:text-muted-foreground dark:disabled:border-border",
        secondary:
          "border border-foreground bg-transparent text-foreground hover:bg-accent dark:border-foreground/70 disabled:border-border disabled:text-muted-foreground dark:disabled:border-border",
        ghost: "hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground",
        link: "text-foreground underline-offset-4 hover:underline disabled:text-muted-foreground",
      },
      size: {
        // Quatre hauteurs : xs 28, sm 32, défaut 36, lg 40 (docs/design/01-direction.md, § 5).
        default: "h-9 px-4",
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3",
        lg: "h-10 px-5",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
        "icon-xs": "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" />}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
