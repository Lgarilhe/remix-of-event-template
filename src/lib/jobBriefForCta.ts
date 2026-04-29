/**
 * jobBriefForCta — Extrait les informations clés d'un JobDetails pour
 * les passer au prompt LLM du CTA "Détailler le poste" (et autres).
 *
 * On garde l'essentiel : titre, contrat, client, lieu, télétravail,
 * description, compétences must-have, salaire, avantages, début. Pas
 * besoin des calibration_profiles, evaluation_criteria, etc. — trop
 * volumineux pour un message LinkedIn et peu utile au candidat.
 *
 * Le résultat est un dict simple sérialisable, transmis à l'edge
 * function dans `body.job_brief`.
 */

import type { JobDetails } from '@/types/jobDetails';
import {
  CONTRACT_TYPE_LABELS,
  REMOTE_LABELS,
  SIZE_LABELS,
  SALARY_TYPE_LABELS,
} from '@/types/jobDetails';

export interface JobBriefForCta {
  title?: string;
  contract_type?: string;
  client_name?: string;
  client_sector?: string;
  client_size?: string;
  location?: string;
  remote_policy?: string;
  remote_days?: number;
  mission_description?: string;
  context?: string;
  seniority?: string;
  experience_min?: number;
  experience_max?: number;
  skills_must_have?: string[];
  skills_should_have?: string[];
  salary_range?: string; // déjà formaté ("60-80k€/an")
  benefits?: string;
  equity?: string;
  start_date?: string;
  team_size?: number;
  manages?: number;
  reports_to?: string;
}

/**
 * Format salary range en string lisible :
 *  - "60-80k€/an" si min + max
 *  - "à partir de 60k€/an" si min seul
 *  - "jusqu'à 80k€/an" si max seul
 *  - undefined si rien
 */
function formatSalary(jd: JobDetails): string | undefined {
  const min = jd.salary_min;
  const max = jd.salary_max;
  if (!min && !max) return undefined;
  const currency = jd.salary_currency || 'EUR';
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency;
  const typeLabel = SALARY_TYPE_LABELS[jd.salary_type || 'annual'] || '€/an';
  const unit = typeLabel.split('/').pop() || 'an';

  // Pour les salaires annuels, on convertit en "k" si > 1000
  const fmt = (n: number) => {
    if ((jd.salary_type || 'annual') === 'annual' && n >= 1000) {
      return `${Math.round(n / 1000)}k${symbol}`;
    }
    return `${n}${symbol}`;
  };

  if (min && max) return `${fmt(min)}-${fmt(max)}/${unit}`;
  if (min) return `à partir de ${fmt(min)}/${unit}`;
  if (max) return `jusqu'à ${fmt(max)}/${unit}`;
  return undefined;
}

/**
 * Construit le brief pour le CTA. Retourne undefined si pas assez
 * d'infos pour être utile (titre + au moins un autre champ).
 */
export function buildJobBriefForCta(jd: JobDetails | null | undefined): JobBriefForCta | undefined {
  if (!jd) return undefined;

  const brief: JobBriefForCta = {};

  if (jd.title) brief.title = jd.title;
  if (jd.contract_type) brief.contract_type = CONTRACT_TYPE_LABELS[jd.contract_type] || jd.contract_type;
  if (jd.client?.name) brief.client_name = jd.client.name;
  if (jd.client?.sector) brief.client_sector = jd.client.sector;
  if (jd.client?.size) brief.client_size = SIZE_LABELS[jd.client.size] || jd.client.size;
  if (jd.location) brief.location = jd.location;
  if (jd.remote_policy) brief.remote_policy = REMOTE_LABELS[jd.remote_policy] || jd.remote_policy;
  if (typeof jd.remote_days === 'number') brief.remote_days = jd.remote_days;
  if (jd.mission_description) {
    // Limite à 600 chars pour le prompt — au-delà, on perd en signal
    brief.mission_description = jd.mission_description.length > 600
      ? jd.mission_description.slice(0, 600) + '…'
      : jd.mission_description;
  }
  if (jd.context) {
    brief.context = jd.context.length > 400
      ? jd.context.slice(0, 400) + '…'
      : jd.context;
  }
  if (jd.seniority) brief.seniority = jd.seniority;
  if (typeof jd.experience_min === 'number') brief.experience_min = jd.experience_min;
  if (typeof jd.experience_max === 'number') brief.experience_max = jd.experience_max;
  if (jd.skills_must_have && jd.skills_must_have.length > 0) {
    brief.skills_must_have = jd.skills_must_have.slice(0, 8);
  }
  if (jd.skills_should_have && jd.skills_should_have.length > 0) {
    brief.skills_should_have = jd.skills_should_have.slice(0, 5);
  }
  const salary = formatSalary(jd);
  if (salary) brief.salary_range = salary;
  if (jd.benefits) {
    brief.benefits = jd.benefits.length > 300
      ? jd.benefits.slice(0, 300) + '…'
      : jd.benefits;
  }
  if (jd.equity) brief.equity = jd.equity;
  if (jd.start_date) brief.start_date = jd.start_date;
  if (typeof jd.team_size === 'number') brief.team_size = jd.team_size;
  if (typeof jd.manages === 'number') brief.manages = jd.manages;
  if (jd.reports_to) brief.reports_to = jd.reports_to;

  // Au moins le titre + un autre field pour être utile
  const fieldCount = Object.keys(brief).length;
  if (fieldCount < 2) return undefined;

  return brief;
}

