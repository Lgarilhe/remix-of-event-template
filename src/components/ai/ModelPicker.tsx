import { useState } from 'react';
import {
  MODEL_CATALOG,
  ACTION_COSTS,
  TIER_ICONS,
  TIER_LABELS,
  estimateCredits,
  resolveModel,
  type AIModel,
  type RoutingTier,
} from '@/types/aiCredits';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface ModelPickerProps {
  /** The AI action this picker is for (determines routing tier & estimation) */
  actionId: string;
  /** Currently selected model override (null = auto) */
  value?: string | null;
  /** Called when user selects a model */
  onChange: (modelId: string | null) => void;
  /** Organization default model */
  orgDefault?: string | null;
  /** Compact mode — just shows the badge, no label */
  compact?: boolean;
  /** Disable interaction */
  disabled?: boolean;
}

const modelOrder: string[] = [
  'gemini-2.5-flash',
  'claude-haiku-4-5',
  'gemini-2.5-pro',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
];

export const ModelPicker = ({
  actionId,
  value,
  onChange,
  orgDefault,
  compact = false,
  disabled = false,
}: ModelPickerProps) => {
  const [open, setOpen] = useState(false);

  const action = ACTION_COSTS[actionId];
  const routingTier: RoutingTier = action?.routingTier ?? 'default';
  const resolvedModelId = resolveModel(routingTier, value, orgDefault);
  const resolvedModel = MODEL_CATALOG[resolvedModelId];
  const isAutoRouted = !value;
  const estimatedCost = estimateCredits(actionId, resolvedModelId);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 text-xs rounded-sm border border-border px-2 py-1 transition-colors",
            "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "opacity-50 cursor-not-allowed",
            !compact && "min-w-[140px]"
          )}
        >
          <span className="text-[10px]">{TIER_ICONS[resolvedModel?.tier ?? 'balanced']}</span>
          {!compact && (
            <span className="truncate text-muted-foreground">
              {resolvedModel?.name ?? 'Sonnet 4.6'}
            </span>
          )}
          <span className="ml-auto font-medium text-foreground whitespace-nowrap">
            ~{estimatedCost} cr
          </span>
          {isAutoRouted && (
            <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">auto</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Choisir le modèle IA
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Auto option */}
        <DropdownMenuRadioGroup
          value={value ?? '__auto__'}
          onValueChange={(v) => {
            onChange(v === '__auto__' ? null : v);
            setOpen(false);
          }}
        >
          <DropdownMenuRadioItem value="__auto__" className="cursor-pointer">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="text-[10px]">🔄</span>
                <div>
                  <p className="text-sm font-medium">Auto</p>
                  <p className="text-[10px] text-muted-foreground">
                    {resolvedModel?.name} recommandé
                  </p>
                </div>
              </div>
              <span className="text-xs font-medium">
                ~{estimateCredits(actionId, resolveModel(routingTier, null, orgDefault))} cr
              </span>
            </div>
          </DropdownMenuRadioItem>

          <DropdownMenuSeparator />

          {modelOrder.map((modelId) => {
            const model = MODEL_CATALOG[modelId];
            if (!model) return null;
            const cost = estimateCredits(actionId, modelId);
            const isRecommended = modelId === resolveModel(routingTier, null, orgDefault);

            return (
              <DropdownMenuRadioItem
                key={modelId}
                value={modelId}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]">{TIER_ICONS[model.tier]}</span>
                    <div>
                      <p className="text-sm">
                        {model.name}
                        {isRecommended && (
                          <span className="ml-1.5 text-[9px] text-muted-foreground uppercase">rec.</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{model.description}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "text-xs font-medium whitespace-nowrap",
                    model.tier === 'premium' && "text-amber-600",
                    model.tier === 'budget' && "text-emerald-600"
                  )}>
                    ~{cost} cr
                  </span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
          1 cr = 1 000 tokens Sonnet. Coût réel basé sur les tokens consommés.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
