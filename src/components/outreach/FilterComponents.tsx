import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Loader2, Plus, ChevronRight, Search, AlertTriangle, Check } from 'lucide-react';
import { FilterItem, PriorityFilterItem, LocationFilterItem, FilterPriority, LocationScope, PRIORITY_OPTIONS, LOCATION_SCOPE_OPTIONS } from './types';
import { createPortal } from 'react-dom';

// ===== Filter Section (opens as fullscreen modal on click) =====
interface FilterSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  badge?: number;
  isOpen: boolean;
  onToggle: () => void;
  activeFiltersPreview?: string[];
  bgColorClass?: string;
}

export const FilterSection: React.FC<FilterSectionProps> = React.memo(({
  id,
  title,
  icon,
  children,
  badge,
  isOpen,
  onToggle,
  activeFiltersPreview,
  bgColorClass = '',
}) => {
  return (
    <>
      {/* Summary row — click to open modal */}
      <button
        type="button"
        onClick={onToggle}
        className={`flex flex-col items-start w-full p-4 border-b border-border hover:bg-muted/50 transition-colors text-left ${bgColorClass}`}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</span>
            {badge !== undefined && badge > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs bg-foreground/10 text-foreground">
                {badge}
              </Badge>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-foreground/40" />
        </div>
        {activeFiltersPreview && activeFiltersPreview.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 w-full">
            {activeFiltersPreview.filter(Boolean).slice(0, 5).map((filter, index) => (
              <Badge
                key={index}
                variant="outline"
                className="text-xs h-5 px-1.5 bg-background/60 text-foreground/70 border-border font-normal"
              >
                {String(filter).length > 20 ? `${String(filter).slice(0, 20)}...` : String(filter)}
              </Badge>
            ))}
            {activeFiltersPreview.length > 5 && (
              <Badge
                variant="outline"
                className="text-xs h-5 px-1.5 bg-accent/50 text-foreground border-border font-normal"
              >
                +{activeFiltersPreview.length - 5}
              </Badge>
            )}
          </div>
        )}
      </button>

      {/* Fullscreen modal via portal */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[5500] flex flex-col bg-background pointer-events-auto">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              {icon}
              <span className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</span>
              {badge !== undefined && badge > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs bg-foreground/10 text-foreground">
                  {badge}
                </Badge>
              )}
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5 text-foreground/60" />
            </button>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-2">
              {children}
            </div>
          </div>
          {/* Footer */}
          <div className="shrink-0 px-4 py-3 border-t border-border">
            <Button onClick={onToggle} className="w-full">
              Fermer
            </Button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
});

// ===== Filter Group =====
interface FilterGroupProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  badge?: number;
  unsupported?: boolean;
  unsupportedTooltip?: string;
}

