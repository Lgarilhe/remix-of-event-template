import { useState } from 'react';
import {
  MODEL_CATALOG,
  ACTION_COSTS,
  TIER_LABELS,
  estimateCredits,
  resolveModel,
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
import { ModelLogo, ProviderLabel } from './ModelLogo';
import { cn } from '@/lib/utils';

interface ModelPickerProps {
  actionId: string;
  value?: string | null;
  onChange: (modelId: string | null) => void;
  orgDefault?: string | null;
  compact?: boolean;
  disabled?: boolean;
}

const modelOrder: string[] = [
  'claude-haiku-4-5',
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
  const resolvedModelId = resolveModel(routingTier, value, orgDefault, actionId);
  const resolvedModel = MODEL_CATALOG[resolvedModelId];
  const isAutoRouted = !value;
  const estimatedCost = estimateCredits(actionId, resolvedModelId);

  // Filter models by supported providers for this action
  const allowedProviders = action?.providers;
  const filteredModelOrder = allowedProviders
    ? modelOrder.filter((id) => {
        const model = MODEL_CATALOG[id];
        return model && allowedProviders.includes(model.provider);
      })
    : modelOrder;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 text-xs rounded-sm border border-border px-2 py-1 transition-colors",
            "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "opacity-50 cursor-not-allowed",
            !compact && "min-w-[140px]"
          )}
        >
          <ModelLogo modelId={resolvedModelId} size={14} />
          {!compact && (
            <span className="truncate text-muted-foreground">
              {resolvedModel?.name ?? 'Sonnet 4.6'}
            </span>
          )}
          <span className="ml-auto font-medium text-foreground whitespace-nowrap">
            ~{estimatedCost} cr
          </span>
          {isAutoRouted && (
            <span className="text-xs text-muted-foreground/70 uppercase tracking-wider">auto</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-bold text-foreground pb-1">
          Modèle
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup
          value={value ?? '__auto__'}
          onValueChange={(v) => {
            onChange(v === '__auto__' ? null : v);
            setOpen(false);
          }}
        >
          {/* Auto option */}
          <DropdownMenuRadioItem value="__auto__" className="cursor-pointer py-3">
            <div className="flex items-center gap-3 w-full">
              <span className="text-base shrink-0">✨</span>
              <span className="text-sm font-medium">Automatique</span>
            </div>
          </DropdownMenuRadioItem>

          <DropdownMenuSeparator />

          {filteredModelOrder.map((modelId) => {
            const model = MODEL_CATALOG[modelId];
            if (!model) return null;
            const cost = estimateCredits(actionId, modelId);

            return (
              <DropdownMenuRadioItem
                key={modelId}
                value={modelId}
                className="cursor-pointer py-3"
              >
                <div className="flex items-center gap-3 w-full">
                  <ModelLogo modelId={modelId} size={22} />
                  <span className="text-sm font-medium">{model.name}</span>
                  <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground font-medium rounded-sm ml-auto shrink-0">
                    ~{cost} cr
                  </span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
