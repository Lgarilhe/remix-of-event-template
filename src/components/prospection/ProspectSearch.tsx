import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Target, Loader2, Building2, MapPin, Briefcase, Code, Zap, Globe, Users } from 'lucide-react';
import { useICPs, ICP } from '@/hooks/useICPs';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { ProspectProfile } from '@/pages/Prospection';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// PDL canonical values
const JOB_TITLE_ROLES = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'human_resources', label: 'Human Resources' },
  { value: 'product', label: 'Product' },
  { value: 'legal', label: 'Legal' },
  { value: 'health', label: 'Health' },
  { value: 'education', label: 'Education' },
  { value: 'research', label: 'Research' },
  { value: 'creative', label: 'Creative' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'partnerships', label: 'Partnerships' },
  { value: 'advisory', label: 'Advisory' },
  { value: 'fulfillment', label: 'Fulfillment' },
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'professional_service', label: 'Professional Service' },
  { value: 'public_service', label: 'Public Service' },
];

const JOB_TITLE_LEVELS = [
  { value: 'cxo', label: 'CxO' },
  { value: 'vp', label: 'VP' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
  { value: 'owner', label: 'Owner' },
  { value: 'partner', label: 'Partner' },
  { value: 'training', label: 'Training / Intern' },
  { value: 'unpaid', label: 'Unpaid' },
];

const COMPANY_SIZES = [
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '501-1000', label: '501-1000' },
  { value: '1001-5000', label: '1001-5000' },
  { value: '5001-10000', label: '5001-10000' },
  { value: '10001+', label: '10001+' },
];

const COUNTRIES = [
  { value: 'france', label: '🇫🇷 France' },
  { value: 'united states', label: '🇺🇸 États-Unis' },
  { value: 'united kingdom', label: '🇬🇧 Royaume-Uni' },
  { value: 'germany', label: '🇩🇪 Allemagne' },
  { value: 'spain', label: '🇪🇸 Espagne' },
  { value: 'italy', label: '🇮🇹 Italie' },
  { value: 'netherlands', label: '🇳🇱 Pays-Bas' },
  { value: 'belgium', label: '🇧🇪 Belgique' },
  { value: 'switzerland', label: '🇨🇭 Suisse' },
  { value: 'canada', label: '🇨🇦 Canada' },
  { value: 'australia', label: '🇦🇺 Australie' },
  { value: 'india', label: '🇮🇳 Inde' },
  { value: 'brazil', label: '🇧🇷 Brésil' },
  { value: 'singapore', label: '🇸🇬 Singapour' },
  { value: 'japan', label: '🇯🇵 Japon' },
  { value: 'israel', label: '🇮🇱 Israël' },
  { value: 'ireland', label: '🇮🇪 Irlande' },
  { value: 'sweden', label: '🇸🇪 Suède' },
  { value: 'portugal', label: '🇵🇹 Portugal' },
  { value: 'luxembourg', label: '🇱🇺 Luxembourg' },
];

// PDL canonical industries (subset of most common)
const INDUSTRIES = [
  { value: 'computer software', label: 'Software' },
  { value: 'information technology and services', label: 'IT & Services' },
  { value: 'internet', label: 'Internet' },
  { value: 'financial services', label: 'Services Financiers' },
  { value: 'marketing and advertising', label: 'Marketing & Publicité' },
  { value: 'management consulting', label: 'Conseil en Management' },
  { value: 'staffing and recruiting', label: 'Recrutement' },
  { value: 'real estate', label: 'Immobilier' },
  { value: 'health, wellness and fitness', label: 'Santé & Bien-être' },
  { value: 'hospital & health care', label: 'Hôpital & Soins' },
  { value: 'construction', label: 'Construction' },
  { value: 'retail', label: 'Retail' },
  { value: 'automotive', label: 'Automobile' },
  { value: 'telecommunications', label: 'Télécommunications' },
  { value: 'banking', label: 'Banque' },
  { value: 'insurance', label: 'Assurance' },
  { value: 'education management', label: 'Éducation' },
  { value: 'food & beverages', label: 'Alimentation' },
  { value: 'pharmaceuticals', label: 'Pharmacie' },
  { value: 'logistics and supply chain', label: 'Logistique' },
  { value: 'biotechnology', label: 'Biotechnologie' },
  { value: 'media production', label: 'Production Média' },
  { value: 'e-learning', label: 'E-Learning' },
  { value: 'venture capital & private equity', label: 'VC & Private Equity' },
];

