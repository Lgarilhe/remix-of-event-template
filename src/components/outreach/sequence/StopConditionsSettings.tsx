import React from 'react';
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

export const StopConditionsSettings: React.FC<StopConditionsSettingsProps> = ({ value, onChange }) => {
  return (
    <div className="space-y-3">
      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Conditions d'arrêt
      </Label>
      <div className="space-y-2">
        <div className="flex items-center gap-2.5 p-2.5 border border-border bg-muted/20">
          <MessageCircle className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm">La séquence s'arrête toujours quand le candidat répond ou se désinscrit.</span>
        </div>
        {STOP_ITEMS.map(item => {
          const Icon = item.icon;
          const id = `stop-condition-${item.key}`;
          return (
            <div key={item.key} className="flex items-center justify-between gap-3 p-2.5 border border-border bg-background">
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <Label htmlFor={id} className="text-sm font-normal cursor-pointer">{item.label}</Label>
                  {item.hint && <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>}
                </div>
              </div>
              <Switch
                id={id}
                checked={value[item.key]}
                onCheckedChange={(checked) => onChange({ ...value, on_reply: true, on_unsubscribe: true, [item.key]: checked })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
