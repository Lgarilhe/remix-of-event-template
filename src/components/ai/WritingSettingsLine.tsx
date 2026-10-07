// Réglages d'une rédaction par l'IA (lot 5e-2) : une ligne de résumé
// (« Rédaction par l'IA : Standard, formel, naturel, accroche sur son parcours,
// court échange. Niveau Équilibré, environ 5 crédits par message. ») et
// « Modifier », qui ouvre « Réglages de cette rédaction » : les cinq réglages
// du style, le niveau avec le coût de chaque niveau permis, « Revenir à mon
// style ». Les changements valent pour cette rédaction seulement ; les
// réglages par défaut restent dans Paramètres › Rédaction.
//
// WritingSettingsEditor est le contenu seul, repris par « Demander à l'IA »
// (fenêtre ancrée sur son bouton).
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WritingStyleFields } from '@/components/ai/WritingStyleFields';
import { AiLevelPicker } from '@/components/ai/AiLevelPicker';
import { cn } from '@/lib/utils';
import {
  AGENDA_FALLBACK_SENTENCE,
  STYLE_ONLY_THIS_TIME,
  sameStyle,
  writingSettingsSentence,
  type AiLevel,
  type LevelChoice,
  type WritingSettings,
  type WritingStyle,
} from '@/lib/writingStyle';

export type WritingSettingsValue = WritingSettings;

interface EditorProps {
  value: WritingSettingsValue;
  onChange: (next: WritingSettingsValue) => void;
  /** Style par défaut de la personne : « Revenir à mon style » quand le style affiché en diffère. */
  defaultStyle: WritingStyle;
  choices: readonly LevelChoice[];
  maxLevel: AiLevel;
  /** La mission n'a pas de lien d'agenda : le choix « Lien d'agenda » annonce son repli. */
  agendaFallback?: boolean;
  disabled?: boolean;
  /** Après le coût de chaque niveau (« par retouche ») ; rien pour le coût d'un message. */
  levelCreditsSuffix?: string;
}

export function WritingSettingsEditor({ value, onChange, defaultStyle, choices, maxLevel, agendaFallback = false, disabled = false, levelCreditsSuffix }: EditorProps) {
  const uid = useId();
  return (
    <div className="space-y-4">
      <WritingStyleFields compact value={value.style} disabled={disabled} onChange={(style) => onChange({ ...value, style })} />
      {agendaFallback && value.style.cta === 'agenda' && <p className="text-xs text-foreground-secondary">{AGENDA_FALLBACK_SENTENCE}</p>}
      <div className="space-y-1.5">
        <p id={`${uid}-niveau`} className="text-sm font-medium text-foreground">Niveau de l’IA</p>
        <AiLevelPicker
          choices={choices}
          value={value.level}
          maxLevel={maxLevel}
          creditsSuffix={levelCreditsSuffix}
          disabled={disabled}
          onChange={(level) => onChange({ ...value, level })}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{STYLE_ONLY_THIS_TIME}</p>
        {!sameStyle(value.style, defaultStyle) && (
          <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={() => onChange({ ...value, style: { ...defaultStyle } })} className="max-md:h-11">
            Revenir à mon style
          </Button>
        )}
      </div>
    </div>
  );
}

interface LineProps extends EditorProps {
  /** Début de la ligne, avant les deux-points. */
  prefix?: string;
  /** Après le coût : « par message », « par proposition »… */
  creditsSuffix?: string;
  /** Phrase ajoutée sous la ligne (aperçus déjà générés…). */
  note?: ReactNode;
  className?: string;
}

/** Titre de la fenêtre des réglages, qui la nomme pour les lecteurs d'écran (aria-labelledby). */
export const WRITING_SETTINGS_TITLE = 'Réglages de cette rédaction';
/** Nom du bouton « Modifier » de la ligne, distinct des autres « Modifier » de la fenêtre. */
export const WRITING_SETTINGS_BUTTON_LABEL = 'Modifier les réglages de rédaction';

export function WritingSettingsLine({ prefix = 'Rédaction par l’IA', creditsSuffix = 'par message', note, className, ...editor }: LineProps) {
  const credits = editor.choices.find((c) => c.id === editor.value.level)?.credits ?? 0;
  const titleId = `${useId()}-reglages`;
  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-sm text-foreground-secondary">
        <span>{prefix} : {writingSettingsSentence(editor.value, credits, creditsSuffix)}</span>{' '}
        {/* Au doigt, « Modifier » passe sur sa ligne (44 px) sans étirer les lignes du résumé. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={editor.disabled}
              aria-label={WRITING_SETTINGS_BUTTON_LABEL}
              className="h-auto p-0 align-baseline underline underline-offset-2 max-md:flex max-md:min-h-11"
            >
              Modifier
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={8}
            aria-labelledby={titleId}
            className="max-h-[min(var(--radix-popover-content-available-height),40rem)] w-[min(calc(100vw-2rem),27rem)] overflow-y-auto"
          >
            <p id={titleId} className="mb-3 text-sm font-semibold text-foreground">{WRITING_SETTINGS_TITLE}</p>
            <WritingSettingsEditor {...editor} />
          </PopoverContent>
        </Popover>
      </p>
      {editor.agendaFallback && editor.value.style.cta === 'agenda' && <p className="text-xs text-muted-foreground">{AGENDA_FALLBACK_SENTENCE}</p>}
      {note}
    </div>
  );
}