/**
 * Variante : prend un JobData (format Notion utilisé dans l'inbox via
 * fetch-notion-jobs) et retourne le même format que buildJobBriefForCta.
 *
 * `JobData` a une shape différente de `JobDetails` (vient d'une autre
 * source : Notion vs sourcing_projects.job_details), donc on mappe.
 */
export interface JobDataLike {
  title?: string;
  client?: { name?: string; sector?: string } | null;
  skills?: string[];
  seniority?: string;
  location?: string;
  remote?: string;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
  description?: string;
  requirements?: string;
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  teamInfo?: string;
  xpMin?: number;
  xpMax?: number;
}

export function jobDataToBrief(jd: JobDataLike | null | undefined): JobBriefForCta | undefined {
  if (!jd) return undefined;
  const brief: JobBriefForCta = {};

  if (jd.title) brief.title = jd.title;
  if (jd.contractType) brief.contract_type = jd.contractType;
  if (jd.client?.name) brief.client_name = jd.client.name;
  if (jd.client?.sector) brief.client_sector = jd.client.sector;
  if (jd.location) brief.location = jd.location;
  if (jd.remote) brief.remote_policy = jd.remote;
  if (jd.seniority) brief.seniority = jd.seniority;
  if (typeof jd.xpMin === 'number') brief.experience_min = jd.xpMin;
  if (typeof jd.xpMax === 'number') brief.experience_max = jd.xpMax;
  if (jd.description) {
    brief.mission_description = jd.description.length > 600
      ? jd.description.slice(0, 600) + '…'
      : jd.description;
  }
  if (jd.skills && jd.skills.length > 0) {
    brief.skills_must_have = jd.skills.slice(0, 8);
  }
  if (jd.mustHave && !brief.skills_must_have) {
    // mustHave est un texte libre ; on le passe brut comme une seule "skill"
    brief.skills_must_have = [jd.mustHave.length > 200 ? jd.mustHave.slice(0, 200) + '…' : jd.mustHave];
  }
  if (jd.shouldHave) {
    brief.skills_should_have = [jd.shouldHave.length > 200 ? jd.shouldHave.slice(0, 200) + '…' : jd.shouldHave];
  }
  if (jd.teamInfo) {
    brief.context = jd.teamInfo.length > 400 ? jd.teamInfo.slice(0, 400) + '…' : jd.teamInfo;
  }

  // Format salary range — Notion peut avoir salary annuel (€) ou TJM (€/jour)
  const fmtAnnual = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k€` : `${n}€`;
  if (jd.salaryMin && jd.salaryMax) {
    brief.salary_range = `${fmtAnnual(jd.salaryMin)}-${fmtAnnual(jd.salaryMax)}/an`;
  } else if (jd.salaryMin) {
    brief.salary_range = `à partir de ${fmtAnnual(jd.salaryMin)}/an`;
  } else if (jd.salaryMax) {
    brief.salary_range = `jusqu'à ${fmtAnnual(jd.salaryMax)}/an`;
  } else if (jd.tjmMin && jd.tjmMax) {
    brief.salary_range = `${jd.tjmMin}-${jd.tjmMax}€/jour`;
  } else if (jd.tjmMin) {
    brief.salary_range = `à partir de ${jd.tjmMin}€/jour`;
  } else if (jd.tjmMax) {
    brief.salary_range = `jusqu'à ${jd.tjmMax}€/jour`;
  }

  const fieldCount = Object.keys(brief).length;
  if (fieldCount < 2) return undefined;
  return brief;
}
