import React, { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MessageCircle, MousePointerClick, CalendarCheck } from 'lucide-react';

export interface StopConditions {
  on_reply: boolean;
  on_click: boolean;
  on_unsubscribe: boolean;
  on_meeting_booked: boolean;
}

interface StopConditionsSettingsProps {
  value: StopConditions;
  onChange: (value: StopConditions) => void;
  /**
   * Page d'une séquence (onglet « Réglages », lot 5c-2) : lignes à plat sous
   * des filets, comme les Expéditeurs (06-simplicite, règle 3), et apostrophe
   * typographique. Défaut : les cadres de l'éditeur actuel, jusqu'au lot 5j.
   */
  plain?: boolean;
}

// La réponse et la désinscription arrêtent toujours la séquence : le moteur
// ne tient pas compte d'un réglage contraire. Elles ne sont donc plus des
// interrupteurs, et restent vraies dans l'objet écrit.
const STOP_ITEMS = [
  {
    key: 'on_click' as const,
    label: 'Arrêter si le candidat clique sur un lien',
    hint: 'Le clic est indicatif : certaines messageries suivent les liens automatiquement.',
    icon: MousePointerClick,
  },
  { key: 'on_meeting_booked' as const, label: 'Arrêter si un rendez-vous est pris', hint: null, icon: CalendarCheck },
];

export const StopConditionsSettings: React.FC<StopConditionsSettingsProps> = ({ value, onChange, plain = false }) => {
  const baseId = useId();
  return (
    <fieldset>
      <legend className="eyebrow mb-3">{plain ? 'Conditions d’arrêt' : "Conditions d'arrêt"}</legend>
      <div className={plain ? 'divide-y divide-border border-y border-border' : 'space-y-2'}>
        <div className={plain ? 'flex items-center gap-2.5 py-3' : 'flex items-center gap-2.5 rounded-lg border border-border bg-muted px-3 py-2.5'}>
          <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm leading-snug">{plain ? 'La séquence s’arrête toujours quand le candidat répond ou se désinscrit.' : "La séquence s'arrête toujours quand le candidat répond ou se désinscrit."}</p>
        </div>
        {STOP_ITEMS.map(item => {
          const Icon = item.icon;
          const id = `${baseId}-${item.key}`;
          const hintId = `${id}-hint`;
          return (
            <div key={item.key} className={plain ? 'flex items-center justify-between gap-3 py-3' : 'flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5'}>
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <Label htmlFor={id} className="cursor-pointer font-normal leading-snug">{item.label}</Label>
                  {item.hint && <p id={hintId} className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>}
                </div>
              </div>
              <Switch
                id={id}
                aria-describedby={item.hint ? hintId : undefined}
                checked={value[item.key]}
                onCheckedChange={(checked) => onChange({ ...value, on_reply: true, on_unsubscribe: true, [item.key]: checked })}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};
