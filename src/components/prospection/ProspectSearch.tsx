import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Search, Target, Loader2, Building2, MapPin, Briefcase, Code, Zap, Globe, Users, Cpu, TrendingUp, DollarSign, GraduationCap, Mail, Clock, Sparkles, Languages, Award, Heart, FileText, Hash, Landmark, BadgeDollarSign } from 'lucide-react';
import { useICPs, ICP } from '@/hooks/useICPs';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { ProspectProfile } from '@/pages/Prospection';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── Constants ──────────────────────────────────────────────

const JOB_TITLE_ROLES = [
  { value: 'engineering', label: 'Engineering' }, { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' }, { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' }, { value: 'human_resources', label: 'Human Resources' },
  { value: 'product', label: 'Product' }, { value: 'legal', label: 'Legal' },
  { value: 'health', label: 'Health' }, { value: 'education', label: 'Education' },
  { value: 'research', label: 'Research' }, { value: 'creative', label: 'Creative' },
  { value: 'analyst', label: 'Analyst' }, { value: 'partnerships', label: 'Partnerships' },
  { value: 'advisory', label: 'Advisory' }, { value: 'fulfillment', label: 'Fulfillment' },
  { value: 'hospitality', label: 'Hospitality' }, { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'professional_service', label: 'Professional Service' }, { value: 'public_service', label: 'Public Service' },
];

const JOB_TITLE_SUB_ROLES = [
  { value: 'executive', label: 'Executive' }, { value: 'logistics', label: 'Logistique' },
  { value: 'web_development', label: 'Web Dev' }, { value: 'mobile_development', label: 'Mobile Dev' },
  { value: 'data_science', label: 'Data Science' }, { value: 'devops', label: 'DevOps' },
  { value: 'machine_learning', label: 'ML / AI' }, { value: 'security', label: 'Sécurité' },
  { value: 'qa', label: 'QA' }, { value: 'project_management', label: 'Project Mgmt' },
  { value: 'business_development', label: 'Business Dev' }, { value: 'account_management', label: 'Account Mgmt' },
  { value: 'customer_success', label: 'Customer Success' }, { value: 'sdr', label: 'SDR' },
  { value: 'content', label: 'Content' }, { value: 'seo', label: 'SEO' },
  { value: 'growth', label: 'Growth' }, { value: 'brand', label: 'Brand' },
  { value: 'social_media', label: 'Social Media' }, { value: 'design', label: 'Design' },
];

