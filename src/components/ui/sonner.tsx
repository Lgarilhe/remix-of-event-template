import { Toaster as Sonner, toast } from "sonner";
import { useAppTheme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // Suit le thème de l'application (et non celui du système d'exploitation).
  const theme = useAppTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Un dialogue modal coupe les clics hors de lui (pointer-events: none sur
      // <body>) : sans cette ligne, l'action d'un toast est inatteignable.
      style={{ pointerEvents: "auto" }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-xl group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-xl group-[.toaster]:font-sans",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:rounded-lg group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:rounded-lg group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
