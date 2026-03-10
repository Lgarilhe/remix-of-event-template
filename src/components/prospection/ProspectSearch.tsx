import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Target, Loader2, Building2, MapPin, Briefcase, Code, Zap, Globe, Users, Cpu, TrendingUp, DollarSign } from 'lucide-react';
import { useICPs, ICP } from '@/hooks/useICPs';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { ProspectProfile } from '@/pages/Prospection';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Source types
type SearchSource = 'pdl' | 'apollo' | 'both';

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

const FUNDING_STAGES = [
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' },
  { value: 'series_c', label: 'Series C' },
  { value: 'series_d', label: 'Series D+' },
  { value: 'ipo', label: 'IPO' },
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

  // Always search both sources
  const source: SearchSource = 'both';
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
  
  // Intent signals (common)
  const [intentJobChange, setIntentJobChange] = useState(false);
  
  // Apollo-specific filters
  const [technologies, setTechnologies] = useState('');
  const [isHiring, setIsHiring] = useState(false);
  const [fundingStage, setFundingStage] = useState('');
  const [employeeGrowth, setEmployeeGrowth] = useState(false);

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

  const hasFilters = jobTitle || jobTitleRole || jobTitleLevels.length > 0 || jobCompanyName || jobCompanyIndustry || (jobCompanySize && jobCompanySize !== 'all') || locationCountry || locationRegion || locationLocality || skills || technologies;

  const buildCommonPayload = () => {
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
    return payload;
  };

  const buildApolloPayload = () => {
    const payload = buildCommonPayload();
    if (technologies) payload.technologies = technologies.split(',').map(s => s.trim()).filter(Boolean);
    if (isHiring) payload.is_hiring = true;
    if (fundingStage && fundingStage !== 'all') payload.funding_stage = fundingStage;
    if (employeeGrowth) payload.employee_growth = '10,100'; // 10%+ growth
    return payload;
  };

  const handleSearch = async () => {
    onSearchingChange(true);
    try {
      const allProspects: ProspectProfile[] = [];
      const errors: string[] = [];

      const searchPDL = true;
      const searchApollo = true;

      // Run searches in parallel
      const promises: Promise<void>[] = [];

      if (searchPDL) {
        promises.push(
          invokeEdgeFunction<{ prospects: ProspectProfile[] }>('pdl-search', buildCommonPayload())
            .then(({ data, error }) => {
              if (error) { errors.push(`PDL: ${error.message}`); return; }
              if (!data?.success) { errors.push(`PDL: ${data?.error || 'Erreur'}`); return; }
              const prospects = (data as any).prospects || [];
              prospects.forEach((p: any) => { p.source = 'pdl'; });
              allProspects.push(...prospects);
            })
        );
      }

      if (searchApollo) {
        promises.push(
          invokeEdgeFunction<{ prospects: ProspectProfile[] }>('apollo-search', buildApolloPayload())
            .then(({ data, error }) => {
              if (error) { errors.push(`Apollo: ${error.message}`); return; }
              if (!data?.success) { errors.push(`Apollo: ${data?.error || 'Erreur'}`); return; }
              const prospects = (data as any).prospects || [];
              prospects.forEach((p: any) => { p.source = 'apollo'; });
              allProspects.push(...prospects);
            })
        );
      }

      await Promise.all(promises);

      // Deduplicate by LinkedIn URL
      const seen = new Set<string>();
      const dedupedProspects = allProspects.filter(p => {
        if (!p.linkedin_url) return true;
        const key = p.linkedin_url.replace(/\/$/, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      onResults(dedupedProspects);

      if (errors.length > 0 && dedupedProspects.length > 0) {
        toast.warning(`${dedupedProspects.length} prospect(s) trouvé(s) (${errors.join('; ')})`);
      } else if (errors.length > 0) {
        toast.error(errors.join('; '));
      } else {
        const sources = [];
        if (searchPDL) sources.push('PDL');
        if (searchApollo) sources.push('Apollo');
        toast.success(`${dedupedProspects.length} prospect(s) trouvé(s) via ${sources.join(' + ')}`);
      }
    } catch (err: any) {
      console.error('[ProspectSearch] Error:', err);
      toast.error(err.message || 'Erreur lors de la recherche');
    } finally {
      onSearchingChange(false);
    }
  };

  const showApolloFilters = source === 'apollo' || source === 'both';

  return (
    <div className="bg-background border border-foreground p-3 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Recherche de Prospects</h2>
        </div>
      </div>

      {/* Source selector */}
      <div className="mb-5">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
          Source de données
        </label>
        <div className="flex gap-0">
          {([
            { value: 'both', label: 'PDL + Apollo', emoji: '⚡' },
            { value: 'pdl', label: 'PDL', emoji: '🔬' },
            { value: 'apollo', label: 'Apollo', emoji: '🚀' },
          ] as const).map((s, index) => (
            <button
              key={s.value}
              onClick={() => setSource(s.value)}
              className={cn(
                "px-4 py-2 text-xs font-medium uppercase tracking-wider border border-foreground transition-colors",
                index > 0 && "border-l-0",
                source === s.value
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-muted"
              )}
            >
              <span className="mr-1.5">{s.emoji}</span>
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {source === 'both' && 'Recherche combinée avec déduplication automatique par LinkedIn URL'}
          {source === 'pdl' && 'PeopleDataLabs — enrichissement profond (skills, éducation, expérience)'}
          {source === 'apollo' && 'Apollo.io — intent signals, technographies, hiring intent'}
        </p>
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

      {/* Common search filters grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
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
          <p className="text-[10px] text-muted-foreground">Séparées par des virgules</p>
        </div>
      </div>

      {/* Apollo-specific filters */}
      {showApolloFilters && (
        <div className="mb-5 p-3 border border-dashed border-foreground/20 bg-muted/30">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm">🚀</span>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filtres Apollo exclusifs</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
                <Cpu className="w-3 h-3" /> Technologies
              </label>
              <Input
                value={technologies}
                onChange={e => setTechnologies(e.target.value)}
                placeholder="React, Salesforce, HubSpot..."
                className="h-8 text-sm border-foreground/20 focus:border-foreground"
              />
              <p className="text-[10px] text-muted-foreground">Technologies utilisées par l'entreprise</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Stade de financement
              </label>
              <Select value={fundingStage || 'all'} onValueChange={v => setFundingStage(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20">
                  <SelectValue placeholder="Tous stades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous stades</SelectItem>
                  {FUNDING_STAGES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Job Title Levels */}
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
          {showApolloFilters && (
            <>
              <button
                onClick={() => setIsHiring(!isHiring)}
                className={cn(
                  "px-3 py-1.5 text-xs border transition-colors",
                  isHiring
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
                )}
              >
                📢 Entreprise recrute
              </button>
              <button
                onClick={() => setEmployeeGrowth(!employeeGrowth)}
                className={cn(
                  "px-3 py-1.5 text-xs border transition-colors",
                  employeeGrowth
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
                )}
              >
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Croissance rapide (+10%)
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search button */}
      <Button
        onClick={handleSearch}
        disabled={searching || !hasFilters}
        className="h-[34px] px-6 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium uppercase tracking-wider gap-2"
      >
        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {searching ? 'Recherche en cours...' : `Rechercher via ${source === 'both' ? 'PDL + Apollo' : source === 'pdl' ? 'PDL' : 'Apollo'}`}
      </Button>
    </div>
  );
}