export const FilterGroup: React.FC<FilterGroupProps> = ({
  title,
  icon,
  children,
  badge,
  unsupported = false,
  unsupportedTooltip,
}) => (
  <div className={`border border-border bg-muted/30 p-2 ${unsupported ? 'opacity-50 pointer-events-none select-none' : ''}`}>
    <div className="flex items-center gap-1.5 mb-1.5">
      {icon && icon}
      <span className="text-xs font-medium text-foreground/70 uppercase tracking-wide">{title}</span>
      {badge !== undefined && badge > 0 && (
        <Badge variant="outline" className="h-4 px-1 text-xs bg-foreground/10 text-foreground border-border">{badge}</Badge>
      )}
      {unsupported && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 ml-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <Badge variant="outline" className="h-4 px-1 text-xs border-amber-300 text-amber-600 bg-warning/10">
                  Non supporté
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[250px] text-xs">
              {unsupportedTooltip || "Ce filtre n'est pas supporté par l'API sélectionnée."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
    {children}
  </div>
);

// ===== Autocomplete Input =====
export interface ParameterOption {
  id: string;
  title: string;
}

interface AutocompleteInputProps {
  filterKey: string;
  placeholder: string;
  value: string;
  options: ParameterOption[];
  loading: boolean;
  onInputChange: (value: string) => void;
  onSelect: (item: ParameterOption) => void;
  disabled?: boolean;
}

export const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  filterKey,
  placeholder,
  value,
  options,
  loading,
  onInputChange,
  onSelect,
  disabled = false,
}) => {
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={placeholder}
          className={`text-sm h-9 pl-8 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={disabled}
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-foreground" />
        )}
      </div>
      {options.length > 0 && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-border shadow-lg max-h-48 overflow-auto">
          {options.map((option, index) => (
            <button
              key={`${option.id}-${index}`}
              type="button"
              onClick={() => onSelect(option)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between group"
            >
              <span className="truncate">{option.title}</span>
              <Plus className="w-4 h-4 text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ===== Selected Badges =====
interface SelectedBadgesProps {
  items: FilterItem[];
  onRemove: (id: string) => void;
}

export const SelectedBadges: React.FC<SelectedBadgesProps> = ({ items, onRemove }) => {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {items.map((item) => (
        <Badge
          key={item.id}
          variant="secondary"
          className="gap-1 pr-1 bg-foreground/10 text-foreground hover:bg-foreground/20 text-xs"
        >
          <span className="max-w-[150px] truncate">{item.name}</span>
          <button type="button" onClick={() => onRemove(item.id)} className="ml-0.5 hover:bg-foreground/30 p-0.5">
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
};

// ===== Priority Badges =====
interface PriorityBadgesProps {
  items: PriorityFilterItem[];
  onRemove: (id: string) => void;
  onUpdatePriority: (id: string, priority: FilterPriority) => void;
}

export const PriorityBadges: React.FC<PriorityBadgesProps> = ({
  items,
  onRemove,
  onUpdatePriority,
}) => {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5 mb-2">
      {items.map((item) => {
        const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === item.priority);
        return (
          <div key={item.id} className="flex items-center gap-2 p-2 bg-muted/50">
            <span className="text-sm flex-1 truncate">{item.name}</span>
            <Select
              value={item.priority}
              onValueChange={(val) => onUpdatePriority(item.id, val as FilterPriority)}
            >
              <SelectTrigger className={`h-6 w-24 text-xs border-0 ${priorityConfig?.color}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    <span className="flex items-center gap-1">
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button type="button" onClick={() => onRemove(item.id)} className="text-red-400 hover:text-red-600 p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ===== Location Badges (with priority and scope for Recruiter) =====
interface LocationBadgesProps {
  items: LocationFilterItem[];
  onRemove: (id: string) => void;
  onUpdatePriority: (id: string, priority: FilterPriority) => void;
  onUpdateScope: (id: string, scope: LocationScope) => void;
}

export const LocationBadges: React.FC<LocationBadgesProps> = ({
  items,
  onRemove,
  onUpdatePriority,
  onUpdateScope,
}) => {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 mb-3">
      {items.map((item) => {
        const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === item.priority);
        const scopeConfig = LOCATION_SCOPE_OPTIONS.find((s) => s.value === item.scope);
        return (
          <div 
            key={item.id} 
            className="bg-muted/30 border border-border p-3"
          >
            {/* Location name and remove button */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground truncate flex-1 pr-2">
                {item.name}
              </span>
              <button 
                type="button" 
                onClick={() => onRemove(item.id)} 
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            {/* Priority and Scope selectors in a clean row */}
            <div className="flex items-center gap-2">
              <Select
                value={item.priority}
                onValueChange={(val) => onUpdatePriority(item.id, val as FilterPriority)}
              >
                <SelectTrigger className={`h-7 flex-1 text-xs border-0 shadow-sm ${priorityConfig?.color}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select
                value={item.scope}
                onValueChange={(val) => onUpdateScope(item.id, val as LocationScope)}
              >
                <SelectTrigger className="h-7 flex-1 text-xs border border-border bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {LOCATION_SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
// ===== Multi-Select Dropdown =====
interface MultiSelectOption {
  value: string | number;
  label: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: (string | number)[];
  onChange: (selected: (string | number)[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options,
  selected,
  onChange,
  placeholder = 'Sélectionner...',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);

  const toggleOption = (value: string | number) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectedLabels = selected
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter(Boolean);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-full justify-between h-9 text-sm font-normal ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={disabled}
        >
          {selected.length > 0 ? (
            <div className="flex items-center gap-1 overflow-hidden">
              <span className="truncate">
                {selectedLabels.slice(0, 2).join(', ')}
              </span>
              {selected.length > 2 && (
                <Badge variant="secondary" className="h-5 px-1 text-xs shrink-0">
                  +{selected.length - 2}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0 bg-background" align="start">
        <div className="max-h-[200px] overflow-auto p-1">
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => toggleOption(option.value)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted transition-colors ${
                  isSelected ? 'bg-accent/50' : ''
                }`}
              >
                <div className={`w-4 h-4 border flex items-center justify-center shrink-0 ${
                  isSelected ? 'bg-foreground border-border' : 'border-border'
                }`}>
                  {isSelected && <Check className="w-3 h-3 text-background" />}
                </div>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-xs text-destructive hover:bg-destructive/10 p-1.5 transition-colors"
            >
              Tout effacer
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
