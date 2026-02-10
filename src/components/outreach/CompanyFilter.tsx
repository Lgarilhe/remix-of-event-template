import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { X, Plus, Pencil } from 'lucide-react';
import { AutocompleteInput, ParameterOption } from './FilterComponents';

// Company filter types
export type CompanyPriority = 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
export type CompanyScope = 'CURRENT_OR_PAST' | 'CURRENT' | 'PAST' | 'PAST_NOT_CURRENT';

export interface CompanyIdFilter {
  id: string;
  name: string;
}

export interface CompanyKeywordFilter {
  keywords: string;
  priority: CompanyPriority;
  scope: CompanyScope;
}

// Options for priority
export const COMPANY_PRIORITY_OPTIONS = [
  { value: 'MUST_HAVE', label: 'Obligatoire', color: 'bg-green-100 text-green-700', icon: '✓' },
  { value: 'CAN_HAVE', label: 'Souhaité', color: 'bg-blue-100 text-blue-700', icon: '○' },
  { value: 'DOESNT_HAVE', label: 'Exclure', color: 'bg-red-100 text-red-700', icon: '✕' },
];

// Options for scope
export const COMPANY_SCOPE_OPTIONS = [
  { value: 'CURRENT_OR_PAST', label: 'Actuelle ou passée' },
  { value: 'CURRENT', label: 'Actuelle uniquement' },
  { value: 'PAST', label: 'Passée uniquement' },
  { value: 'PAST_NOT_CURRENT', label: 'Passée (non actuelle)' },
];

interface CompanyFilterProps {
  // ID-based companies (kept for non-Recruiter mode)
  idCompanies: CompanyIdFilter[];
  onAddIdCompany: (item: ParameterOption) => void;
  onRemoveIdCompany: (id: string) => void;
  
  // Keywords-based companies
  keywordCompanies: CompanyKeywordFilter[];
  onAddKeywordCompany: (company: CompanyKeywordFilter) => void;
  onRemoveKeywordCompany: (index: number) => void;
  onUpdateKeywordCompany: (index: number, updates: Partial<CompanyKeywordFilter>) => void;
  
  // Autocomplete
  searchValue: string;
  onSearchChange: (value: string) => void;
  options: ParameterOption[];
  loading: boolean;
  
  // Mode
  isRecruiter: boolean;
}

