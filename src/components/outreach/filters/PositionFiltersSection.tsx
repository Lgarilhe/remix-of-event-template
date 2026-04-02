import React from 'react';
import {
  FilterPriority,
  FilterScope,
  RoleFilter,
  SENIORITY_LEVELS,
  ROLE_PRIORITY_OPTIONS,
  SCOPE_OPTIONS,
} from '../types';
import {
  FilterSection,
  FilterGroup,
  AutocompleteInput,
  SelectedBadges,
  PriorityBadges,
  MultiSelectDropdown,
} from '../FilterComponents';
import { isFilterSupported, getFilterTooltip } from '../filterApiSupport';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { X, Briefcase, Pencil } from 'lucide-react';
import type {
  FilterSectionBaseProps,
  AutocompleteProps,
  SectionToggleProps,
  SimpleFilterHandlers,
  PriorityFilterHandlers,
} from './types';

interface PositionFiltersSectionProps
  extends FilterSectionBaseProps,
    AutocompleteProps,
    SectionToggleProps,
    Pick<SimpleFilterHandlers, 'onAddSimpleFilter' | 'onRemoveSimpleFilter'>,
    PriorityFilterHandlers {
  countPositionFilters: number;
  // Role state
  newRoleKeywords: string;
  onNewRoleKeywordsChange: (v: string) => void;
  newRolePriority: FilterPriority;
  onNewRolePriorityChange: (v: FilterPriority) => void;
  newRoleScope: FilterScope;
  onNewRoleScopeChange: (v: FilterScope) => void;
  roleDialogOpen: boolean;
  onRoleDialogOpenChange: (open: boolean) => void;
  roleDialogDraft: string;
  onRoleDialogDraftChange: (draft: string) => void;
  roleDialogPriority: FilterPriority;
  onRoleDialogPriorityChange: (p: FilterPriority) => void;
  roleDialogScope: FilterScope;
  onRoleDialogScopeChange: (s: FilterScope) => void;
  editingRoleIndex: number | null;
  onEditingRoleIndexChange: (i: number | null) => void;
  onRemoveRole: (index: number) => void;
  onUpdateRole: (index: number, updates: Partial<RoleFilter>) => void;
}

