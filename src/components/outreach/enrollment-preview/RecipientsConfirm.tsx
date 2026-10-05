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
 */
import React, { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  RECIPIENTS_CONFIRM_HELP,
  RECIPIENTS_CONFIRM_LABEL,
  recipientsConfirmRequired,
} from '@/lib/contactRecipientsGuard';

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
              {item.aiPending ? (
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
 * nombre affiché sur le bouton d'envoi.
 */
export function RecipientsConfirm({
  count,
  confirmed,
  onConfirmedChange,
  preview,
  renderText,
}: {
  count: number;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  /** Premier message montré au-dessus de la case ; omis quand il est déjà affiché juste au-dessus. */
  preview?: FirstMessagePreview | null;
  renderText?: (text: string) => React.ReactNode;
}) {
  const checkboxId = useId();
  const helpId = useId();
  if (!recipientsConfirmRequired(count)) return null;
  return (
    <div className="space-y-2">
      {preview && <FirstMessagePreviewBlock preview={preview} renderText={renderText} />}
      <div className="flex items-start gap-2">
        <Checkbox
          id={checkboxId}
          checked={confirmed}
          onCheckedChange={(checked) => onConfirmedChange(checked === true)}
          aria-describedby={helpId}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor={checkboxId} className="cursor-pointer text-sm font-medium text-foreground max-md:py-3">
            {RECIPIENTS_CONFIRM_LABEL}
          </Label>
          <p id={helpId} className="text-xs text-muted-foreground">{RECIPIENTS_CONFIRM_HELP}</p>
        </div>
      </div>
    </div>
  );
}
