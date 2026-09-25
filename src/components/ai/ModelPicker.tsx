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
import { ModelLogo } from './ModelLogo';
import { cn } from '@/lib/utils';

interface ModelPickerProps {
  actionId: string;
  value?: string | null;
  onChange: (modelId: string | null) => void;
  orgDefault?: string | null;
  compact?: boolean;
  disabled?: boolean;
}

/** « 1 crédit », « 3 crédits » : jamais « ~3 cr » (revue design E-51). */
const creditsLabel = (n: number) => `${n} crédit${n > 1 ? 's' : ''}`;

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
          aria-label={`Modèle : ${isAutoRouted ? 'automatique' : resolvedModel?.name ?? 'Avancé'}, environ ${creditsLabel(estimatedCost)}`}
          title="Choisir le modèle"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs transition-colors",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "opacity-50 cursor-not-allowed",
            !compact && "min-w-[140px]"
          )}
        >
          <ModelLogo modelId={resolvedModelId} size={14} />
          {!compact && (
            <span className="truncate text-muted-foreground">
              {isAutoRouted ? 'Automatique' : resolvedModel?.name ?? 'Avancé'}
            </span>
          )}
          <span className="ml-auto whitespace-nowrap font-medium tabular-nums text-foreground">
            {creditsLabel(estimatedCost)}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="pb-1 text-xs font-semibold text-foreground">Modèle</DropdownMenuLabel>
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
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">Automatique</span>
              <span className="truncate text-xs text-muted-foreground">Le modèle adapté à chaque demande</span>
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
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium">{model.name}</span>
                    <span className="text-xs text-muted-foreground truncate">{model.description}</span>
                  </div>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{creditsLabel(cost)}</span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