export const PositionFiltersSection: React.FC<PositionFiltersSectionProps> = ({
  filters,
  onChange,
  searchInputs,
  parameterOptions,
  loadingParams,
  onSearchInput,
  isOpen,
  onToggle,
  activeFiltersPreview,
  countPositionFilters,
  onAddSimpleFilter,
  onRemoveSimpleFilter,
  onAddPriorityFilter,
  onUpdatePriority,
  onRemovePriorityFilter,
  newRoleKeywords,
  onNewRoleKeywordsChange,
  newRolePriority,
  onNewRolePriorityChange,
  newRoleScope,
  onNewRoleScopeChange,
  roleDialogOpen,
  onRoleDialogOpenChange,
  roleDialogDraft,
  onRoleDialogDraftChange,
  roleDialogPriority,
  onRoleDialogPriorityChange,
  roleDialogScope,
  onRoleDialogScopeChange,
  editingRoleIndex,
  onEditingRoleIndexChange,
  onRemoveRole,
  onUpdateRole,
}) => {
  return (
    <FilterSection
      id="position"
      title="Poste & Compétences"
      icon={<Briefcase className="w-4 h-4 text-violet-500/80" />}
      badge={countPositionFilters}
      isOpen={isOpen}
      onToggle={onToggle}
      activeFiltersPreview={activeFiltersPreview}
      bgColorClass="bg-violet-50/40"
    >
      {/* Job Title with priority */}
      <FilterGroup
        title="Titre du poste"
        badge={filters.job_title.length}
        unsupported={!isFilterSupported(filters.api, 'job_title')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'job_title')}
      >
        <PriorityBadges
          items={filters.job_title}
          onRemove={(id) => onRemovePriorityFilter('job_title', id)}
          onUpdatePriority={(id, priority) => onUpdatePriority('job_title', id, priority)}
        />
        <AutocompleteInput
          filterKey="job_title"
          placeholder="Rechercher un poste..."
          value={searchInputs['job_title'] || ''}
          options={parameterOptions['job_title'] || []}
          loading={loadingParams === 'job_title'}
          onInputChange={(val) => onSearchInput('job_title', val)}
          onSelect={(item) => onAddPriorityFilter('job_title', item)}
          disabled={!isFilterSupported(filters.api, 'job_title')}
        />
      </FilterGroup>

      {/* Role (keywords with scope) - Recruiter only */}
      <FilterGroup
        title="Rôle (mots-clés booléens)"
        badge={filters.role.length}
        unsupported={!isFilterSupported(filters.api, 'role')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'role')}
      >
        {filters.role.map((role, index) => (
          <div key={index} className="p-2 bg-purple-50 rounded-lg mb-2 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onEditingRoleIndexChange(index);
                  onRoleDialogDraftChange(role.keywords);
                  onRoleDialogPriorityChange(role.priority);
                  onRoleDialogScopeChange(role.scope);
                  onRoleDialogOpenChange(true);
                }}
                className="text-sm h-7 flex-1 text-left truncate hover:text-[#0077B5] transition-colors group flex items-center gap-1"
              >
                <span className="truncate">{role.keywords}</span>
                <Pencil className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button type="button" onClick={() => onRemoveRole(index)} className="text-purple-400 hover:text-purple-600 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={role.priority} onValueChange={(v) => onUpdateRole(index, { priority: v as FilterPriority })}>
                <SelectTrigger className="text-xs h-6 bg-card border-purple-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={role.scope} onValueChange={(v) => onUpdateRole(index, { scope: v as FilterScope })}>
                <SelectTrigger className="text-xs h-6 bg-card border-purple-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        <div className={`space-y-2 p-2 bg-gray-50 rounded-lg ${!isFilterSupported(filters.api, 'role') ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (isFilterSupported(filters.api, 'role')) {
                  onEditingRoleIndexChange(null);
                  onRoleDialogDraftChange(newRoleKeywords);
                  onRoleDialogPriorityChange(newRolePriority);
                  onRoleDialogScopeChange(newRoleScope);
                  onRoleDialogOpenChange(true);
                }
              }}
              disabled={!isFilterSupported(filters.api, 'role')}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md border border-input bg-background hover:bg-accent/50 transition-colors h-8 group disabled:opacity-50 disabled:pointer-events-none"
            >
              {newRoleKeywords ? (
                <span className="text-sm truncate flex-1">{newRoleKeywords}</span>
              ) : (
                <span className="text-xs text-muted-foreground flex-1">Cliquez pour ajouter un rôle...</span>
              )}
              <Pencil className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
          <Dialog open={roleDialogOpen} onOpenChange={onRoleDialogOpenChange}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingRoleIndex !== null ? 'Modifier' : 'Ajouter'} — Rôle (mots-clés booléens)</DialogTitle>
              </DialogHeader>
              <Textarea
                autoFocus
                value={roleDialogDraft}
                onChange={(e) => onRoleDialogDraftChange(e.target.value)}
                placeholder='Ex: "Solution Architect" OR "Cloud Architect" OR "Architecte Cloud" OR "Solutions Engineer"'
                className="min-h-[120px] text-sm font-mono"
                rows={5}
              />
              <div className="flex items-center gap-2 mt-1">
                <div className="space-y-1 flex-1">
                  <Label className="text-xs text-muted-foreground">Priorité</Label>
                  <Select value={roleDialogPriority} onValueChange={(v) => onRoleDialogPriorityChange(v as FilterPriority)}>
                    <SelectTrigger className="text-xs h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 flex-1">
                  <Label className="text-xs text-muted-foreground">Scope</Label>
                  <Select value={roleDialogScope} onValueChange={(v) => onRoleDialogScopeChange(v as FilterScope)}>
                    <SelectTrigger className="text-xs h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
                <p className="font-medium text-foreground/70">💡 Synonym Rings — ratissez large :</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Combiner <strong>FR + EN</strong> : <code className="text-xs bg-muted px-1 rounded">"DevOps Engineer" OR "Ingénieur DevOps" OR SRE</code></li>
                  <li>Inclure les <strong>variantes</strong> : <code className="text-xs bg-muted px-1 rounded">"VP Sales" OR "Head of Sales" OR "Directeur Commercial"</code></li>
                  <li><strong>Guillemets</strong> pour les titres composés : <code className="text-xs bg-muted px-1 rounded">"Product Manager"</code></li>
                  <li>Exclure avec <strong>NOT</strong> : <code className="text-xs bg-muted px-1 rounded">Sales NOT (Assistant OR Associate)</code></li>
                </ul>
                <p className="text-xs mt-1 text-muted-foreground/70">⚠️ Mettre les technos/compétences dans Mots-clés, pas ici. Limite ~200 caractères.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => onRoleDialogOpenChange(false)}>Annuler</Button>
                <Button size="sm" onClick={() => {
                  onRoleDialogOpenChange(false);
                  if (roleDialogDraft.trim()) {
                    if (editingRoleIndex !== null) {
                      onUpdateRole(editingRoleIndex, {
                        keywords: roleDialogDraft.trim(),
                        priority: roleDialogPriority,
                        scope: roleDialogScope,
                      });
                    } else {
                      const newRole: RoleFilter = {
                        keywords: roleDialogDraft.trim(),
                        priority: roleDialogPriority,
                        scope: roleDialogScope,
                      };
                      onChange({ ...filters, role: [...filters.role, newRole] });
                    }
                    onNewRoleKeywordsChange('');
                    onEditingRoleIndexChange(null);
                  }
                }}>
                  {editingRoleIndex !== null ? 'Modifier' : 'Ajouter'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Priorité</Label>
              <Select value={newRolePriority} onValueChange={(v) => onNewRolePriorityChange(v as FilterPriority)} disabled={!isFilterSupported(filters.api, 'role')}>
                <SelectTrigger className="text-xs h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Scope</Label>
              <Select value={newRoleScope} onValueChange={(v) => onNewRoleScopeChange(v as FilterScope)} disabled={!isFilterSupported(filters.api, 'role')}>
                <SelectTrigger className="text-xs h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Appuyez sur Entrée ou sortez du champ pour ajouter
          </p>
        </div>
      </FilterGroup>

      {/* Skills with priority */}
      <FilterGroup
        title="Compétences"
        badge={filters.skills.length}
        unsupported={!isFilterSupported(filters.api, 'skills')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'skills')}
      >
        <PriorityBadges
          items={filters.skills}
          onRemove={(id) => onRemovePriorityFilter('skills', id)}
          onUpdatePriority={(id, priority) => onUpdatePriority('skills', id, priority)}
        />
        <AutocompleteInput
          filterKey="skills"
          placeholder="Rechercher une compétence..."
          value={searchInputs['skills'] || ''}
          options={parameterOptions['skills'] || []}
          loading={loadingParams === 'skills'}
          onInputChange={(val) => onSearchInput('skills', val)}
          onSelect={(item) => onAddPriorityFilter('skills', item)}
          disabled={!isFilterSupported(filters.api, 'skills')}
        />
      </FilterGroup>

      {/* Seniority */}
      <FilterGroup
        title="Niveau de séniorité"
        badge={filters.seniority.length}
        unsupported={!isFilterSupported(filters.api, 'seniority')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'seniority')}
      >
        <MultiSelectDropdown
          options={SENIORITY_LEVELS.map(l => ({ value: l.value, label: l.label }))}
          selected={filters.seniority}
          onChange={(selected) => {
            const newSeniority = selected as string[];
            if (newSeniority.length < filters.seniority.length) {
              const cleanedRoles = filters.role.filter(r => {
                const seniorityKeywordsPattern = /\b(CEO|CTO|CFO|COO|CMO|CIO|CHRO|Chief|President|VP|Vice|Director|Directeur|Manager|Senior|Sr\.|Lead|Principal|Staff|Junior|Intern|Stagiaire|Trainee|Graduate|Associate|Partner|Owner|Founder|Co-Founder|Fondateur|Entrepreneur)\b/i;
                const isSeniorityGenerated = r.priority === 'MUST_HAVE' &&
                                              r.scope === 'CURRENT' &&
                                              seniorityKeywordsPattern.test(r.keywords);
                return !isSeniorityGenerated;
              });
              onChange({ ...filters, seniority: newSeniority, role: cleanedRoles });
            } else {
              onChange({ ...filters, seniority: newSeniority });
            }
          }}
          placeholder="Sélectionner les niveaux..."
          disabled={!isFilterSupported(filters.api, 'seniority')}
        />
      </FilterGroup>

      {/* Function / Department */}
      <FilterGroup
        title="Département / Fonction"
        badge={filters.function.length}
        unsupported={!isFilterSupported(filters.api, 'function')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'function')}
      >
        <SelectedBadges items={filters.function} onRemove={(id) => onRemoveSimpleFilter('function', id)} />
        <AutocompleteInput
          filterKey="function"
          placeholder="Rechercher un département..."
          value={searchInputs['function'] || ''}
          options={parameterOptions['function'] || []}
          loading={loadingParams === 'function'}
          onInputChange={(val) => onSearchInput('function', val)}
          onSelect={(item) => onAddSimpleFilter('function', item)}
          disabled={!isFilterSupported(filters.api, 'function')}
        />
      </FilterGroup>

      {/* Degree - Recruiter */}
      <FilterGroup
        title="Niveau d'études"
        badge={filters.degree.length}
        unsupported={!isFilterSupported(filters.api, 'degree')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'degree')}
      >
        <PriorityBadges
          items={filters.degree}
          onRemove={(id) => onRemovePriorityFilter('degree', id)}
          onUpdatePriority={(id, priority) => onUpdatePriority('degree', id, priority)}
        />
        <AutocompleteInput
          filterKey="degree"
          placeholder="Rechercher un diplôme (ex: Master, Licence...)"
          value={searchInputs['degree'] || ''}
          options={parameterOptions['degree'] || []}
          loading={loadingParams === 'degree'}
          onInputChange={(val) => onSearchInput('degree', val)}
          onSelect={(item) => onAddPriorityFilter('degree', item)}
          disabled={!isFilterSupported(filters.api, 'degree')}
        />
      </FilterGroup>
    </FilterSection>
  );
};
