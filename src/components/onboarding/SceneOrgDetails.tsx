import React, { useId, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type OrgType = 'enterprise' | 'agency' | 'freelance';

/**
 * Réponses de la scène, toutes enregistrées sur l'organisation (team_size,
 * freelance_mode, annual_hires). La fourchette de TJM n'était écrite nulle
 * part : elle n'est plus demandée (B-64).
 */
export interface OrgDetailsData {
  teamSize: string;
  freelanceMode?: string;
  annualHires?: string;
}

interface Props {
  orgType: OrgType;
  onSubmit: (data: OrgDetailsData) => void;
  onBack: () => void;
}

const TEAM_SIZES = [
  { value: '1', label: 'Juste moi' },
  { value: '2-5', label: '2 à 5 personnes' },
  { value: '6-20', label: '6 à 20 personnes' },
  { value: '21-50', label: '21 à 50 personnes' },
  { value: '50+', label: 'Plus de 50 personnes' },
];

const ANNUAL_HIRES = [
  { value: '1-5', label: '1 à 5 recrutements' },
  { value: '6-15', label: '6 à 15 recrutements' },
  { value: '16-40', label: '16 à 40 recrutements' },
  { value: '40+', label: 'Plus de 40 recrutements' },
];

const FREELANCE_MODES = [
  { value: 'rpo', label: "RPO (intégré à l'équipe du client)" },
  { value: 'success', label: 'Au succès, missions ponctuelles' },
  { value: 'both', label: 'Les deux' },
];

const FIELD_CLASS = 'h-11 md:h-10';
const NAV_BUTTON_CLASS = 'min-h-11 md:min-h-0';

export const SceneOrgDetails: React.FC<Props> = ({ orgType, onSubmit, onBack }) => {
  const isFreelance = orgType === 'freelance';
  const [teamSize, setTeamSize] = useState(isFreelance ? '1' : '');
  const [freelanceMode, setFreelanceMode] = useState('');
  const [annualHires, setAnnualHires] = useState('');
  const modeId = useId();
  const teamId = useId();
  const hiresId = useId();
  const hiresHintId = useId();

  const canSubmit = teamSize && (!isFreelance || freelanceMode);

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {isFreelance ? 'Votre activité, concrètement.' : 'Votre équipe, concrètement.'}
        </h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
          Votre façon de travailler et votre volume calibrent vos quotas d'envoi et ce que l'IA Konekt vous recommande.
        </p>
      </div>

      <div className="space-y-5">
        {isFreelance && (
          <div className="space-y-2">
            <Label htmlFor={modeId}>Mode d'intervention</Label>
            <Select value={freelanceMode} onValueChange={setFreelanceMode}>
              <SelectTrigger id={modeId} className={FIELD_CLASS}>
                <SelectValue placeholder="Choisissez un mode" />
              </SelectTrigger>
              <SelectContent>
                {FREELANCE_MODES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!isFreelance && (
          <div className="space-y-2">
            <Label htmlFor={teamId}>Taille de l'équipe recrutement</Label>
            <Select value={teamSize} onValueChange={setTeamSize}>
              <SelectTrigger id={teamId} className={FIELD_CLASS}>
                <SelectValue placeholder="Choisissez une taille" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_SIZES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={hiresId}>
            {isFreelance ? 'Recrutements visés sur 12 mois' : 'Recrutements prévus sur 12 mois'}
          </Label>
          <Select value={annualHires} onValueChange={setAnnualHires}>
            <SelectTrigger id={hiresId} aria-describedby={hiresHintId} className={FIELD_CLASS}>
              <SelectValue placeholder="Choisissez un volume" />
            </SelectTrigger>
            <SelectContent>
              {ANNUAL_HIRES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={hiresHintId} className="text-xs text-muted-foreground">
            Facultatif. Sert à dimensionner vos quotas et vos suggestions de missions.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className={NAV_BUTTON_CLASS}>
          <ArrowLeft aria-hidden="true" />
          Retour
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            canSubmit &&
            onSubmit({
              teamSize,
              freelanceMode: isFreelance ? freelanceMode : undefined,
              annualHires: annualHires || undefined,
            })
          }
          disabled={!canSubmit}
          className={NAV_BUTTON_CLASS}
        >
          Continuer
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};
