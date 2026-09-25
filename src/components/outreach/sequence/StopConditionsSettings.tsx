import React, { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MessageCircle, MousePointerClick, Ban, CalendarCheck } from 'lucide-react';

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

const STOP_ITEMS = [
  { key: 'on_reply' as const, label: 'Arrêter si le candidat répond', icon: MessageCircle, defaultOn: true },
  { key: 'on_click' as const, label: 'Arrêter si le candidat clique sur un lien', icon: MousePointerClick, defaultOn: false },
  { key: 'on_unsubscribe' as const, label: 'Arrêter si le candidat se désinscrit', icon: Ban, defaultOn: true },
  { key: 'on_meeting_booked' as const, label: 'Arrêter si un rendez-vous est pris', icon: CalendarCheck, defaultOn: false },
];

export const StopConditionsSettings: React.FC<StopConditionsSettingsProps> = ({ value, onChange }) => {
  const baseId = useId();
  return (
    <fieldset>
      <legend className="eyebrow mb-3">Conditions d'arrêt</legend>
      <div className="space-y-2">
        {STOP_ITEMS.map(item => {
          const Icon = item.icon;
          const id = `${baseId}-${item.key}`;
          return (
            <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
              <Label htmlFor={id} className="flex flex-1 cursor-pointer items-center gap-2.5 font-normal leading-snug">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {item.label}
              </Label>
              <Switch
                id={id}
                checked={value[item.key]}
                onCheckedChange={(checked) => onChange({ ...value, [item.key]: checked })}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};
