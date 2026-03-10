import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Target, Loader2, Building2, MapPin, Briefcase, Code, Zap, Globe, Users, Cpu, TrendingUp, DollarSign, GraduationCap, Mail, Clock, Sparkles } from 'lucide-react';
import { useICPs, ICP } from '@/hooks/useICPs';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { ProspectProfile } from '@/pages/Prospection';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── Constants ──────────────────────────────────────────────

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
  { value: 'head', label: 'Head' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
  { value: 'owner', label: 'Owner' },
  { value: 'founder', label: 'Founder' },
  { value: 'partner', label: 'Partner' },
  { value: 'training', label: 'Intern' },
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
  { value: 'poland', label: '🇵🇱 Pologne' },
  { value: 'austria', label: '🇦🇹 Autriche' },
  { value: 'denmark', label: '🇩🇰 Danemark' },
  { value: 'norway', label: '🇳🇴 Norvège' },
  { value: 'finland', label: '🇫🇮 Finlande' },
  { value: 'united arab emirates', label: '🇦🇪 Émirats' },
  { value: 'mexico', label: '🇲🇽 Mexique' },
  { value: 'south korea', label: '🇰🇷 Corée du Sud' },
  { value: 'china', label: '🇨🇳 Chine' },
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
  { value: 'mechanical or industrial engineering', label: 'Ingénierie Industrielle' },
  { value: 'consumer electronics', label: 'Électronique' },
  { value: 'government administration', label: 'Administration Publique' },
  { value: 'civil engineering', label: 'Génie Civil' },
  { value: 'luxury goods & jewelry', label: 'Luxe' },
  { value: 'hospitality', label: 'Hôtellerie' },
  { value: 'oil & energy', label: 'Énergie' },
  { value: 'renewables & environment', label: 'Énergies Renouvelables' },
];

const FUNDING_STAGES = [
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' },
  { value: 'series_c', label: 'Series C' },
  { value: 'series_d', label: 'Series D+' },
  { value: 'ipo', label: 'IPO / Public' },
];

const REVENUE_RANGES = [
  { value: '0,1000000', label: '< 1M $' },
  { value: '1000000,10000000', label: '1M - 10M $' },
  { value: '10000000,50000000', label: '10M - 50M $' },
  { value: '50000000,100000000', label: '50M - 100M $' },
  { value: '100000000,500000000', label: '100M - 500M $' },
  { value: '500000000,1000000000', label: '500M - 1B $' },
  { value: '1000000000,999999999999', label: '> 1B $' },
];

const EMAIL_STATUSES = [
  { value: 'verified', label: '✅ Vérifié' },
  { value: 'unverified', label: '❓ Non vérifié' },
  { value: 'likely to engage', label: '🎯 Susceptible de répondre' },
];

const EXPERIENCE_RANGES = [
  { value: '0-2', label: '0-2 ans' },
  { value: '3-5', label: '3-5 ans' },
  { value: '6-10', label: '6-10 ans' },
  { value: '11-15', label: '11-15 ans' },
  { value: '16+', label: '16+ ans' },
];

// ─── Component ──────────────────────────────────────────────

interface ProspectSearchProps {
  selectedICP: ICP | null;
  onSelectICP: (icp: ICP | null) => void;
  onResults: (results: ProspectProfile[]) => void;
  searching: boolean;
  onSearchingChange: (v: boolean) => void;
}

type FilterTab = 'prospect' | 'entreprise';

function FilterSection({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
        {icon}{label}
      </label>
      {children}
    </div>
  );
}

function ChipToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs border transition-colors",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
      )}
    >
      {label}
    </button>
  );
}

