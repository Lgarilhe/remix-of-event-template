// Onglet « Réglages » de la page d'une séquence (lot 5c-2) : « Conditions
// d'arrêt » (StopConditionsSettings), « Expéditeurs » (MultiSenderSettings),
// horaires d'envoi en lecture. Les changements s'enregistrent par le bouton
// « Enregistrer » de l'en-tête (seul bouton plein tant qu'ils ne le sont pas).
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StopConditionsSettings } from '@/components/outreach/sequence/StopConditionsSettings';
import { MultiSenderSettings } from '@/components/outreach/sequence/MultiSenderSettings';
import type { SenderAccountConfig, StopConditions } from '@/types/sequence';
import type { SendingHours } from './RhythmLine';

export interface SequenceSettingsDraft {
  stopConditions: StopConditions;
  multiSenderEnabled: boolean;
  senderAccounts: SenderAccountConfig[];
  rotationMode: string;
}

interface SettingsTabProps {
  value: SequenceSettingsDraft;
  onChange: (next: SequenceSettingsDraft) => void;
  canEdit: boolean;
  readOnlyHint: string;
  missionLabel: string | null;
  hours: SendingHours | null;
  /** Erreurs de la dernière tentative d'enregistrement. */
  errors: string[];
}

export function SettingsTab({ value, onChange, canEdit, readOnlyHint, missionLabel, hours, errors }: SettingsTabProps) {
  return (
    <div className="max-w-3xl space-y-8">
      {!canEdit && <p className="text-sm text-muted-foreground">{readOnlyHint}</p>}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-danger">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      {missionLabel && (
        <p className="text-sm text-foreground-secondary">
          <span className="text-muted-foreground">Mission : </span>
          {missionLabel}
        </p>
      )}

      <fieldset disabled={!canEdit} className="space-y-8 disabled:opacity-80">
        <StopConditionsSettings value={value.stopConditions} onChange={(stopConditions) => onChange({ ...value, stopConditions })} />

        <section aria-labelledby="reglages-expediteurs" className="space-y-3 border-t border-border pt-6">
          <h2 id="reglages-expediteurs" className="eyebrow">Expéditeurs</h2>
          <p className="text-sm text-foreground-secondary">Chaque candidat est contacté depuis le compte LinkedIn de la personne qui l’inscrit.</p>
          <MultiSenderSettings
            enabled={value.multiSenderEnabled}
            onEnabledChange={(multiSenderEnabled) => onChange({ ...value, multiSenderEnabled })}
            senderAccounts={value.senderAccounts}
            onSenderAccountsChange={(senderAccounts) => onChange({ ...value, senderAccounts })}
            rotationMode={value.rotationMode}
            onRotationModeChange={(rotationMode) => onChange({ ...value, rotationMode })}
          />
        </section>
      </fieldset>

      <section aria-labelledby="reglages-horaires" className="space-y-3 border-t border-border pt-6">
        <h2 id="reglages-horaires" className="eyebrow">Horaires et plafonds</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground-secondary">
            {hours
              ? `Du lundi au vendredi, de ${hours.start} h à ${hours.end} h : horaires de votre compte LinkedIn.`
              : 'Les envois partent pendant les horaires de votre compte LinkedIn, du lundi au vendredi.'}
          </p>
          <Button asChild variant="outline" size="sm" className="max-md:h-11">
            <Link to="/settings/account/connections">Modifier mes horaires</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
