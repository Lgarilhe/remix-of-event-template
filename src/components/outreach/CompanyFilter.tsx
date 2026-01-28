import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Search, Loader2, Plus, Building2, Type } from 'lucide-react';
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

// Options for priority (same as role)
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
  // ID-based companies
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
  
  // Mode (Recruiter shows both tabs, others only ID)
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
  const [activeTab, setActiveTab] = useState<'id' | 'keywords'>('id');
  const [newKeywords, setNewKeywords] = useState('');
  const [newPriority, setNewPriority] = useState<CompanyPriority>('MUST_HAVE');
  const [newScope, setNewScope] = useState<CompanyScope>('CURRENT_OR_PAST');

  const handleAddKeyword = () => {
    if (!newKeywords.trim()) return;
    onAddKeywordCompany({
      keywords: newKeywords.trim(),
      priority: newPriority,
      scope: newScope,
    });
    setNewKeywords('');
  };

  const totalCount = idCompanies.length + keywordCompanies.length;

  // Non-Recruiter mode: simple ID-based only
  if (!isRecruiter) {
    return (
      <div className="space-y-2">
        {/* Selected ID companies */}
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

  // Recruiter mode: dual tabs
  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'id' | 'keywords')}>
        <TabsList className="w-full h-8 p-0.5 bg-gray-100">
          <TabsTrigger 
            value="id" 
            className="flex-1 h-7 text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Building2 className="w-3 h-3" />
            Par ID
            {idCompanies.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-[#0077B5]/10 text-[#0077B5]">
                {idCompanies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="keywords" 
            className="flex-1 h-7 text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Type className="w-3 h-3" />
            Par mots-clés
            {keywordCompanies.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-[#0077B5]/10 text-[#0077B5]">
                {keywordCompanies.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ID-based tab */}
        <TabsContent value="id" className="mt-3 space-y-2">
          {/* Selected ID companies */}
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
          
          <p className="text-[10px] text-muted-foreground">
            Sélectionnez des entreprises spécifiques depuis l'autocomplete LinkedIn
          </p>
        </TabsContent>

        {/* Keywords-based tab */}
        <TabsContent value="keywords" className="mt-3 space-y-3">
          {/* Existing keyword companies */}
          {keywordCompanies.length > 0 && (
            <div className="space-y-2 mb-3">
              {keywordCompanies.map((company, index) => {
                const priorityConfig = COMPANY_PRIORITY_OPTIONS.find((p) => p.value === company.priority);
                const scopeConfig = COMPANY_SCOPE_OPTIONS.find((s) => s.value === company.scope);
                return (
                  <div 
                    key={index} 
                    className="bg-gradient-to-r from-gray-50 to-white border border-gray-100 rounded-lg p-3 shadow-sm"
                  >
                    {/* Keywords and remove button */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-[#1A1A1A] truncate flex-1 pr-2">
                        {company.keywords}
                      </span>
                      <button 
                        type="button" 
                        onClick={() => onRemoveKeywordCompany(index)} 
                        className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-1 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    
                    {/* Priority and Scope selectors */}
                    <div className="flex items-center gap-2">
                      <Select
                        value={company.priority}
                        onValueChange={(val) => onUpdateKeywordCompany(index, { priority: val as CompanyPriority })}
                      >
                        <SelectTrigger className={`h-7 flex-1 text-[11px] border-0 shadow-sm ${priorityConfig?.color}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white z-50">
                          {COMPANY_PRIORITY_OPTIONS.map((opt) => (
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
                        value={company.scope}
                        onValueChange={(val) => onUpdateKeywordCompany(index, { scope: val as CompanyScope })}
                      >
                        <SelectTrigger className="h-7 flex-1 text-[11px] border border-gray-200 bg-white shadow-sm">
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
          <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            <Input
              value={newKeywords}
              onChange={(e) => setNewKeywords(e.target.value)}
              placeholder="Ex: Google AND Meta NOT Amazon"
              className="text-sm h-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddKeyword();
                }
              }}
            />
            
            <div className="flex items-center gap-2">
              <Select value={newPriority} onValueChange={(v) => setNewPriority(v as CompanyPriority)}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white z-50">
                  {COMPANY_PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={newScope} onValueChange={(v) => setNewScope(v as CompanyScope)}>
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
              
              <Button
                type="button"
                size="sm"
                onClick={handleAddKeyword}
                disabled={!newKeywords.trim()}
                className="h-8 px-3 bg-[#0077B5] hover:bg-[#005E93]"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <p className="text-[10px] text-muted-foreground">
              Utilisez AND, NOT pour affiner: "developers AND product NOT managers"
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