export function ProspectSearch({ selectedICP, onSelectICP, onResults, searching, onSearchingChange }: ProspectSearchProps) {
  const { icps } = useICPs();
  const [filterTab, setFilterTab] = useState<FilterTab>('prospect');

  // ── Prospect filters ──
  const [jobTitle, setJobTitle] = useState('');
  const [keywords, setKeywords] = useState('');
  const [jobTitleRole, setJobTitleRole] = useState('');
  const [jobTitleLevels, setJobTitleLevels] = useState<string[]>([]);
  const [personLocations, setPersonLocations] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const [skills, setSkills] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [education, setEducation] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [languages, setLanguages] = useState('');

  // ── Entreprise filters ──
  const [jobCompanyName, setJobCompanyName] = useState('');
  const [companyDomains, setCompanyDomains] = useState('');
  const [jobCompanyIndustry, setJobCompanyIndustry] = useState('');
  const [jobCompanySize, setJobCompanySize] = useState('');
  const [orgLocations, setOrgLocations] = useState('');
  const [technologies, setTechnologies] = useState('');
  const [fundingStage, setFundingStage] = useState('');
  const [revenueRange, setRevenueRange] = useState('');
  const [companyFounded, setCompanyFounded] = useState('');
  const [hiringJobTitles, setHiringJobTitles] = useState('');
  const [hiringLocations, setHiringLocations] = useState('');

  // ── Intent signals ──
  const [intentJobChange, setIntentJobChange] = useState(false);
  const [isHiring, setIsHiring] = useState(false);
  const [employeeGrowth, setEmployeeGrowth] = useState(false);
  const [recentlyFunded, setRecentlyFunded] = useState(false);

  // Apply ICP
  useEffect(() => {
    if (!selectedICP) return;
    const c = selectedICP.criteria;
    setJobTitle(c.target_titles?.join(', ') || '');
    setLocationCountry('');
    setPersonLocations(c.geographies?.join(', ') || '');
    setJobCompanyIndustry(c.industries?.[0] || '');
    setSkills(c.technologies?.join(', ') || '');
    setJobCompanySize(c.company_sizes?.[0] || '');
  }, [selectedICP]);

  const toggleLevel = (level: string) => {
    setJobTitleLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const hasFilters = jobTitle || keywords || jobTitleRole || jobTitleLevels.length > 0 || jobCompanyName || companyDomains || jobCompanyIndustry || (jobCompanySize && jobCompanySize !== 'all') || locationCountry || personLocations || orgLocations || skills || technologies || hiringJobTitles || education;

  // Count active filters per tab
  const prospectFilterCount = [jobTitle, keywords, jobTitleRole, jobTitleLevels.length > 0, personLocations, locationCountry, skills, yearsExperience && yearsExperience !== 'all', education, emailStatus && emailStatus !== 'all', languages].filter(Boolean).length;
  const entrepriseFilterCount = [jobCompanyName, companyDomains, jobCompanyIndustry, jobCompanySize && jobCompanySize !== 'all', orgLocations, technologies, fundingStage && fundingStage !== 'all', revenueRange && revenueRange !== 'all', companyFounded, hiringJobTitles, hiringLocations].filter(Boolean).length;

  const handleSearch = async () => {
    onSearchingChange(true);
    try {
      const allProspects: ProspectProfile[] = [];
      const errors: string[] = [];

      // Build PDL payload
      const pdlPayload: Record<string, any> = { size: 50 };
      if (jobTitle) pdlPayload.job_title = jobTitle;
      if (jobTitleRole) pdlPayload.job_title_role = jobTitleRole;
      if (jobTitleLevels.length > 0) pdlPayload.job_title_levels = jobTitleLevels;
      if (jobCompanyName) pdlPayload.job_company_name = jobCompanyName;
      if (jobCompanyIndustry) pdlPayload.job_company_industry = jobCompanyIndustry;
      if (jobCompanySize && jobCompanySize !== 'all') pdlPayload.job_company_size = jobCompanySize;
      if (locationCountry) pdlPayload.location_country = locationCountry;
      if (personLocations) pdlPayload.location_locality = personLocations;
      if (skills) pdlPayload.skills = skills.split(',').map(s => s.trim()).filter(Boolean);
      if (intentJobChange) pdlPayload.intent_job_change = true;
      if (yearsExperience && yearsExperience !== 'all') pdlPayload.years_experience = yearsExperience;
      if (education) pdlPayload.education_school = education;
      if (companyFounded) pdlPayload.job_company_founded = companyFounded;
      if (recentlyFunded) pdlPayload.recently_funded = true;

      // Build Apollo payload
      const apolloPayload: Record<string, any> = { size: 50 };
      if (jobTitle) apolloPayload.job_title = jobTitle;
      if (keywords) apolloPayload.q_keywords = keywords;
      if (jobTitleRole) apolloPayload.job_title_role = jobTitleRole;
      if (jobTitleLevels.length > 0) apolloPayload.job_title_levels = jobTitleLevels;
      if (jobCompanyName) apolloPayload.job_company_name = jobCompanyName;
      if (companyDomains) apolloPayload.company_domains = companyDomains.split(',').map(s => s.trim()).filter(Boolean);
      if (jobCompanyIndustry) apolloPayload.job_company_industry = jobCompanyIndustry;
      if (jobCompanySize && jobCompanySize !== 'all') apolloPayload.job_company_size = jobCompanySize;
      if (locationCountry) apolloPayload.location_country = locationCountry;
      if (personLocations) apolloPayload.person_locations = personLocations;
      if (orgLocations) apolloPayload.organization_locations = orgLocations;
      if (technologies) apolloPayload.technologies = technologies.split(',').map(s => s.trim()).filter(Boolean);
      if (fundingStage && fundingStage !== 'all') apolloPayload.funding_stage = fundingStage;
      if (revenueRange && revenueRange !== 'all') apolloPayload.revenue_range = revenueRange;
      if (isHiring) apolloPayload.is_hiring = true;
      if (employeeGrowth) apolloPayload.employee_growth = '10,100';
      if (hiringJobTitles) apolloPayload.hiring_job_titles = hiringJobTitles.split(',').map(s => s.trim()).filter(Boolean);
      if (hiringLocations) apolloPayload.hiring_locations = hiringLocations.split(',').map(s => s.trim()).filter(Boolean);
      if (emailStatus && emailStatus !== 'all') apolloPayload.email_status = emailStatus;
      if (skills) apolloPayload.skills = skills.split(',').map(s => s.trim()).filter(Boolean);

      // Run in parallel
      await Promise.all([
        invokeEdgeFunction<{ prospects: ProspectProfile[] }>('pdl-search', pdlPayload)
          .then(({ data, error }) => {
            if (error) { errors.push(`PDL: ${error.message}`); return; }
            if (!data?.success) { errors.push(`PDL: ${data?.error || 'Erreur'}`); return; }
            const prospects = (data as any).prospects || [];
            prospects.forEach((p: any) => { p.source = 'pdl'; });
            allProspects.push(...prospects);
          }),
        invokeEdgeFunction<{ prospects: ProspectProfile[] }>('apollo-search', apolloPayload)
          .then(({ data, error }) => {
            if (error) { errors.push(`Apollo: ${error.message}`); return; }
            if (!data?.success) { errors.push(`Apollo: ${data?.error || 'Erreur'}`); return; }
            const prospects = (data as any).prospects || [];
            prospects.forEach((p: any) => { p.source = 'apollo'; });
            allProspects.push(...prospects);
          }),
      ]);

      // Deduplicate by LinkedIn URL
      const seen = new Set<string>();
      const deduped = allProspects.filter(p => {
        if (!p.linkedin_url) return true;
        const key = p.linkedin_url.replace(/\/$/, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      onResults(deduped);

      if (errors.length > 0 && deduped.length > 0) {
        toast.warning(`${deduped.length} prospect(s) (${errors.join('; ')})`);
      } else if (errors.length > 0 && deduped.length === 0) {
        toast.error(errors.join('; '));
      } else {
        toast.success(`${deduped.length} prospect(s) trouvé(s)`);
      }
    } catch (err: any) {
      console.error('[ProspectSearch] Error:', err);
      toast.error(err.message || 'Erreur lors de la recherche');
    } finally {
      onSearchingChange(false);
    }
  };

  return (
    <div className="bg-background border border-foreground p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Recherche de Prospects</h2>
        </div>
        <Badge variant="outline" className="text-[9px] border-foreground/20 font-normal">
          PDL + Apollo combinés
        </Badge>
      </div>

      {/* ICP selector */}
      {icps.length > 0 && (
        <div className="mb-4">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Pré-remplir depuis un ICP
          </label>
          <div className="flex items-center gap-2">
            <Select
              value={selectedICP?.id || 'none'}
              onValueChange={(v) => onSelectICP(icps.find(i => i.id === v) || null)}
            >
              <SelectTrigger className="h-8 border-foreground/20 max-w-sm">
                <SelectValue placeholder="Sélectionner un ICP..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Aucun —</SelectItem>
                {icps.map(icp => (
                  <SelectItem key={icp.id} value={icp.id}>{icp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedICP && (
              <Badge variant="outline" className="text-[10px] border-foreground/20 gap-1 shrink-0">
                <Target className="w-3 h-3" /> {selectedICP.name}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-0 mb-4">
        {([
          { value: 'prospect' as FilterTab, label: 'Prospect', emoji: '👤', count: prospectFilterCount },
          { value: 'entreprise' as FilterTab, label: 'Entreprise', emoji: '🏢', count: entrepriseFilterCount },
        ]).map((tab, index) => (
          <button
            key={tab.value}
            onClick={() => setFilterTab(tab.value)}
            className={cn(
              "flex items-center gap-1.5 h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-foreground transition-colors",
              index > 0 && "border-l-0",
              filterTab === tab.value
                ? "bg-foreground text-background"
                : "bg-background text-foreground hover:bg-muted"
            )}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span className={cn(
                "ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold",
                filterTab === tab.value
                  ? "bg-background text-foreground"
                  : "bg-foreground text-background"
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ PROSPECT TAB ═══ */}
      {filterTab === 'prospect' && (
        <div className="space-y-5">
          {/* Primary filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FilterSection label="Titre du poste" icon={<Briefcase className="w-3 h-3" />}>
              <Input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="CTO, Product Manager..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>

            <FilterSection label="Mots-clés" icon={<Sparkles className="w-3 h-3" />}>
              <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="blockchain, SaaS, growth..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Recherche dans tout le profil</p>
            </FilterSection>

            <FilterSection label="Fonction" icon={<Users className="w-3 h-3" />}>
              <Select value={jobTitleRole || 'all'} onValueChange={v => setJobTitleRole(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes fonctions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes fonctions</SelectItem>
                  {JOB_TITLE_ROLES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Localisation prospect" icon={<MapPin className="w-3 h-3" />}>
              <Input value={personLocations} onChange={e => setPersonLocations(e.target.value)} placeholder="Paris, California, UK..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Ville, région ou pays</p>
            </FilterSection>

            <FilterSection label="Pays" icon={<Globe className="w-3 h-3" />}>
              <Select value={locationCountry || 'all'} onValueChange={v => setLocationCountry(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous pays" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous pays</SelectItem>
                  {COUNTRIES.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Compétences" icon={<Code className="w-3 h-3" />}>
              <Input value={skills} onChange={e => setSkills(e.target.value)} placeholder="react, python, aws, figma..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Séparées par des virgules</p>
            </FilterSection>

            <FilterSection label="Années d'expérience" icon={<Clock className="w-3 h-3" />}>
              <Select value={yearsExperience || 'all'} onValueChange={v => setYearsExperience(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {EXPERIENCE_RANGES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Formation / École" icon={<GraduationCap className="w-3 h-3" />}>
              <Input value={education} onChange={e => setEducation(e.target.value)} placeholder="HEC, Stanford, Polytechnique..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>

            <FilterSection label="Statut email" icon={<Mail className="w-3 h-3" />}>
              <Select value={emailStatus || 'all'} onValueChange={v => setEmailStatus(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous statuts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  {EMAIL_STATUSES.map(s => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
          </div>

          {/* Seniority chips */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1">
              <Briefcase className="w-3 h-3" /> Niveau hiérarchique
            </label>
            <div className="flex flex-wrap gap-2">
              {JOB_TITLE_LEVELS.map(level => (
                <ChipToggle key={level.value} label={level.label} active={jobTitleLevels.includes(level.value)} onClick={() => toggleLevel(level.value)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ ENTREPRISE TAB ═══ */}
      {filterTab === 'entreprise' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FilterSection label="Nom d'entreprise" icon={<Building2 className="w-3 h-3" />}>
              <Input value={jobCompanyName} onChange={e => setJobCompanyName(e.target.value)} placeholder="Google, Doctolib..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>

            <FilterSection label="Domaines web" icon={<Globe className="w-3 h-3" />}>
              <Input value={companyDomains} onChange={e => setCompanyDomains(e.target.value)} placeholder="google.com, doctolib.fr..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Séparés par des virgules, sans www.</p>
            </FilterSection>

            <FilterSection label="Secteur d'activité" icon={<Building2 className="w-3 h-3" />}>
              <Select value={jobCompanyIndustry || 'all'} onValueChange={v => setJobCompanyIndustry(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous secteurs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous secteurs</SelectItem>
                  {INDUSTRIES.map(i => (<SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Taille (employés)" icon={<Users className="w-3 h-3" />}>
              <Select value={jobCompanySize || 'all'} onValueChange={v => setJobCompanySize(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes tailles" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes tailles</SelectItem>
                  {COMPANY_SIZES.map(s => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Siège social" icon={<MapPin className="w-3 h-3" />}>
              <Input value={orgLocations} onChange={e => setOrgLocations(e.target.value)} placeholder="Paris, San Francisco..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Localisation du siège</p>
            </FilterSection>

            <FilterSection label="Technologies utilisées" icon={<Cpu className="w-3 h-3" />}>
              <Input value={technologies} onChange={e => setTechnologies(e.target.value)} placeholder="salesforce, react, hubspot..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Stack technique de l'entreprise</p>
            </FilterSection>

            <FilterSection label="Stade de financement" icon={<DollarSign className="w-3 h-3" />}>
              <Select value={fundingStage || 'all'} onValueChange={v => setFundingStage(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous stades" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous stades</SelectItem>
                  {FUNDING_STAGES.map(s => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Chiffre d'affaires" icon={<DollarSign className="w-3 h-3" />}>
              <Select value={revenueRange || 'all'} onValueChange={v => setRevenueRange(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous revenus" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous revenus</SelectItem>
                  {REVENUE_RANGES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Année de fondation" icon={<Clock className="w-3 h-3" />}>
              <Input value={companyFounded} onChange={e => setCompanyFounded(e.target.value)} placeholder="2015, >2020..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>

            <FilterSection label="Postes ouverts (titres)" icon={<Briefcase className="w-3 h-3" />}>
              <Input value={hiringJobTitles} onChange={e => setHiringJobTitles(e.target.value)} placeholder="Backend Engineer, Sales..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Titres dans les offres actives</p>
            </FilterSection>

            <FilterSection label="Postes ouverts (lieux)" icon={<MapPin className="w-3 h-3" />}>
              <Input value={hiringLocations} onChange={e => setHiringLocations(e.target.value)} placeholder="Paris, Remote, London..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
              <p className="text-[10px] text-muted-foreground">Lieux des offres d'emploi</p>
            </FilterSection>
          </div>
        </div>
      )}

      {/* ═══ INTENT SIGNALS (always visible) ═══ */}
      <div className="mt-5 pt-4 border-t border-foreground/10">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1">
          <Zap className="w-3 h-3" /> Signaux d'intention
        </label>
        <div className="flex flex-wrap gap-2">
          <ChipToggle label="🔄 Changement de poste récent" active={intentJobChange} onClick={() => setIntentJobChange(!intentJobChange)} />
          <ChipToggle label="📢 Entreprise recrute" active={isHiring} onClick={() => setIsHiring(!isHiring)} />
          <ChipToggle label="📈 Croissance rapide (+10%)" active={employeeGrowth} onClick={() => setEmployeeGrowth(!employeeGrowth)} />
          <ChipToggle label="💰 Levée de fonds récente" active={recentlyFunded} onClick={() => setRecentlyFunded(!recentlyFunded)} />
        </div>
      </div>

      {/* Search button */}
      <div className="mt-5 flex items-center gap-3">
        <Button
          onClick={handleSearch}
          disabled={searching || !hasFilters}
          className="h-[34px] px-6 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium uppercase tracking-wider gap-2"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {searching ? 'Recherche en cours...' : 'Lancer la recherche'}
        </Button>
        {(prospectFilterCount + entrepriseFilterCount) > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {prospectFilterCount + entrepriseFilterCount} filtre(s) actif(s)
          </span>
        )}
      </div>
    </div>
  );
}