const JOB_TITLE_LEVELS = [
  { value: 'cxo', label: 'CxO' }, { value: 'vp', label: 'VP' }, { value: 'head', label: 'Head' },
  { value: 'director', label: 'Director' }, { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' }, { value: 'entry', label: 'Entry' },
  { value: 'owner', label: 'Owner' }, { value: 'founder', label: 'Founder' },
  { value: 'partner', label: 'Partner' }, { value: 'training', label: 'Intern' },
];

const JOB_TITLE_CLASSES = [
  { value: 'research_and_development', label: 'R&D' },
  { value: 'sales_and_marketing', label: 'Sales & Marketing' },
  { value: 'general_and_administrative', label: 'G&A' },
  { value: 'cost_of_goods_sold', label: 'COGS' },
];

const COMPANY_SIZES = [
  { value: '1-10', label: '1-10' }, { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' }, { value: '201-500', label: '201-500' },
  { value: '501-1000', label: '501-1000' }, { value: '1001-5000', label: '1001-5000' },
  { value: '5001-10000', label: '5001-10000' }, { value: '10001+', label: '10001+' },
];

const COMPANY_TYPES = [
  { value: 'public', label: 'Cotée (Public)' }, { value: 'private', label: 'Privée' },
  { value: 'nonprofit', label: 'Association / Non-profit' }, { value: 'government', label: 'Gouvernement' },
  { value: 'education', label: 'Éducation' }, { value: 'self-employed', label: 'Indépendant' },
];

const COUNTRIES = [
  { value: 'france', label: '🇫🇷 France' }, { value: 'united states', label: '🇺🇸 États-Unis' },
  { value: 'united kingdom', label: '🇬🇧 Royaume-Uni' }, { value: 'germany', label: '🇩🇪 Allemagne' },
  { value: 'spain', label: '🇪🇸 Espagne' }, { value: 'italy', label: '🇮🇹 Italie' },
  { value: 'netherlands', label: '🇳🇱 Pays-Bas' }, { value: 'belgium', label: '🇧🇪 Belgique' },
  { value: 'switzerland', label: '🇨🇭 Suisse' }, { value: 'canada', label: '🇨🇦 Canada' },
  { value: 'australia', label: '🇦🇺 Australie' }, { value: 'india', label: '🇮🇳 Inde' },
  { value: 'brazil', label: '🇧🇷 Brésil' }, { value: 'singapore', label: '🇸🇬 Singapour' },
  { value: 'japan', label: '🇯🇵 Japon' }, { value: 'israel', label: '🇮🇱 Israël' },
  { value: 'ireland', label: '🇮🇪 Irlande' }, { value: 'sweden', label: '🇸🇪 Suède' },
  { value: 'portugal', label: '🇵🇹 Portugal' }, { value: 'luxembourg', label: '🇱🇺 Luxembourg' },
  { value: 'poland', label: '🇵🇱 Pologne' }, { value: 'austria', label: '🇦🇹 Autriche' },
  { value: 'denmark', label: '🇩🇰 Danemark' }, { value: 'norway', label: '🇳🇴 Norvège' },
  { value: 'finland', label: '🇫🇮 Finlande' }, { value: 'united arab emirates', label: '🇦🇪 Émirats' },
  { value: 'mexico', label: '🇲🇽 Mexique' }, { value: 'south korea', label: '🇰🇷 Corée du Sud' },
  { value: 'china', label: '🇨🇳 Chine' }, { value: 'morocco', label: '🇲🇦 Maroc' },
  { value: 'south africa', label: '🇿🇦 Afrique du Sud' }, { value: 'argentina', label: '🇦🇷 Argentine' },
  { value: 'colombia', label: '🇨🇴 Colombie' }, { value: 'romania', label: '🇷🇴 Roumanie' },
  { value: 'czech republic', label: '🇨🇿 Tchéquie' }, { value: 'hungary', label: '🇭🇺 Hongrie' },
  { value: 'turkey', label: '🇹🇷 Turquie' }, { value: 'thailand', label: '🇹🇭 Thaïlande' },
  { value: 'indonesia', label: '🇮🇩 Indonésie' }, { value: 'philippines', label: '🇵🇭 Philippines' },
];

const CONTINENTS = [
  { value: 'europe', label: '🌍 Europe' }, { value: 'north america', label: '🌎 Amérique du Nord' },
  { value: 'south america', label: '🌎 Amérique du Sud' }, { value: 'asia', label: '🌏 Asie' },
  { value: 'africa', label: '🌍 Afrique' }, { value: 'oceania', label: '🌏 Océanie' },
];

const INDUSTRIES = [
  { value: 'computer software', label: 'Software' },
  { value: 'information technology and services', label: 'IT & Services' },
  { value: 'internet', label: 'Internet' }, { value: 'financial services', label: 'Services Financiers' },
  { value: 'marketing and advertising', label: 'Marketing & Publicité' },
  { value: 'management consulting', label: 'Conseil en Management' },
  { value: 'staffing and recruiting', label: 'Recrutement' },
  { value: 'real estate', label: 'Immobilier' },
  { value: 'health, wellness and fitness', label: 'Santé & Bien-être' },
  { value: 'hospital & health care', label: 'Hôpital & Soins' },
  { value: 'construction', label: 'Construction' }, { value: 'retail', label: 'Retail' },
  { value: 'automotive', label: 'Automobile' }, { value: 'telecommunications', label: 'Télécoms' },
  { value: 'banking', label: 'Banque' }, { value: 'insurance', label: 'Assurance' },
  { value: 'education management', label: 'Éducation' },
  { value: 'food & beverages', label: 'Alimentation' },
  { value: 'pharmaceuticals', label: 'Pharmacie' },
  { value: 'logistics and supply chain', label: 'Logistique' },
  { value: 'biotechnology', label: 'Biotechnologie' },
  { value: 'media production', label: 'Production Média' },
  { value: 'e-learning', label: 'E-Learning' },
  { value: 'venture capital & private equity', label: 'VC & PE' },
  { value: 'mechanical or industrial engineering', label: 'Ingénierie Industrielle' },
  { value: 'consumer electronics', label: 'Électronique' },
  { value: 'government administration', label: 'Administration Publique' },
  { value: 'civil engineering', label: 'Génie Civil' },
  { value: 'luxury goods & jewelry', label: 'Luxe' }, { value: 'hospitality', label: 'Hôtellerie' },
  { value: 'oil & energy', label: 'Énergie' },
  { value: 'renewables & environment', label: 'Énergies Renouvelables' },
  { value: 'sports', label: 'Sport' }, { value: 'entertainment', label: 'Divertissement' },
  { value: 'design', label: 'Design' }, { value: 'accounting', label: 'Comptabilité' },
  { value: 'law practice', label: 'Droit' }, { value: 'architecture & planning', label: 'Architecture' },
];

const FUNDING_STAGES = [
  { value: 'seed', label: 'Seed' }, { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' }, { value: 'series_c', label: 'Series C' },
  { value: 'series_d', label: 'Series D+' }, { value: 'ipo', label: 'IPO / Public' },
];

const REVENUE_RANGES = [
  { value: '0,1000000', label: '< 1M $' }, { value: '1000000,10000000', label: '1M - 10M $' },
  { value: '10000000,50000000', label: '10M - 50M $' },
  { value: '50000000,100000000', label: '50M - 100M $' },
  { value: '100000000,500000000', label: '100M - 500M $' },
  { value: '500000000,1000000000', label: '500M - 1B $' },
  { value: '1000000000,999999999999', label: '> 1B $' },
];

const PDL_INFERRED_REVENUE = [
  { value: '$1M-$10M', label: '1M - 10M $' }, { value: '$10M-$25M', label: '10M - 25M $' },
  { value: '$25M-$50M', label: '25M - 50M $' }, { value: '$50M-$100M', label: '50M - 100M $' },
  { value: '$100M-$250M', label: '100M - 250M $' }, { value: '$250M-$500M', label: '250M - 500M $' },
  { value: '$500M-$1B', label: '500M - 1B $' }, { value: '$1B+', label: '> 1B $' },
];

const SALARY_RANGES = [
  { value: '35,000-45,000', label: '35k - 45k $' }, { value: '45,000-55,000', label: '45k - 55k $' },
  { value: '55,000-70,000', label: '55k - 70k $' }, { value: '70,000-85,000', label: '70k - 85k $' },
  { value: '85,000-100,000', label: '85k - 100k $' }, { value: '100,000-150,000', label: '100k - 150k $' },
  { value: '150,000-250,000', label: '150k - 250k $' }, { value: '250,000+', label: '250k+ $' },
];

const EMAIL_STATUSES = [
  { value: 'verified', label: '✅ Vérifié' }, { value: 'unverified', label: '❓ Non vérifié' },
  { value: 'likely to engage', label: '🎯 Susceptible de répondre' },
];

const EXPERIENCE_RANGES = [
  { value: '0-2', label: '0-2 ans' }, { value: '3-5', label: '3-5 ans' },
  { value: '6-10', label: '6-10 ans' }, { value: '11-15', label: '11-15 ans' },
  { value: '16-25', label: '16-25 ans' }, { value: '26+', label: '26+ ans' },
];

const EDUCATION_DEGREES = [
  { value: 'bachelors', label: 'Licence / Bachelor' }, { value: 'masters', label: 'Master' },
  { value: 'phds', label: 'Doctorat / PhD' }, { value: 'associates', label: 'BTS / DUT' },
  { value: 'mbas', label: 'MBA' }, { value: 'professional', label: 'Professionnel' },
];

// ─── Reusable Sub-Components ──────────────────────────────

function FilterSection({ label, icon, hint, children }: { label: string; icon?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
        {icon}{label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChipToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn(
      "px-3 py-1.5 text-xs border transition-colors",
      active ? "bg-foreground text-background border-foreground" : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
    )}>{label}</button>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-foreground/10 pb-1">{title}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

interface ProspectSearchProps {
  selectedICP: ICP | null;
  onSelectICP: (icp: ICP | null) => void;
  onResults: (results: ProspectProfile[]) => void;
  searching: boolean;
  onSearchingChange: (v: boolean) => void;
}

type FilterTab = 'prospect' | 'entreprise';

export function ProspectSearch({ selectedICP, onSelectICP, onResults, searching, onSearchingChange }: ProspectSearchProps) {
  const { icps } = useICPs();
  const [filterTab, setFilterTab] = useState<FilterTab>('prospect');

  // ── PROSPECT FILTERS ──
  const [jobTitle, setJobTitle] = useState('');
  const [keywords, setKeywords] = useState('');
  const [jobTitleRole, setJobTitleRole] = useState('');
  const [jobTitleSubRole, setJobTitleSubRole] = useState('');
  const [jobTitleLevels, setJobTitleLevels] = useState<string[]>([]);
  const [jobTitleClass, setJobTitleClass] = useState('');
  const [includeSimilarTitles, setIncludeSimilarTitles] = useState(true);
  const [personLocations, setPersonLocations] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const [locationContinent, setLocationContinent] = useState('');
  const [locationRegion, setLocationRegion] = useState('');
  const [locationMetro, setLocationMetro] = useState('');
  const [skills, setSkills] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [inferredSalary, setInferredSalary] = useState('');
  const [educationSchool, setEducationSchool] = useState('');
  const [educationDegree, setEducationDegree] = useState('');
  const [educationMajor, setEducationMajor] = useState('');
  const [personIndustry, setPersonIndustry] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [languagesFilter, setLanguagesFilter] = useState('');
  const [certifications, setCertifications] = useState('');
  const [interests, setInterests] = useState('');
  const [summarySearch, setSummarySearch] = useState('');

  // ── ENTREPRISE FILTERS ──
  const [jobCompanyName, setJobCompanyName] = useState('');
  const [companyDomains, setCompanyDomains] = useState('');
  const [jobCompanyIndustry, setJobCompanyIndustry] = useState('');
  const [jobCompanySize, setJobCompanySize] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [companyTicker, setCompanyTicker] = useState('');
  const [orgLocations, setOrgLocations] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgRegion, setOrgRegion] = useState('');
  const [orgLocality, setOrgLocality] = useState('');
  const [technologies, setTechnologies] = useState('');
  const [techExclude, setTechExclude] = useState('');
  const [fundingStage, setFundingStage] = useState('');
  const [fundingRaisedMin, setFundingRaisedMin] = useState('');
  const [fundingRaisedMax, setFundingRaisedMax] = useState('');
  const [revenueRange, setRevenueRange] = useState('');
  const [inferredRevenue, setInferredRevenue] = useState('');
  const [companyFounded, setCompanyFounded] = useState('');
  const [employeeGrowthRate, setEmployeeGrowthRate] = useState('');
  const [hiringJobTitles, setHiringJobTitles] = useState('');
  const [hiringLocations, setHiringLocations] = useState('');
  const [numJobPostingsMin, setNumJobPostingsMin] = useState('');

  // ── INTENT SIGNALS ──
  const [intentJobChange, setIntentJobChange] = useState(false);
  const [isHiring, setIsHiring] = useState(false);
  const [employeeGrowth, setEmployeeGrowth] = useState(false);
  const [recentlyFunded, setRecentlyFunded] = useState(false);

  // Apply ICP
  useEffect(() => {
    if (!selectedICP) return;
    const c = selectedICP.criteria;
    setJobTitle(c.target_titles?.join(', ') || '');
    setPersonLocations(c.geographies?.join(', ') || '');
    setJobCompanyIndustry(c.industries?.[0] || '');
    setSkills(c.technologies?.join(', ') || '');
    setJobCompanySize(c.company_sizes?.[0] || '');
  }, [selectedICP]);

  const toggleLevel = (level: string) => {
    setJobTitleLevels(prev => prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]);
  };

  const hasVal = (v: string) => v && v !== 'all';

  const hasFilters = jobTitle || keywords || jobTitleRole || hasVal(jobTitleSubRole) || jobTitleLevels.length > 0 ||
    jobCompanyName || companyDomains || hasVal(jobCompanyIndustry) || hasVal(jobCompanySize) ||
    locationCountry || personLocations || orgLocations || skills || technologies || educationSchool ||
    hiringJobTitles || hasVal(companyType) || companyTicker || hasVal(fundingStage) || hasVal(revenueRange) ||
    hasVal(inferredRevenue) || languagesFilter || certifications || interests || summarySearch || educationMajor;

  // Count per tab
  const pCount = [jobTitle, keywords, jobTitleRole, hasVal(jobTitleSubRole), jobTitleLevels.length > 0, hasVal(jobTitleClass),
    personLocations, locationCountry, hasVal(locationContinent), locationRegion, locationMetro,
    skills, hasVal(yearsExperience), hasVal(inferredSalary), educationSchool, hasVal(educationDegree), educationMajor,
    hasVal(personIndustry), hasVal(emailStatus), languagesFilter, certifications, interests, summarySearch].filter(Boolean).length;

  const eCount = [jobCompanyName, companyDomains, hasVal(jobCompanyIndustry), hasVal(jobCompanySize), hasVal(companyType),
    companyTicker, orgLocations, hasVal(orgCountry), orgRegion, orgLocality,
    technologies, techExclude, hasVal(fundingStage), fundingRaisedMin, hasVal(revenueRange), hasVal(inferredRevenue),
    companyFounded, employeeGrowthRate, hiringJobTitles, hiringLocations, numJobPostingsMin].filter(Boolean).length;

  const handleSearch = async () => {
    onSearchingChange(true);
    try {
      const allProspects: ProspectProfile[] = [];
      const errors: string[] = [];

      // PDL payload
      const pdl: Record<string, any> = { size: 50 };
      if (jobTitle) pdl.job_title = jobTitle;
      if (jobTitleRole) pdl.job_title_role = jobTitleRole;
      if (hasVal(jobTitleSubRole)) pdl.job_title_sub_role = jobTitleSubRole;
      if (jobTitleLevels.length > 0) pdl.job_title_levels = jobTitleLevels;
      if (hasVal(jobTitleClass)) pdl.job_title_class = jobTitleClass;
      if (jobCompanyName) pdl.job_company_name = jobCompanyName;
      if (hasVal(jobCompanyIndustry)) pdl.job_company_industry = jobCompanyIndustry;
      if (hasVal(jobCompanySize)) pdl.job_company_size = jobCompanySize;
      if (hasVal(companyType)) pdl.job_company_type = companyType;
      if (companyTicker) pdl.job_company_ticker = companyTicker;
      if (locationCountry) pdl.location_country = locationCountry;
      if (hasVal(locationContinent)) pdl.location_continent = locationContinent;
      if (locationRegion) pdl.location_region = locationRegion;
      if (locationMetro) pdl.location_metro = locationMetro;
      if (personLocations) pdl.location_locality = personLocations;
      if (orgCountry) pdl.job_company_location_country = orgCountry;
      if (orgRegion) pdl.job_company_location_region = orgRegion;
      if (orgLocality) pdl.job_company_location_locality = orgLocality;
      if (skills) pdl.skills = skills.split(',').map(s => s.trim()).filter(Boolean);
      if (hasVal(yearsExperience)) pdl.years_experience = yearsExperience;
      if (hasVal(inferredSalary)) pdl.inferred_salary = inferredSalary;
      if (educationSchool) pdl.education_school = educationSchool;
      if (hasVal(educationDegree)) pdl.education_degree = educationDegree;
      if (educationMajor) pdl.education_major = educationMajor;
      if (hasVal(personIndustry)) pdl.industry = personIndustry;
      if (languagesFilter) pdl.languages = languagesFilter;
      if (certifications) pdl.certifications = certifications;
      if (interests) pdl.interests = interests;
      if (summarySearch) pdl.summary = summarySearch;
      if (companyFounded) pdl.job_company_founded = companyFounded;
      if (hasVal(inferredRevenue)) pdl.job_company_inferred_revenue = inferredRevenue;
      if (employeeGrowthRate) pdl.job_company_12mo_employee_growth_rate = employeeGrowthRate;
      if (fundingRaisedMin) pdl.job_company_total_funding_raised_min = fundingRaisedMin;
      if (fundingRaisedMax) pdl.job_company_total_funding_raised_max = fundingRaisedMax;
      if (intentJobChange) pdl.intent_job_change = true;
      if (recentlyFunded) pdl.recently_funded = true;

      // Apollo payload
      const apollo: Record<string, any> = { size: 50 };
      if (jobTitle) apollo.job_title = jobTitle;
      if (keywords) apollo.q_keywords = keywords;
      if (jobTitleRole) apollo.job_title_role = jobTitleRole;
      if (jobTitleLevels.length > 0) apollo.job_title_levels = jobTitleLevels;
      if (!includeSimilarTitles) apollo.include_similar_titles = false;
      if (jobCompanyName) apollo.job_company_name = jobCompanyName;
      if (companyDomains) apollo.company_domains = companyDomains.split(',').map(s => s.trim()).filter(Boolean);
      if (hasVal(jobCompanyIndustry)) apollo.job_company_industry = jobCompanyIndustry;
      if (hasVal(jobCompanySize)) apollo.job_company_size = jobCompanySize;
      if (locationCountry) apollo.location_country = locationCountry;
      if (personLocations) apollo.person_locations = personLocations;
      if (orgLocations) apollo.organization_locations = orgLocations;
      if (technologies) apollo.technologies = technologies.split(',').map(s => s.trim()).filter(Boolean);
      if (techExclude) apollo.tech_exclude = techExclude.split(',').map(s => s.trim()).filter(Boolean);
      if (hasVal(fundingStage)) apollo.funding_stage = fundingStage;
      if (hasVal(revenueRange)) apollo.revenue_range = revenueRange;
      if (isHiring) apollo.is_hiring = true;
      if (employeeGrowth) apollo.employee_growth = '10,100';
      if (hiringJobTitles) apollo.hiring_job_titles = hiringJobTitles.split(',').map(s => s.trim()).filter(Boolean);
      if (hiringLocations) apollo.hiring_locations = hiringLocations.split(',').map(s => s.trim()).filter(Boolean);
      if (hasVal(emailStatus)) apollo.email_status = emailStatus;
      if (numJobPostingsMin) apollo.num_jobs_min = parseInt(numJobPostingsMin);
      if (skills) apollo.skills = skills.split(',').map(s => s.trim()).filter(Boolean);

      await Promise.all([
        invokeEdgeFunction<{ prospects: ProspectProfile[] }>('pdl-search', pdl)
          .then(({ data, error }) => {
            if (error) { errors.push(`PDL: ${error.message}`); return; }
            if (!data?.success) { errors.push(`PDL: ${data?.error || 'Erreur'}`); return; }
            ((data as any).prospects || []).forEach((p: any) => { p.source = 'pdl'; allProspects.push(p); });
          }),
        invokeEdgeFunction<{ prospects: ProspectProfile[] }>('apollo-search', apollo)
          .then(({ data, error }) => {
            if (error) { errors.push(`Apollo: ${error.message}`); return; }
            if (!data?.success) { errors.push(`Apollo: ${data?.error || 'Erreur'}`); return; }
            ((data as any).prospects || []).forEach((p: any) => { p.source = 'apollo'; allProspects.push(p); });
          }),
      ]);

      // Deduplicate
      const seen = new Set<string>();
      const deduped = allProspects.filter(p => {
        if (!p.linkedin_url) return true;
        const key = p.linkedin_url.replace(/\/$/, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      onResults(deduped);
      if (errors.length > 0 && deduped.length > 0) toast.warning(`${deduped.length} prospect(s) (${errors.join('; ')})`);
      else if (errors.length > 0) toast.error(errors.join('; '));
      else toast.success(`${deduped.length} prospect(s) trouvé(s)`);
    } catch (err: any) {
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
        <Badge variant="outline" className="text-[9px] border-foreground/20 font-normal">PDL + Apollo</Badge>
      </div>

      {/* ICP selector */}
      {icps.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <Select value={selectedICP?.id || 'none'} onValueChange={(v) => onSelectICP(icps.find(i => i.id === v) || null)}>
              <SelectTrigger className="h-8 border-foreground/20 max-w-sm"><SelectValue placeholder="Pré-remplir depuis un ICP..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Aucun —</SelectItem>
                {icps.map(icp => (<SelectItem key={icp.id} value={icp.id}>{icp.name}</SelectItem>))}
              </SelectContent>
            </Select>
            {selectedICP && (<Badge variant="outline" className="text-[10px] border-foreground/20 gap-1 shrink-0"><Target className="w-3 h-3" /> {selectedICP.name}</Badge>)}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-0 mb-5">
        {([
          { value: 'prospect' as FilterTab, label: 'Prospect', emoji: '👤', count: pCount },
          { value: 'entreprise' as FilterTab, label: 'Entreprise', emoji: '🏢', count: eCount },
        ]).map((tab, index) => (
          <button key={tab.value} onClick={() => setFilterTab(tab.value)}
            className={cn(
              "flex items-center gap-1.5 h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-foreground transition-colors",
              index > 0 && "border-l-0",
              filterTab === tab.value ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"
            )}>
            <span>{tab.emoji}</span><span>{tab.label}</span>
            {tab.count > 0 && (
              <span className={cn("ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold",
                filterTab === tab.value ? "bg-background text-foreground" : "bg-foreground text-background"
              )}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ PROSPECT TAB ═══ */}
      {filterTab === 'prospect' && (
        <div className="space-y-6">
          <FilterGroup title="Poste & Fonction">
            <FilterSection label="Titre du poste" icon={<Briefcase className="w-3 h-3" />}>
              <Input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="CTO, Product Manager..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Mots-clés (profil entier)" icon={<Sparkles className="w-3 h-3" />} hint="Recherche texte libre dans tout le profil">
              <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="blockchain, SaaS, growth..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Fonction (département)" icon={<Users className="w-3 h-3" />}>
              <Select value={jobTitleRole || 'all'} onValueChange={v => setJobTitleRole(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes fonctions</SelectItem>
                  {JOB_TITLE_ROLES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Sous-fonction" icon={<Users className="w-3 h-3" />} hint="PDL: sous-rôle spécifique">
              <Select value={jobTitleSubRole || 'all'} onValueChange={v => setJobTitleSubRole(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes sous-fonctions</SelectItem>
                  {JOB_TITLE_SUB_ROLES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Classe de poste" icon={<Briefcase className="w-3 h-3" />} hint="R&D, Sales, G&A, COGS">
              <Select value={jobTitleClass || 'all'} onValueChange={v => setJobTitleClass(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes classes</SelectItem>
                  {JOB_TITLE_CLASSES.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Industrie du prospect" icon={<Building2 className="w-3 h-3" />} hint="Basée sur l'historique de carrière">
              <Select value={personIndustry || 'all'} onValueChange={v => setPersonIndustry(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes industries</SelectItem>
                  {INDUSTRIES.map(i => (<SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterGroup>

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
            <div className="flex items-center gap-2 mt-2">
              <Switch checked={includeSimilarTitles} onCheckedChange={setIncludeSimilarTitles} className="h-4 w-7" />
              <span className="text-[10px] text-muted-foreground">Inclure titres similaires</span>
            </div>
          </div>

          <FilterGroup title="Localisation du prospect">
            <FilterSection label="Ville / Localité" icon={<MapPin className="w-3 h-3" />} hint="Paris, San Francisco...">
              <Input value={personLocations} onChange={e => setPersonLocations(e.target.value)} placeholder="Paris, Lyon, London..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
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
            <FilterSection label="Continent" icon={<Globe className="w-3 h-3" />}>
              <Select value={locationContinent || 'all'} onValueChange={v => setLocationContinent(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous continents</SelectItem>
                  {CONTINENTS.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Région / État" icon={<MapPin className="w-3 h-3" />}>
              <Input value={locationRegion} onChange={e => setLocationRegion(e.target.value)} placeholder="Île-de-France, California..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Aire métro" icon={<MapPin className="w-3 h-3" />} hint="PDL: zone métropolitaine">
              <Input value={locationMetro} onChange={e => setLocationMetro(e.target.value)} placeholder="san francisco, california..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Compétences & Expérience">
            <FilterSection label="Compétences" icon={<Code className="w-3 h-3" />} hint="Séparées par des virgules">
              <Input value={skills} onChange={e => setSkills(e.target.value)} placeholder="react, python, aws, figma..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
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
            <FilterSection label="Salaire estimé (USD)" icon={<BadgeDollarSign className="w-3 h-3" />} hint="PDL: salaire inféré">
              <Select value={inferredSalary || 'all'} onValueChange={v => setInferredSalary(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous salaires</SelectItem>
                  {SALARY_RANGES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Certifications" icon={<Award className="w-3 h-3" />} hint="Nom de certification">
              <Input value={certifications} onChange={e => setCertifications(e.target.value)} placeholder="AWS, PMP, CFA..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Centres d'intérêt" icon={<Heart className="w-3 h-3" />}>
              <Input value={interests} onChange={e => setInterests(e.target.value)} placeholder="data, sustainability..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Bio / Summary" icon={<FileText className="w-3 h-3" />} hint="Recherche dans le résumé LinkedIn">
              <Input value={summarySearch} onChange={e => setSummarySearch(e.target.value)} placeholder="growth hacker, serial entrepreneur..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Formation">
            <FilterSection label="École / Université" icon={<GraduationCap className="w-3 h-3" />}>
              <Input value={educationSchool} onChange={e => setEducationSchool(e.target.value)} placeholder="HEC, Stanford, Polytechnique..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Diplôme" icon={<GraduationCap className="w-3 h-3" />}>
              <Select value={educationDegree || 'all'} onValueChange={v => setEducationDegree(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous diplômes</SelectItem>
                  {EDUCATION_DEGREES.map(d => (<SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Spécialité / Major" icon={<GraduationCap className="w-3 h-3" />} hint="computer science, finance...">
              <Input value={educationMajor} onChange={e => setEducationMajor(e.target.value)} placeholder="computer science, marketing..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Contact & Langues">
            <FilterSection label="Statut email" icon={<Mail className="w-3 h-3" />}>
              <Select value={emailStatus || 'all'} onValueChange={v => setEmailStatus(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  {EMAIL_STATUSES.map(s => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Langues parlées" icon={<Languages className="w-3 h-3" />} hint="PDL: english, french, german...">
              <Input value={languagesFilter} onChange={e => setLanguagesFilter(e.target.value)} placeholder="french, english, spanish..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>
        </div>
      )}

      {/* ═══ ENTREPRISE TAB ═══ */}
      {filterTab === 'entreprise' && (
        <div className="space-y-6">
          <FilterGroup title="Identité de l'entreprise">
            <FilterSection label="Nom d'entreprise" icon={<Building2 className="w-3 h-3" />}>
              <Input value={jobCompanyName} onChange={e => setJobCompanyName(e.target.value)} placeholder="Google, Doctolib..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Domaines web" icon={<Globe className="w-3 h-3" />} hint="Séparés par des virgules, sans www.">
              <Input value={companyDomains} onChange={e => setCompanyDomains(e.target.value)} placeholder="google.com, doctolib.fr..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Secteur d'activité" icon={<Building2 className="w-3 h-3" />}>
              <Select value={jobCompanyIndustry || 'all'} onValueChange={v => setJobCompanyIndustry(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous secteurs</SelectItem>
                  {INDUSTRIES.map(i => (<SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Type d'entreprise" icon={<Landmark className="w-3 h-3" />} hint="PDL: public, privée, associatif...">
              <Select value={companyType || 'all'} onValueChange={v => setCompanyType(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous types</SelectItem>
                  {COMPANY_TYPES.map(t => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Ticker boursier" icon={<Hash className="w-3 h-3" />} hint="PDL: AAPL, GOOG, MSFT...">
              <Input value={companyTicker} onChange={e => setCompanyTicker(e.target.value)} placeholder="GOOG, AAPL..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Taille & Effectifs">
            <FilterSection label="Taille (employés)" icon={<Users className="w-3 h-3" />}>
              <Select value={jobCompanySize || 'all'} onValueChange={v => setJobCompanySize(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes tailles</SelectItem>
                  {COMPANY_SIZES.map(s => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Croissance effectifs (12 mois)" icon={<TrendingUp className="w-3 h-3" />} hint="PDL: ex. >0.1 pour +10%">
              <Input value={employeeGrowthRate} onChange={e => setEmployeeGrowthRate(e.target.value)} placeholder=">0.1, >0.5..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Localisation du siège">
            <FilterSection label="Siège social (texte)" icon={<MapPin className="w-3 h-3" />} hint="Apollo: ville, pays">
              <Input value={orgLocations} onChange={e => setOrgLocations(e.target.value)} placeholder="Paris, San Francisco..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Pays du siège" icon={<Globe className="w-3 h-3" />} hint="PDL: filtre exact">
              <Select value={orgCountry || 'all'} onValueChange={v => setOrgCountry(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous pays</SelectItem>
                  {COUNTRIES.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Région du siège" icon={<MapPin className="w-3 h-3" />}>
              <Input value={orgRegion} onChange={e => setOrgRegion(e.target.value)} placeholder="Île-de-France, California..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Ville du siège" icon={<MapPin className="w-3 h-3" />}>
              <Input value={orgLocality} onChange={e => setOrgLocality(e.target.value)} placeholder="Paris, London..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Technologie & Stack">
            <FilterSection label="Technologies utilisées" icon={<Cpu className="w-3 h-3" />} hint="Apollo: salesforce, react, hubspot...">
              <Input value={technologies} onChange={e => setTechnologies(e.target.value)} placeholder="salesforce, react, hubspot..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Technologies exclues" icon={<Cpu className="w-3 h-3" />} hint="Apollo: exclure ces technos">
              <Input value={techExclude} onChange={e => setTechExclude(e.target.value)} placeholder="wordpress, php..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Finance & Funding">
            <FilterSection label="Stade de financement" icon={<DollarSign className="w-3 h-3" />}>
              <Select value={fundingStage || 'all'} onValueChange={v => setFundingStage(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous stades</SelectItem>
                  {FUNDING_STAGES.map(s => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Funding levé (min)" icon={<DollarSign className="w-3 h-3" />} hint="PDL: montant min en $">
              <Input value={fundingRaisedMin} onChange={e => setFundingRaisedMin(e.target.value)} placeholder="1000000" className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Funding levé (max)" icon={<DollarSign className="w-3 h-3" />}>
              <Input value={fundingRaisedMax} onChange={e => setFundingRaisedMax(e.target.value)} placeholder="50000000" className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Chiffre d'affaires (Apollo)" icon={<BadgeDollarSign className="w-3 h-3" />}>
              <Select value={revenueRange || 'all'} onValueChange={v => setRevenueRange(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous revenus</SelectItem>
                  {REVENUE_RANGES.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label="Revenu estimé (PDL)" icon={<BadgeDollarSign className="w-3 h-3" />} hint="PDL: inferred revenue">
              <Select value={inferredRevenue || 'all'} onValueChange={v => setInferredRevenue(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 border-foreground/20"><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous revenus</SelectItem>
                  {PDL_INFERRED_REVENUE.map(r => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Historique & Fondation">
            <FilterSection label="Année de fondation" icon={<Clock className="w-3 h-3" />} hint="Ex: 2015, >2020, <2010">
              <Input value={companyFounded} onChange={e => setCompanyFounded(e.target.value)} placeholder="2015, >2020..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>

          <FilterGroup title="Offres d'emploi actives (Apollo)">
            <FilterSection label="Postes ouverts (titres)" icon={<Briefcase className="w-3 h-3" />} hint="Titres dans les offres actives">
              <Input value={hiringJobTitles} onChange={e => setHiringJobTitles(e.target.value)} placeholder="Backend Engineer, Sales..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Postes ouverts (lieux)" icon={<MapPin className="w-3 h-3" />}>
              <Input value={hiringLocations} onChange={e => setHiringLocations(e.target.value)} placeholder="Paris, Remote, London..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
            <FilterSection label="Nombre min de postes ouverts" icon={<Hash className="w-3 h-3" />} hint="Apollo: min job postings">
              <Input value={numJobPostingsMin} onChange={e => setNumJobPostingsMin(e.target.value)} placeholder="5, 10, 50..." className="h-8 text-sm border-foreground/20 focus:border-foreground" />
            </FilterSection>
          </FilterGroup>
        </div>
      )}

      {/* ═══ INTENT SIGNALS ═══ */}
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
        <Button onClick={handleSearch} disabled={searching || !hasFilters}
          className="h-[34px] px-6 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium uppercase tracking-wider gap-2">
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {searching ? 'Recherche en cours...' : 'Lancer la recherche'}
        </Button>
        {(pCount + eCount) > 0 && (<span className="text-[10px] text-muted-foreground">{pCount + eCount} filtre(s) actif(s)</span>)}
      </div>
    </div>
  );
}