export const CompanyFilter: React.FC<CompanyFilterProps> = ({
  idCompanies,
  onAddIdCompany,
  onRemoveIdCompany,
  keywordCompanies,
  onAddKeywordCompany,
  onRemoveKeywordCompany,
  onUpdateKeywordCompany,
  searchValue,
  onSearchChange,
  options,
  loading,
  isRecruiter,
}) => {
  const [newKeywords, setNewKeywords] = useState('');
  const [newPriority, setNewPriority] = useState<CompanyPriority>('MUST_HAVE');
  const [newScope, setNewScope] = useState<CompanyScope>('CURRENT_OR_PAST');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDraft, setDialogDraft] = useState('');
  const [dialogPriority, setDialogPriority] = useState<CompanyPriority>('MUST_HAVE');
  const [dialogScope, setDialogScope] = useState<CompanyScope>('CURRENT');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleAddKeyword = () => {
    if (!newKeywords.trim()) return;
    onAddKeywordCompany({
      keywords: newKeywords.trim(),
      priority: newPriority,
      scope: newScope,
    });
    setNewKeywords('');
  };

  const handleDialogApply = () => {
    if (!dialogDraft.trim()) return;
    if (editingIndex !== null) {
      // Update existing entry
      onUpdateKeywordCompany(editingIndex, {
        keywords: dialogDraft.trim(),
        priority: dialogPriority,
        scope: dialogScope,
      });
    } else {
      // Add new entry
      onAddKeywordCompany({
        keywords: dialogDraft.trim(),
        priority: dialogPriority,
        scope: dialogScope,
      });
    }
    setDialogOpen(false);
    setDialogDraft('');
    setEditingIndex(null);
  };

  const openBooleanDialog = () => {
    setEditingIndex(null);
    setDialogDraft(newKeywords);
    setDialogPriority(newPriority);
    setDialogScope(newScope);
    setDialogOpen(true);
  };

  const openEditDialog = (index: number) => {
    const company = keywordCompanies[index];
    setEditingIndex(index);
    setDialogDraft(company.keywords);
    setDialogPriority(company.priority);
    setDialogScope(company.scope);
    setDialogOpen(true);
  };
  if (!isRecruiter) {
    return (
      <div className="space-y-2">
        {idCompanies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {idCompanies.map((company) => (
              <Badge
                key={company.id}
                variant="secondary"
                className="gap-1 pr-1 bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20 text-xs"
              >
                <span className="max-w-[150px] truncate">{company.name}</span>
                <button 
                  type="button" 
                  onClick={() => onRemoveIdCompany(company.id)} 
                  className="ml-0.5 hover:bg-[#0077B5]/30 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        
        <AutocompleteInput
          filterKey="company"
          placeholder="Rechercher une entreprise..."
          value={searchValue}
          options={options}
          loading={loading}
          onInputChange={onSearchChange}
          onSelect={onAddIdCompany}
        />
      </div>
    );
  }

  // Recruiter mode: keywords-based only (more flexible)
  return (
    <div className="space-y-2">
      {/* Existing keyword companies */}
      {keywordCompanies.length > 0 && (
        <div className="space-y-1.5">
          {keywordCompanies.map((company, index) => {
            const priorityConfig = COMPANY_PRIORITY_OPTIONS.find((p) => p.value === company.priority);
            return (
              <div 
                key={index} 
                className="bg-white border border-gray-100 rounded-md p-2 shadow-sm"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    type="button"
                    onClick={() => openEditDialog(index)}
                    className="text-xs font-medium text-[#1A1A1A] truncate flex-1 pr-2 text-left hover:text-[#0077B5] transition-colors group flex items-center gap-1"
                  >
                    <span className="truncate">{company.keywords}</span>
                    <Pencil className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                  <button 
                    type="button" 
                    onClick={() => onRemoveKeywordCompany(index)} 
                    className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-0.5 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <Select
                    value={company.priority}
                    onValueChange={(val) => onUpdateKeywordCompany(index, { priority: val as CompanyPriority })}
                  >
                    <SelectTrigger className={`h-6 flex-1 text-[10px] border-0 shadow-sm ${priorityConfig?.color}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white z-50">
                      {COMPANY_PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          <span className="flex items-center gap-1">
                            <span>{opt.icon}</span>
                            <span>{opt.label}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select
                    value={company.scope}
                    onValueChange={(val) => onUpdateKeywordCompany(index, { scope: val as CompanyScope })}
                  >
                    <SelectTrigger className="h-6 flex-1 text-[10px] border border-gray-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white z-50">
                      {COMPANY_SCOPE_OPTIONS.map((opt) => (
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
      )}

      {/* Add new keyword company */}
      <div className="space-y-1.5 p-2 bg-gray-50/80 rounded-md border border-dashed border-gray-200">
        <Input
          value={newKeywords}
          onChange={(e) => setNewKeywords(e.target.value)}
          placeholder="Ex: Google, Meta, Amazon..."
          className="text-xs h-7"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddKeyword();
            }
          }}
        />
        
        <div className="flex items-center gap-1.5">
          <Select value={newPriority} onValueChange={(v) => setNewPriority(v as CompanyPriority)}>
            <SelectTrigger className="h-6 flex-1 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white z-50">
              {COMPANY_PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  <span className="flex items-center gap-1">
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={newScope} onValueChange={(v) => setNewScope(v as CompanyScope)}>
            <SelectTrigger className="h-6 flex-1 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white z-50">
              {COMPANY_SCOPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            type="button"
            size="sm"
            onClick={handleAddKeyword}
            disabled={!newKeywords.trim()}
            className="h-6 px-2 bg-[#0077B5] hover:bg-[#005E93]"
          >
            <Plus className="w-3 h-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openBooleanDialog}
            className="h-6 px-2"
            title="Éditeur Boolean avancé"
          >
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        
        <p className="text-[9px] text-muted-foreground">
          Utilisez AND, NOT pour affiner ou <button type="button" onClick={openBooleanDialog} className="underline hover:text-foreground">ouvrez l'éditeur Boolean</button>
        </p>
      </div>

      {/* Boolean editor dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingIndex !== null ? 'Modifier' : 'Ajouter'} — Entreprises Boolean</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            value={dialogDraft}
            onChange={(e) => setDialogDraft(e.target.value)}
            placeholder='Ex: Accenture OR "Bearing Point" OR Capgemini OR "Sia Partners" NOT Freelance'
            className="min-h-[140px] text-sm font-mono"
            rows={6}
          />
          <div className="flex items-center gap-2 mt-1">
            <Select value={dialogPriority} onValueChange={(v) => setDialogPriority(v as CompanyPriority)}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                {COMPANY_PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    <span className="flex items-center gap-1">
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dialogScope} onValueChange={(v) => setDialogScope(v as CompanyScope)}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                {COMPANY_SCOPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
            <p className="font-medium text-foreground/70">💡 Astuces Boolean entreprises :</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong>OR</strong> entre entreprises : <code className="text-[10px] bg-muted px-1 rounded">Accenture OR Capgemini OR McKinsey</code></li>
              <li><strong>Guillemets</strong> pour noms composés : <code className="text-[10px] bg-muted px-1 rounded">"Bearing Point" OR "Sia Partners"</code></li>
              <li><strong>AND</strong> pour combiner : <code className="text-[10px] bg-muted px-1 rounded">"Big Four" AND consulting</code></li>
              <li><strong>NOT</strong> pour exclure : <code className="text-[10px] bg-muted px-1 rounded">NOT freelance NOT startup</code></li>
            </ul>
            <p className="text-[10px] mt-1 text-muted-foreground/70">⚠️ Limite ~200 caractères. Utilisez des guillemets pour les noms avec espaces.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleDialogApply} disabled={!dialogDraft.trim()}>
              {editingIndex !== null ? 'Modifier' : 'Appliquer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
