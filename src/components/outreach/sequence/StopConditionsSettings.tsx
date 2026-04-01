import React from 'react';
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
  { key: 'on_click' as const, label: 'Arrêter si le candidat clique un lien', icon: MousePointerClick, defaultOn: false },
  { key: 'on_unsubscribe' as const, label: 'Arrêter si le candidat se désinscrit', icon: Ban, defaultOn: true },
  { key: 'on_meeting_booked' as const, label: 'Arrêter si un meeting est booké', icon: CalendarCheck, defaultOn: false },
];

export const StopConditionsSettings: React.FC<StopConditionsSettingsProps> = ({ value, onChange }) => {
  return (
    <div className="space-y-3">
      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Conditions d'arrêt
      </Label>
      <div className="space-y-2">
        {STOP_ITEMS.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.key} className="flex items-center justify-between p-2.5 border border-foreground/20 bg-background">
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{item.label}</span>
              </div>
              <Switch
                checked={value[item.key]}
                onCheckedChange={(checked) => onChange({ ...value, [item.key]: checked })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
