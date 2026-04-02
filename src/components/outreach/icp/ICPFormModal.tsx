import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Plus, Target, Building2, MapPin, Code, Briefcase, GraduationCap, Globe, TrendingUp } from 'lucide-react';
import { ICP, ICPCriteria } from '@/hooks/useICPs';
import { cn } from '@/lib/utils';

interface ICPFormModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; description: string; target_type: 'client' | 'candidate' | 'both'; criteria: ICPCriteria }) => void;
  initialData?: ICP | null;
  saving?: boolean;
}

const INDUSTRY_SUGGESTIONS = [
  'Tech / SaaS', 'FinTech', 'HealthTech', 'E-commerce', 'Consulting', 'Industrie',
  'BTP', 'Énergie', 'Média', 'Éducation', 'Assurance', 'Immobilier', 'Transport', 'Agroalimentaire',
];

const COMPANY_SIZE_OPTIONS = [
  '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+',
];

const SENIORITY_OPTIONS = [
  'Junior', 'Confirmé', 'Senior', 'Lead', 'Manager', 'Director', 'VP', 'C-Level',
];

const FUNDING_STAGES = [
  'Bootstrap', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'IPO / Coté', 'Profitable',
];

function TagInput({ 
  label, icon: Icon, values, onChange, placeholder, suggestions 
}: { 
  label: string; icon: React.ElementType; values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[];
}) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    onChange(values.filter(v => v !== tag));
  };

  const filteredSuggestions = suggestions?.filter(
    s => s.toLowerCase().includes(input.toLowerCase()) && !values.includes(s)
  ) || [];

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </label>
      <div className="relative">
        <Input
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); addTag(input); }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={placeholder}
          className="h-8 text-sm border-border focus:border-border"
        />
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full bg-background border border-border shadow-lg max-h-32 overflow-y-auto">
            {filteredSuggestions.map(s => (
              <button
                key={s}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                onMouseDown={() => addTag(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map(tag => (
            <Badge key={tag} variant="outline" className="text-xs border-border gap-1 pr-1">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipSelect({ 
  label, icon: Icon, options, values, onChange 
}: { 
  label: string; icon: React.ElementType; options: string[]; values: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (option: string) => {
    onChange(values.includes(option) ? values.filter(v => v !== option) : [...values, option]);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            className={cn(
              "px-2.5 py-1 text-xs border transition-colors",
              values.includes(option)
                ? "bg-foreground text-background border-border"
                : "bg-background text-foreground border-border hover:border-border"
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ICPFormModal({ open, onClose, onSave, initialData, saving }: ICPFormModalProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [targetType, setTargetType] = useState<'client' | 'candidate' | 'both'>(initialData?.target_type || 'both');
  const [criteria, setCriteria] = useState<ICPCriteria>(initialData?.criteria || {});

  const updateCriteria = <K extends keyof ICPCriteria>(key: K, value: ICPCriteria[K]) => {
    setCriteria(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), target_type: targetType, criteria });
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg uppercase tracking-wide">
            <Target className="w-5 h-5" />
            {initialData ? 'Modifier l\'ICP' : 'Nouvel ICP'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider">Nom *</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Startup SaaS B2B Series A"
                className="h-9 border-border focus:border-border"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider">Type de cible</label>
              <Select value={targetType} onValueChange={(v: any) => setTargetType(v)}>
                <SelectTrigger className="h-9 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">🏢 Client / Entreprise</SelectItem>
                  <SelectItem value="candidate">👤 Candidat</SelectItem>
                  <SelectItem value="both">🎯 Les deux</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider">Description</label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Décrivez votre cible idéale en quelques mots..."
              className="min-h-[60px] text-sm border-border focus:border-border resize-none"
            />
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-4 text-muted-foreground">Critères de ciblage</h3>

            <div className="space-y-5">
              <TagInput
                label="Secteurs / Industries"
                icon={Building2}
                values={criteria.industries || []}
                onChange={v => updateCriteria('industries', v)}
                placeholder="Ajouter un secteur..."
                suggestions={INDUSTRY_SUGGESTIONS}
              />

              <ChipSelect
                label="Taille d'entreprise"
                icon={Building2}
                options={COMPANY_SIZE_OPTIONS}
                values={criteria.company_sizes || []}
                onChange={v => updateCriteria('company_sizes', v)}
              />

              <TagInput
                label="Postes ciblés"
                icon={Briefcase}
                values={criteria.target_titles || []}
                onChange={v => updateCriteria('target_titles', v)}
                placeholder="Ex: CTO, VP Engineering, DRH..."
              />

              <ChipSelect
                label="Niveau de séniorité"
                icon={Briefcase}
                options={SENIORITY_OPTIONS}
                values={criteria.seniority_levels || []}
                onChange={v => updateCriteria('seniority_levels', v)}
              />

              <TagInput
                label="Localisation"
                icon={MapPin}
                values={criteria.geographies || []}
                onChange={v => updateCriteria('geographies', v)}
                placeholder="Paris, Lyon, Remote..."
              />

              <TagInput
                label="Technologies / Compétences"
                icon={Code}
                values={criteria.technologies || []}
                onChange={v => updateCriteria('technologies', v)}
                placeholder="React, Python, AWS..."
              />

              <ChipSelect
                label="Stade de financement"
                icon={TrendingUp}
                options={FUNDING_STAGES}
                values={criteria.funding_stages || []}
                onChange={v => updateCriteria('funding_stages', v)}
              />

              <TagInput
                label="Langues"
                icon={Globe}
                values={criteria.languages || []}
                onChange={v => updateCriteria('languages', v)}
                placeholder="Français, Anglais..."
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5" /> Expérience min (ans)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={criteria.experience_range?.min ?? ''}
                    onChange={e => updateCriteria('experience_range', { ...criteria.experience_range, min: e.target.value ? Number(e.target.value) : undefined })}
                    className="h-8 text-sm border-border"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5" /> Expérience max (ans)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={criteria.experience_range?.max ?? ''}
                    onChange={e => updateCriteria('experience_range', { ...criteria.experience_range, max: e.target.value ? Number(e.target.value) : undefined })}
                    className="h-8 text-sm border-border"
                    placeholder="15"
                  />
                </div>
              </div>

              <TagInput
                label="Mots-clés"
                icon={Target}
                values={criteria.keywords || []}
                onChange={v => updateCriteria('keywords', v)}
                placeholder="SaaS, B2B, Scale-up..."
              />

              <TagInput
                label="Mots-clés à exclure"
                icon={X}
                values={criteria.exclusion_keywords || []}
                onChange={v => updateCriteria('exclusion_keywords', v)}
                placeholder="Freelance, Consulting..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose} className="border-border">
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || saving}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {saving ? 'Enregistrement...' : (initialData ? 'Mettre à jour' : 'Créer l\'ICP')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
