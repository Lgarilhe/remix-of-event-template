/**
 * Company classification from LinkedIn data (via Unipile search results)
 * Classifies companies as: consulting/esn, startup, scaleup, enterprise, other
 * No external API needed — uses data already in search results + company profiles
 */

export type CompanyType = 'consulting' | 'startup' | 'scaleup' | 'enterprise' | 'other';

export interface CompanyClassification {
  type: CompanyType;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

// Industries that indicate consulting/ESN/staffing
const CONSULTING_INDUSTRIES = [
  'it services and it consulting',
  'staffing and recruiting',
  'outsourcing',
  'outsourcing/offshoring',
  'information technology & services',
  'management consulting',
  'business consulting and services',
  'human resources services',
  'temporary help services',
  'professional services',
  'consulting',
  'it consulting',
];

// Keywords in company name/description that indicate consulting/ESN
const CONSULTING_NAME_KEYWORDS = [
  'consulting', 'consultants', 'conseil', 'services', 'solutions',
  'outsourcing', 'staffing', 'intérim', 'interim', 'ssii', 'esn',
  'technology services', 'digital services', 'managed services',
  'talent', 'recruitment', 'recrutement', 'placement',
];

// Funding stages that indicate startup/scaleup
const EARLY_FUNDING = ['seed', 'pre-seed', 'angel', 'series_a', 'series a', 'series_b', 'series b'];
const GROWTH_FUNDING = ['series_c', 'series c', 'series_d', 'series d', 'series_e', 'series e', 'series_f', 'ipo'];

const TYPE_LABELS: Record<CompanyType, string> = {
  consulting: '🏢 ESN / Consulting',
  startup: '🚀 Startup',
  scaleup: '📈 Scale-up',
  enterprise: '🏛️ Enterprise',
  other: '🏠 Autre',
};

/**
 * Classify a company based on available data from LinkedIn/Unipile
 */
export function classifyCompany(data: {
  name?: string;
  description?: string;
  industry?: string | string[];
  employee_count?: number;
  employee_count_range?: { from?: number; to?: number };
  organization_type?: string;
  foundation_date?: string;
  crunchbase_funding?: {
    rounds?: {
      total_count?: number;
      last_round?: {
        funding_type?: string;
        announced_on?: string;
        money_raised?: { amount?: number };
      };
    };
  };
  headcount_growth?: number;
}): CompanyClassification {
  const signals: string[] = [];
  let type: CompanyType = 'other';
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const name = (data.name || '').toLowerCase();
  const description = (data.description || '').toLowerCase();
  const industries = Array.isArray(data.industry) ? data.industry.map(i => i.toLowerCase()) : [(data.industry || '').toLowerCase()];
  const headcount = data.employee_count || data.employee_count_range?.to || 0;
  const fundingType = data.crunchbase_funding?.rounds?.last_round?.funding_type?.toLowerCase() || '';
  const fundingCount = data.crunchbase_funding?.rounds?.total_count || 0;
  const orgType = (data.organization_type || '').toLowerCase();
  const foundedYear = data.foundation_date ? parseInt(data.foundation_date) : 0;
  const companyAge = foundedYear > 0 ? new Date().getFullYear() - foundedYear : 0;

  // ─── Check Consulting/ESN ───
  const isConsultingIndustry = industries.some(ind =>
    CONSULTING_INDUSTRIES.some(ci => ind.includes(ci))
  );
  const hasConsultingName = CONSULTING_NAME_KEYWORDS.some(kw =>
    name.includes(kw) || description.includes(kw)
  );

  if (isConsultingIndustry && hasConsultingName) {
    type = 'consulting';
    confidence = 'high';
    signals.push('Industry + nom indiquent consulting/ESN');
  } else if (isConsultingIndustry) {
    type = 'consulting';
    confidence = 'medium';
    signals.push('Industry consulting/IT services');
  } else if (hasConsultingName && headcount > 100) {
    type = 'consulting';
    confidence = 'medium';
    signals.push('Nom contient des mots-clés consulting + grande taille');
  }

  // ─── Check Startup ───
  if (type === 'other') {
    const hasEarlyFunding = EARLY_FUNDING.some(f => fundingType.includes(f));
    const isSmall = headcount > 0 && headcount <= 200;
    const isYoung = companyAge > 0 && companyAge <= 10;

    if (hasEarlyFunding && isSmall) {
      type = 'startup';
      confidence = 'high';
      signals.push(`Funding ${fundingType} + ${headcount} employés`);
    } else if (hasEarlyFunding) {
      type = 'startup';
      confidence = 'medium';
      signals.push(`Funding ${fundingType}`);
    } else if (isSmall && isYoung && fundingCount > 0) {
      type = 'startup';
      confidence = 'medium';
      signals.push(`Jeune entreprise (${companyAge} ans) + ${headcount} employés + ${fundingCount} levée(s)`);
    } else if (isSmall && isYoung) {
      type = 'startup';
      confidence = 'low';
      signals.push(`Petite entreprise récente (${companyAge} ans, ${headcount} employés)`);
    }
  }

  // ─── Check Scale-up ───
  if (type === 'other' || (type === 'startup' && headcount > 100)) {
    const hasGrowthFunding = GROWTH_FUNDING.some(f => fundingType.includes(f));
    const isMidSize = headcount >= 100 && headcount <= 2000;
    const hasHighGrowth = (data.headcount_growth || 0) > 15; // >15% growth

    if (hasGrowthFunding && isMidSize) {
      type = 'scaleup';
      confidence = 'high';
      signals.push(`Funding ${fundingType} + ${headcount} employés`);
    } else if (isMidSize && hasHighGrowth) {
      type = 'scaleup';
      confidence = 'medium';
      signals.push(`${headcount} employés + forte croissance (${data.headcount_growth}%)`);
    } else if (hasGrowthFunding) {
      type = 'scaleup';
      confidence = 'medium';
      signals.push(`Funding late-stage (${fundingType})`);
    }
  }

  // ─── Check Enterprise ───
  if (type === 'other') {
    const isPublic = orgType === 'public_company';
    const isLarge = headcount > 2000;

    if (isPublic) {
      type = 'enterprise';
      confidence = 'high';
      signals.push('Société cotée en bourse');
    } else if (isLarge) {
      type = 'enterprise';
      confidence = headcount > 5000 ? 'high' : 'medium';
      signals.push(`${headcount}+ employés`);
    }
  }

  // ─── Default ───
  if (type === 'other' && headcount > 0) {
    if (headcount <= 50) {
      signals.push(`Petite structure (${headcount} employés)`);
    } else if (headcount <= 500) {
      signals.push(`PME (${headcount} employés)`);
    } else {
      signals.push(`Grande structure (${headcount} employés)`);
    }
  }

  return {
    type,
    label: TYPE_LABELS[type],
    confidence,
    signals,
  };
}

/** Quick classification from a LinkedIn profile's current company data */
export function classifyFromProfile(profile: {
  current_company?: string;
  company_description?: string;
  company_headcount?: number | string;
  company_industry?: string;
  company_type?: string;
}): CompanyClassification {
  const headcount = typeof profile.company_headcount === 'string'
    ? parseInt(profile.company_headcount) || 0
    : profile.company_headcount || 0;

  return classifyCompany({
    name: profile.current_company,
    description: profile.company_description,
    industry: profile.company_industry,
    employee_count: headcount,
    organization_type: profile.company_type,
  });
}
