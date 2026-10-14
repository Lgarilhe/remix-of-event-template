import { useState } from 'react';
import { BriefcaseBusiness, Cloud, Code2, Database, Rocket, Sparkles, Target, Users, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMissionAppearance } from '@/hooks/sidebar/useMissionAppearance';
import { defaultMissionAppearance, MISSION_COLORS, MISSION_ICONS, type MissionColor, type MissionIcon } from '@/lib/missionAppearance';
import { cn } from '@/lib/utils';

const ICONS: Record<MissionIcon, { icon: LucideIcon; label: string }> = {
  briefcase: { icon: BriefcaseBusiness, label: 'Mallette' },
  code: { icon: Code2, label: 'Code' },
  database: { icon: Database, label: 'Données' },
  cloud: { icon: Cloud, label: 'Cloud' },
  sparkles: { icon: Sparkles, label: 'Étoiles' },
  target: { icon: Target, label: 'Cible' },
  rocket: { icon: Rocket, label: 'Fusée' },
  users: { icon: Users, label: 'Équipe' },
};
const COLORS: Record<MissionColor, { label: string; className: string; dot: string }> = {
  teal: { label: 'Turquoise', className: 'bg-mission-teal-soft text-mission-teal', dot: 'bg-mission-teal' },
  blue: { label: 'Bleu', className: 'bg-mission-blue-soft text-mission-blue', dot: 'bg-mission-blue' },
  violet: { label: 'Violet', className: 'bg-mission-violet-soft text-mission-violet', dot: 'bg-mission-violet' },
  rose: { label: 'Rose', className: 'bg-mission-rose-soft text-mission-rose', dot: 'bg-mission-rose' },
  amber: { label: 'Ambre', className: 'bg-mission-amber-soft text-mission-amber', dot: 'bg-mission-amber' },
  green: { label: 'Vert', className: 'bg-mission-green-soft text-mission-green', dot: 'bg-mission-green' },
};

export function MissionMarker({ missionId, name, logoUrl, size = 24, editable = false }: {
  missionId: string; name: string; logoUrl?: string | null; size?: number; editable?: boolean;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const { appearance, setAppearance, canEdit } = useMissionAppearance(missionId);
  const selected = appearance ?? defaultMissionAppearance(missionId);
  const color = COLORS[selected.color];
  const Icon = selected.icon === 'dot' ? null : ICONS[selected.icon].icon;
  const marker = !appearance && logoUrl && failedLogo !== logoUrl ? (
    <img src={logoUrl} alt="" aria-hidden="true" style={{ width: size, height: size }}
      className="shrink-0 rounded-lg bg-card object-contain ring-1 ring-border" onError={() => setFailedLogo(logoUrl)} />
  ) : (
    <span aria-hidden="true" style={{ width: size, height: size }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', Icon && color.className)}>
      {Icon ? <Icon style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }} />
        : <span className={cn('rounded-full', color.dot)} style={{ width: Math.round(size * 0.4), height: Math.round(size * 0.4) }} />}
    </span>
  );
  if (!editable || !canEdit) return marker;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={`Personnaliser le repère de ${name}`} title="Personnaliser le repère"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex h-auto w-auto min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg outline-none hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:min-w-8">
          {marker}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Repère de la mission" align="start" className="w-72 max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div>
          <p className="text-sm font-medium">Repère de la mission</p>
          <p className="mt-1 text-xs text-muted-foreground">Votre choix est mémorisé dans ce navigateur.</p>
        </div>
        <div role="group" aria-label="Forme du repère" className="grid grid-cols-5 gap-1">
          {MISSION_ICONS.map((key) => {
            const { icon: ChoiceIcon, label } = ICONS[key];
            return <Button key={key} variant="ghost" size="icon" className="min-h-11 min-w-11 aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-ring"
              aria-label={label} title={label} aria-pressed={!!appearance && selected.icon === key}
              onClick={() => setAppearance({ ...selected, icon: key })}>
              <ChoiceIcon aria-hidden="true" />
            </Button>;
          })}
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11 aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-ring" aria-label="Point de couleur" title="Point de couleur"
            aria-pressed={selected.icon === 'dot'} onClick={() => setAppearance({ ...selected, icon: 'dot' })}>
            <span aria-hidden="true" className={cn('h-3 w-3 rounded-full', color.dot)} />
          </Button>
        </div>
        <div role="group" aria-label="Couleur du repère" className="grid grid-cols-3 gap-1">
          {MISSION_COLORS.map((key) => <Button key={key} variant="ghost" size="icon" className="min-h-11 w-full aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-ring"
            aria-label={COLORS[key].label} title={COLORS[key].label} aria-pressed={selected.color === key}
            onClick={() => setAppearance({ ...selected, color: key })}>
            <span aria-hidden="true" className={cn('h-5 w-5 rounded-full', COLORS[key].dot)} />
          </Button>)}
        </div>
        <Button variant="ghost" size="sm" className="min-h-11 w-full aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-ring" onClick={() => setAppearance(null)}>Rétablir le repère par défaut</Button>
      </PopoverContent>
    </Popover>
  );
}
