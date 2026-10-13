/**
 * Pièces communes des étapes de l'assistant de connexion directe : cadre d'une
 * étape (titre qui prend le focus, description, pied de page), champ avec aide
 * et erreur, champ de mot de passe non contrôlé, ligne d'erreur, ligne
 * d'attente, tuile de choix et bloc d'information.
 *
 * Règles (docs/design/01-direction.md, § 5, § 6 et § 8) : une seule action
 * principale par étape, champs de 16 px sur téléphone (pas de zoom), cibles de
 * 44 px, erreurs annoncées (`role="alert"`), attente annoncée (`role="status"`).
 * Aucun identifiant n'est gardé ici : le mot de passe vit dans le champ du
 * navigateur et dans nulle autre variable.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { FLOW, NATIVE } from '@/lib/connectionCopy';

// ---------------------------------------------------------------------------
// Cadre d'une étape
// ---------------------------------------------------------------------------

interface StepFrameProps {
  /** Petite ligne au-dessus du titre (« Vérification demandée par LinkedIn »). */
  eyebrow?: string;
  heading: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Le titre prend le focus à l'arrivée : étapes sans champ à remplir. */
  focusHeading?: boolean;
}

/**
 * Une étape : titre (titre de la fenêtre pour les lecteurs d'écran), phrase
 * d'aide, contenu, pied de page. L'étape est remontée à chaque changement
 * d'écran (clé posée par l'assistant), donc le focus se pose une fois.
 */
export function StepFrame({ eyebrow, heading, description, children, footer, focusHeading = false }: StepFrameProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus({ preventScroll: true });
  }, [focusHeading]);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 pr-8">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <DialogTitle ref={headingRef} tabIndex={-1} className="text-md font-semibold leading-snug focus-visible:outline-none">
          {heading}
        </DialogTitle>
        {description ? (
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{heading}</DialogDescription>
        )}
      </div>
      {children}
      {footer && <StepFooter>{footer}</StepFooter>}
    </div>
  );
}

/** Pied de page : sur téléphone les boutons passent l'un sous l'autre, l'action principale en premier. */
export function StepFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end', className)}>{children}</div>;
}

/** Bouton d'un pied de page : 44 px de haut sur téléphone. */
export function FooterButton({ className, ...props }: ButtonProps) {
  return <Button className={cn('max-md:h-11 max-sm:w-full', className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Erreur d'une étape : une phrase de Konekt, annoncée aux lecteurs d'écran. */
export function FormError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

/** Ligne d'attente : une roue et une phrase, annoncées une fois. */
export function WaitLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 text-sm text-muted-foreground', className)}>
      <Spinner size="sm" label={typeof children === 'string' ? children : FLOW.working} />
      <span aria-hidden="true">{children}</span>
    </div>
  );
}

/** Bloc d'information dans une étape : zone grise, jamais une carte dans la fenêtre. */
export function InfoBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg bg-muted p-3 text-sm text-foreground-secondary', className)}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------

interface FieldProps extends Omit<ComponentProps<typeof Input>, 'id' | 'error'> {
  label: string;
  help?: string;
  error?: string | null;
  /** Identifiant du champ ; calculé si absent. */
  id?: string;
  /** Contenu à droite du champ (bouton « Afficher »). */
  trailing?: ReactNode;
}

/** Champ avec libellé, aide et erreur reliés par `aria-describedby`. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, help, error, id, trailing, className, ...props },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? `connexion-${auto}`;
  const helpId = help ? `${fieldId}-aide` : undefined;
  const errorId = error ? `${fieldId}-erreur` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <div className="relative">
        <Input
          ref={ref}
          id={fieldId}
          error={!!error}
          aria-describedby={describedBy}
          className={cn('max-md:h-11', trailing && 'pr-11', className)}
          {...props}
        />
        {trailing}
      </div>
      {help && <p id={helpId} className="text-xs text-muted-foreground">{help}</p>}
      {error && <FormError id={errorId}>{error}</FormError>}
    </div>
  );
});

/**
 * Mot de passe ou cookie : champ non contrôlé (la valeur reste dans le champ
 * du navigateur, jamais dans l'état de React) avec un bouton pour l'afficher.
 * L'étape lit la valeur par `takeSecret`, qui efface le champ dans le même geste.
 */
export const SecretField = forwardRef<HTMLInputElement, Omit<FieldProps, 'type' | 'trailing' | 'value' | 'defaultValue'>>(
  function SecretField({ label, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Field
        ref={ref}
        label={label}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        trailing={(
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? NATIVE.hidePassword : NATIVE.showPassword}
            className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10 max-md:w-10"
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        {...props}
      />
    );
  },
);

/** Valeur d'un champ puis effacement du champ : le secret ne reste nulle part après l'envoi. */
export function takeSecret(input: HTMLInputElement | null): string {
  if (!input) return '';
  const value = input.value;
  input.value = '';
  return value;
}

// ---------------------------------------------------------------------------
// Tuile de choix
// ---------------------------------------------------------------------------

interface ChoiceTileProps {
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  /** Mot à droite du titre (« Recommandé »). */
  badge?: string;
}

/** Tuile qui lance un choix : bouton discret au rayon de carte (docs/design/01-direction.md, § 6). */
export function ChoiceTile({ title, body, onClick, disabled, loading, icon, badge }: ChoiceTileProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      className="h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-xl border border-border px-4 py-3 text-left hover:border-foreground"
    >
      {icon && !loading && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {title}
          {badge && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground-secondary">{badge}</span>}
        </span>
        <span className="block text-xs font-normal text-muted-foreground">{body}</span>
      </span>
    </Button>
  );
}

/** Ligne d'un groupe de boutons radio ou de cases : toute la ligne se touche (44 px sur téléphone). */
export const OPTION_ROW =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-foreground has-[[data-state=checked]]:border-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';