interface ProspectSearchProps {
  selectedICP: ICP | null;
  onSelectICP: (icp: ICP | null) => void;
  onResults: (results: ProspectProfile[]) => void;
  searching: boolean;
  onSearchingChange: (v: boolean) => void;
}

export function ProspectSearch({ selectedICP, onSelectICP, onResults, searching, onSearchingChange }: ProspectSearchProps) {
  const { icps, isLoading: icpsLoading } = useICPs();

  // Search fields mapped to PDL schema
  const [jobTitle, setJobTitle] = useState('');
  const [jobTitleRole, setJobTitleRole] = useState('');
  const [jobTitleLevels, setJobTitleLevels] = useState<string[]>([]);
  const [jobCompanyName, setJobCompanyName] = useState('');
  const [jobCompanyIndustry, setJobCompanyIndustry] = useState('');
  const [jobCompanySize, setJobCompanySize] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const [locationRegion, setLocationRegion] = useState('');
  const [locationLocality, setLocationLocality] = useState('');
  const [skills, setSkills] = useState('');
  const [intentJobChange, setIntentJobChange] = useState(false);

  // Apply ICP criteria to search fields
  useEffect(() => {
    if (!selectedICP) return;
    const c = selectedICP.criteria;
    setJobTitle(c.target_titles?.join(', ') || '');
    setLocationCountry('');
    setLocationLocality(c.geographies?.join(', ') || '');
    setJobCompanyIndustry(c.industries?.[0] || '');
    setSkills(c.technologies?.join(', ') || '');
    setJobCompanySize(c.company_sizes?.[0] || '');
  }, [selectedICP]);

  const toggleLevel = (level: string) => {
    setJobTitleLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const hasFilters = jobTitle || jobTitleRole || jobTitleLevels.length > 0 || jobCompanyName || jobCompanyIndustry || (jobCompanySize && jobCompanySize !== 'all') || locationCountry || locationRegion || locationLocality || skills;

  const handleSearch = async () => {
    onSearchingChange(true);
    try {
      const payload: Record<string, any> = {};
      if (jobTitle) payload.job_title = jobTitle;
      if (jobTitleRole) payload.job_title_role = jobTitleRole;
      if (jobTitleLevels.length > 0) payload.job_title_levels = jobTitleLevels;
      if (jobCompanyName) payload.job_company_name = jobCompanyName;
      if (jobCompanyIndustry) payload.job_company_industry = jobCompanyIndustry;
      if (jobCompanySize && jobCompanySize !== 'all') payload.job_company_size = jobCompanySize;
      if (locationCountry) payload.location_country = locationCountry;
      if (locationRegion) payload.location_region = locationRegion;
      if (locationLocality) payload.location_locality = locationLocality;
      if (skills) payload.skills = skills.split(',').map(s => s.trim()).filter(Boolean);
      if (intentJobChange) payload.intent_job_change = true;
      payload.size = 50;

      const { data, error } = await invokeEdgeFunction<{ prospects: ProspectProfile[] }>('pdl-search', payload);

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur recherche');

      const prospects = (data as any).prospects || [];
      onResults(prospects);
      toast.success(`${prospects.length} prospect(s) trouvé(s)`);
    } catch (err: any) {
      console.error('[ProspectSearch] Error:', err);
      toast.error(err.message || 'Erreur lors de la recherche');
    } finally {
      onSearchingChange(false);
    }
  };

  return (
    <div className="bg-background border border-foreground p-3 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Recherche de Prospects</h2>
        </div>
      </div>

      {/* ICP selector */}
      {icps.length > 0 && (
        <div className="mb-5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Pré-remplir depuis un ICP
          </label>
          <Select
            value={selectedICP?.id || 'none'}
            onValueChange={(v) => {
              const icp = icps.find(i => i.id === v) || null;
              onSelectICP(icp);
            }}
          >
            <SelectTrigger className="h-8 border-foreground/20 max-w-sm">
              <SelectValue placeholder="Sélectionner un ICP..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Aucun —</SelectItem>
              {icps.map(icp => (
                <SelectItem key={icp.id} value={icp.id}>
                  {icp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedICP && (
            <Badge variant="outline" className="mt-2 text-[10px] border-foreground/20 gap-1">
              <Target className="w-3 h-3" /> ICP: {selectedICP.name}
            </Badge>
          )}
        </div>
      )}

      {/* Search filters grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        {/* Job Title (free text, LIKE) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Briefcase className="w-3 h-3" /> Titre du poste
          </label>
          <Input
            value={jobTitle}
            onChange={e => setJobTitle(e.target.value)}
            placeholder="CTO, Product Manager..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        {/* Job Title Role (canonical enum) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Users className="w-3 h-3" /> Fonction
          </label>
          <Select value={jobTitleRole || 'all'} onValueChange={v => setJobTitleRole(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 border-foreground/20">
              <SelectValue placeholder="Toutes fonctions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes fonctions</SelectItem>
              {JOB_TITLE_ROLES.map(r => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Company name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Entreprise
          </label>
          <Input
            value={jobCompanyName}
            onChange={e => setJobCompanyName(e.target.value)}
            placeholder="Nom d'entreprise..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        {/* Industry (canonical) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Secteur
          </label>
          <Select value={jobCompanyIndustry || 'all'} onValueChange={v => setJobCompanyIndustry(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 border-foreground/20">
              <SelectValue placeholder="Tous secteurs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous secteurs</SelectItem>
              {INDUSTRIES.map(i => (
                <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Company size (enum) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Taille entreprise
          </label>
          <Select value={jobCompanySize || 'all'} onValueChange={v => setJobCompanySize(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 border-foreground/20">
              <SelectValue placeholder="Toutes tailles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes tailles</SelectItem>
              {COMPANY_SIZES.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Country (canonical) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Globe className="w-3 h-3" /> Pays
          </label>
          <Select value={locationCountry || 'all'} onValueChange={v => setLocationCountry(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 border-foreground/20">
              <SelectValue placeholder="Tous pays" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous pays</SelectItem>
              {COUNTRIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Region / State */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Région / État
          </label>
          <Input
            value={locationRegion}
            onChange={e => setLocationRegion(e.target.value)}
            placeholder="Île-de-France, California..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        {/* City */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Ville
          </label>
          <Input
            value={locationLocality}
            onChange={e => setLocationLocality(e.target.value)}
            placeholder="Paris, Lyon, London..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        {/* Skills */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Code className="w-3 h-3" /> Compétences
          </label>
          <Input
            value={skills}
            onChange={e => setSkills(e.target.value)}
            placeholder="react, python, aws..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
          <p className="text-[10px] text-muted-foreground">Séparées par des virgules, en minuscules</p>
        </div>
      </div>

      {/* Job Title Levels - toggle chips */}
      <div className="mb-5">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1">
          <Briefcase className="w-3 h-3" /> Niveau hiérarchique
        </label>
        <div className="flex flex-wrap gap-2">
          {JOB_TITLE_LEVELS.map(level => (
            <button
              key={level.value}
              onClick={() => toggleLevel(level.value)}
              className={cn(
                "px-3 py-1.5 text-xs border transition-colors",
                jobTitleLevels.includes(level.value)
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
              )}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      {/* Intent signals */}
      <div className="mb-5">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1">
          <Zap className="w-3 h-3" /> Signaux d'intention
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIntentJobChange(!intentJobChange)}
            className={cn(
              "px-3 py-1.5 text-xs border transition-colors",
              intentJobChange
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
            )}
          >
            🔄 Changement de poste récent
          </button>
        </div>
      </div>

      {/* Search button */}
      <Button
        onClick={handleSearch}
        disabled={searching || !hasFilters}
        className="h-[34px] px-6 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium uppercase tracking-wider gap-2"
      >
        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {searching ? 'Recherche en cours...' : 'Lancer la recherche'}
      </Button>
    </div>
  );
}
