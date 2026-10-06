/**
 * Case « Je confirme les destinataires » (refonte mission, lot 5a, décisions
 * 4 et 7 du lot 5), montée dans le pied des fenêtres qui inscrivent dans une
 * séquence (préparation avec aperçu, inscription simple) ou programment des
 * InMails groupés.
 *
 * Dès 5 destinataires (le nombre du bouton) : le premier message en entier,
 * puis la case, obligatoire, avec son aide reliée par aria-describedby. La
 * case se décoche dès que la liste change (état : useRecipientsConfirm).
 * Sous 5, rien n'est affiché.
 *
 * Lot 5a-2 : séquence à message rédigé par l'IA (`aiReview`), case « J'ai relu
 * les messages rédigés par l'IA » obligatoire quel que soit le nombre, et dès
 * 5 candidats une seule case pour les deux (sendConfirmation).
 */
import React, { useId } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { recipientsConfirmRequired, sendConfirmation } from '@/lib/contactRecipientsGuard';

export interface FirstMessagePreviewItem {
  key: string;
  /** Type d'étape : « Message LinkedIn », « InMail », « Invitation LinkedIn »… */
  label: string;
  /** Condition du chemin : « Si déjà en relation », « Sinon », « Version B selon le tirage »… */
  condition?: string | null;
  subject?: string | null;
  /** Texte entier, tel qu'il partira. */
  text: string;
  /** Message rédigé par l'IA pas encore généré pour ce candidat. */
  aiPending?: boolean;
  /** Génère l'aperçu de ce message rédigé par l'IA (génération existante). */
  onGenerate?: () => void;
  isGenerating?: boolean;
  /** Lot 5d-1 : message écrit en préparation (valeurs du serveur) : squelette, jamais un texte faux. */
  loading?: boolean;
  /** Lot 5d-1 : aucun aperçu pour ce candidat, la raison à la place du texte. */
  unavailable?: string | null;
  /** Relance la préparation de l'aperçu quand un nouvel essai peut aboutir. */
  onRetry?: () => void;
}

export interface FirstMessagePreview {
  candidateName: string;
  items: FirstMessagePreviewItem[];
  /** Séquence sans message : « Aucun message écrit. Première action : visite de profil. » */
  emptyLabel?: string | null;
  /** Coût annoncé de la génération, « 3 crédits ». */
  generateCost?: string;
}

/** Premier message d'un candidat, en entier, dans un bloc qui défile. */
export function FirstMessagePreviewBlock({
  preview,
  title,
  navigation,
  renderText,
}: {
  preview: FirstMessagePreview;
  /** Titre du bloc, « Premier message, pour Claire Dubois » par défaut. */
  title?: string;
  /** ‹ › pour passer d'un candidat à l'autre. */
  navigation?: { index: number; total: number; onPrevious: () => void; onNext: () => void };
  renderText?: (text: string) => React.ReactNode;
}) {
  const heading = title ?? `Premier message, pour ${preview.candidateName}`;
  return (
    <section aria-label={heading} className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold text-foreground">{heading}</p>
        {navigation && navigation.total > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Candidat précédent"
              onClick={navigation.onPrevious}
              disabled={navigation.index === 0}
              className="max-md:h-11 max-md:w-11"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="text-2xs tabular-nums text-muted-foreground">
              {navigation.index + 1} sur {navigation.total}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Candidat suivant"
              onClick={navigation.onNext}
              disabled={navigation.index >= navigation.total - 1}
              className="max-md:h-11 max-md:w-11"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      {navigation && navigation.total > 1 && (
        <p className="text-2xs text-muted-foreground">{preview.candidateName}</p>
      )}
      <div className="max-h-40 space-y-2 overflow-y-auto">
        {preview.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{preview.emptyLabel ?? 'Aucun message écrit.'}</p>
        ) : (
          preview.items.map((item) => (
            <div key={item.key} className="space-y-1">
              <p className="text-2xs font-medium text-muted-foreground">
                {item.condition ? `${item.condition} · ${item.label}` : item.label}
              </p>
              {item.loading ? (
                <div className="space-y-1.5" role="status">
                  <span className="sr-only">Préparation de l'aperçu en cours</span>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ) : item.unavailable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">{item.unavailable}</p>
                  {item.onRetry && (
                    <Button type="button" variant="outline" size="xs" onClick={item.onRetry} className="max-md:h-11">
                      <RefreshCw aria-hidden="true" />
                      Réessayer
                    </Button>
                  )}
                </div>
              ) : item.aiPending ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire.
                  </p>
                  {item.onGenerate && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={item.onGenerate}
                      loading={item.isGenerating}
                      className="max-md:h-11"
                    >
                      Générer l'aperçu
                    </Button>
                  )}
                  {item.onGenerate && preview.generateCost && (
                    <span className="text-2xs tabular-nums text-muted-foreground">{preview.generateCost}</span>
                  )}
                </div>
              ) : (
                <>
                  {item.subject && (
                    <p className="text-xs text-foreground">
                      <span className="font-medium">Objet : </span>
                      {item.subject}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                    {item.text
                      ? (renderText ? renderText(item.text) : item.text)
                      : <span className="text-muted-foreground">Sans texte.</span>}
                  </p>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Premier message puis case obligatoire, dès 5 destinataires. `count` est le
 * nombre affiché sur le bouton d'envoi. Avec `aiReview` (lot 5a-2), la case
 * de relecture est montrée quel que soit le nombre ; le premier message
 * reste réservé au seuil de 5.
 */
export function RecipientsConfirm({
  count,
  confirmed,
  onConfirmedChange,
  preview,
  renderText,
  aiReview = false,
  disabled = false,
}: {
  count: number;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  /** Premier message montré au-dessus de la case ; omis quand il est déjà affiché juste au-dessus. */
  preview?: FirstMessagePreview | null;
  renderText?: (text: string) => React.ReactNode;
  /** La séquence a une étape à message rédigée par l'IA : la case vaut relecture. */
  aiReview?: boolean;
  /** Case grisée tant qu'un message IA reste à générer. */
  disabled?: boolean;
}) {
  const checkboxId = useId();
  const helpId = useId();
  const { required, label, help } = sendConfirmation(count, aiReview);
  if (!required) return null;
  return (
    <div className="space-y-2">
      {preview && recipientsConfirmRequired(count) && <FirstMessagePreviewBlock preview={preview} renderText={renderText} />}
      <div className="flex items-start gap-2">
        <Checkbox
          id={checkboxId}
          checked={confirmed}
          onCheckedChange={(checked) => onConfirmedChange(checked === true)}
          aria-describedby={helpId}
          disabled={disabled}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor={checkboxId} className={cn('text-sm font-medium text-foreground max-md:py-3', disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer')}>
            {label}
          </Label>
          <p id={helpId} className="text-xs text-muted-foreground">{help}</p>
        </div>
      </div>
    </div>
  );
}
