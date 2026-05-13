import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { PedigreeRequirements, SeniorityLevel } from '@/types/pedigreePreset';
import type { ClientCompetitor } from '@/types/clientCompetitor';

/**
 * Mapping min_seniority (SeniorityLevel) → level keys LinkedIn ('1'..'10').
 * Interprétation "min" : on inclut le niveau cible ET tous les niveaux au-dessus.
 * Niveaux Unipile : 1=Intern, 2=Junior, 3=Mid, 4=Senior/Staff/Lead/Principal,
 * 5=Manager, 6=Director, 7=VP, 8=CEO/Founder.
 *
 * Utilisé sur Recruiter + Database (la pipeline existante transforme en
 * Boolean OR keyword injecté dans role).
 */
const MIN_SENIORITY_TO_LEVELS: Record<SeniorityLevel, string[]> = {
  junior:    ['2', '3', '4', '5', '6', '7', '8'],
  mid:       ['3', '4', '5', '6', '7', '8'],
  senior:    ['4', '5', '6', '7', '8'],
  lead:      ['4', '5', '6', '7', '8'],
  staff:     ['4', '5', '6', '7', '8'],
  principal: ['4', '5', '6', '7', '8'],
};

/**
 * Mapping min_seniority (SeniorityLevel) → enum Sales Navigator natif.
 * Sales Nav supporte un filtre `seniority: { include: [...] }` avec ces values
 * (vérifié dans la spec OpenAPI Unipile / unipile-search normaliseSeniority).
 * Interprétation "min" : on inclut le niveau cible ET tous les niveaux au-dessus.
 */
const MIN_SENIORITY_TO_SN_INCLUDE: Record<SeniorityLevel, string[]> = {
  junior:    ['entry_level', 'senior', 'experienced_manager', 'director', 'vice_president', 'cxo', 'owner/partner'],
  mid:       ['senior', 'experienced_manager', 'director', 'vice_president', 'cxo', 'owner/partner'],
  senior:    ['senior', 'experienced_manager', 'director', 'vice_president', 'cxo', 'owner/partner'],
  lead:      ['senior', 'experienced_manager', 'director', 'vice_president', 'cxo', 'owner/partner'],
  staff:     ['senior', 'experienced_manager', 'director', 'vice_president', 'cxo', 'owner/partner'],
  principal: ['senior', 'experienced_manager', 'director', 'vice_president', 'cxo', 'owner/partner'],
};

interface SchoolDirEntry {
  id: string;
  canonical_name: string;
  aliases: string[] | null;
  linkedin_school_id: string | null;
  category: string | null;
  tier: number | null;
  resolution_status: string;
}

interface CompanyDirEntry {
  id: string;
  canonical_name: string;
  aliases: string[] | null;
  linkedin_company_id: string | null;
  category: string | null;
  tier: number | null;
  resolution_status: string;
}

export interface PedigreeAugmentation {
  /** IDs LinkedIn d'écoles à injecter dans filters.school */
  schoolIds: Array<{ id: string; name: string; source: 'preset_required' }>;
  /** IDs LinkedIn d'entreprises à injecter dans filters.company */
  companyIds: Array<{ id: string; name: string; source: 'preset_specific' | 'preset_provenance' | 'competitor' }>;
  /**
   * Mots-clés d'entreprises à EXCLURE de la recherche (companies_avoid résolu).
   * À injecter dans filters.company_keywords avec priority='DOESNT_HAVE'.
   * Câblé uniquement sur Recruiter + Database (Classic/Sales Nav ne supportent
   * pas company_keywords — fallback scoring-only sur ces licences).
   */
  excludeCompanyKeywords: string[];
  /**
   * Niveaux de séniorité LinkedIn ('1'..'10') correspondant au min_seniority.
   * À merger dans filters.seniority (Recruiter + Database injectent via Boolean
   * OR keyword dans role).
   */
  seniorityLevels: string[];
  /**
   * Enum Sales Navigator natif pour le filtre `seniority.include` quand
   * la licence active est Sales Nav. Pré-expandé depuis min_seniority
   * (ex: 'senior' → ['senior','experienced_manager','director',...]).
   */
  salesNavSeniorityInclude: string[];
  /** Noms non-résolus (annuaire pas encore résolu, à curer) */
  unresolvedSchoolNames: string[];
  unresolvedCompanyNames: string[];
  /** Comptes synthétiques pour le bandeau UI */
  counts: {
    schools: number;
    companies: number;
    fromPreset: number;
    fromCompetitors: number;
    excludedCompanies: number;
    seniorityLevels: number;
  };
}

/**
 * Calcule les IDs LinkedIn à injecter dans les filtres Unipile, à partir de :
 * - pedigree_requirements (preset client → schools_required, companies_*, ...)
 * - client_competitors enabled (concurrents directs/adjacents/inspirational)
 *
 * Retourne null si aucun augmentation n'est nécessaire.
 *
 * Note : les noms non-résolus (linkedin_id NULL) sont remontés via
 * unresolvedSchoolNames / unresolvedCompanyNames pour que l'UI puisse afficher
 * un avertissement "X écoles non encore résolues — relance le cron".
 */
export function usePedigreeAugmentation(
  pedigreeRequirements: PedigreeRequirements | null | undefined,
  competitors: ClientCompetitor[],
  enabled: boolean = true,
): PedigreeAugmentation | null {
  const { organizationId } = useOrganization();
  const [schoolDir, setSchoolDir] = useState<SchoolDirEntry[]>([]);
  const [companyDir, setCompanyDir] = useState<CompanyDirEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      // Lecture du directory global. RLS = readable par tous les authenticated.
      const [schoolsRes, companiesRes] = await Promise.all([
        supabase
          .from('pedigree_school_directory' as never)
          .select('id, canonical_name, aliases, linkedin_school_id, category, tier, resolution_status'),
        supabase
          .from('pedigree_company_directory' as never)
          .select('id, canonical_name, aliases, linkedin_company_id, category, tier, resolution_status'),
      ]);
      if (cancelled) return;
      const sData = (schoolsRes as unknown as { data: SchoolDirEntry[] | null }).data;
      const cData = (companiesRes as unknown as { data: CompanyDirEntry[] | null }).data;
      setSchoolDir(sData || []);
      setCompanyDir(cData || []);
    })();
    return () => { cancelled = true; };
  }, [enabled, organizationId]);

  return useMemo<PedigreeAugmentation | null>(() => {
    if (!enabled) return null;
    if (!pedigreeRequirements && competitors.length === 0) return null;

    const norm = (s: string) => s.toLowerCase().trim();
    const excludeCompanyKeywords: string[] = [];
    const seniorityLevels: string[] = [];
    const salesNavSeniorityInclude: string[] = [];
    const seenExcludeKeyword = new Set<string>();

    // Helper : matche un nom contre canonical+aliases du directory
    const findSchool = (name: string): SchoolDirEntry | null => {
      const n = norm(name);
      return schoolDir.find(e => {
        if (norm(e.canonical_name) === n) return true;
        return (e.aliases || []).some(a => norm(a) === n);
      }) || null;
    };
    const findCompany = (name: string): CompanyDirEntry | null => {
      const n = norm(name);
      return companyDir.find(e => {
        if (norm(e.canonical_name) === n) return true;
        return (e.aliases || []).some(a => norm(a) === n);
      }) || null;
    };

    const schoolIds: PedigreeAugmentation['schoolIds'] = [];
    const companyIds: PedigreeAugmentation['companyIds'] = [];
    const unresolvedSchoolNames: string[] = [];
    const unresolvedCompanyNames: string[] = [];
    let fromPreset = 0;
    let fromCompetitors = 0;
    const seenSchool = new Set<string>();
    const seenCompany = new Set<string>();

    // ─── Pedigree preset : schools_required ──────────────────────────────
    if (pedigreeRequirements?.schools_required?.length) {
      for (const name of pedigreeRequirements.schools_required) {
        const entry = findSchool(name);
        if (entry?.linkedin_school_id) {
          if (!seenSchool.has(entry.linkedin_school_id)) {
            seenSchool.add(entry.linkedin_school_id);
            schoolIds.push({ id: entry.linkedin_school_id, name: entry.canonical_name, source: 'preset_required' });
            fromPreset++;
          }
        } else {
          unresolvedSchoolNames.push(name);
        }
      }
    }

    // ─── Pedigree preset : companies_specific_required ───────────────────
    if (pedigreeRequirements?.companies_specific_required?.length) {
      for (const name of pedigreeRequirements.companies_specific_required) {
        const entry = findCompany(name);
        if (entry?.linkedin_company_id) {
          if (!seenCompany.has(entry.linkedin_company_id)) {
            seenCompany.add(entry.linkedin_company_id);
            companyIds.push({ id: entry.linkedin_company_id, name: entry.canonical_name, source: 'preset_specific' });
            fromPreset++;
          }
        } else {
          unresolvedCompanyNames.push(name);
        }
      }
    }

    // ─── Pedigree preset : companies_required_provenance (catégorie) ─────
    // Ex: "scale_up" → expand en tous les companies dont category=scale_up
    if (pedigreeRequirements?.companies_required_provenance?.length) {
      for (const cat of pedigreeRequirements.companies_required_provenance) {
        for (const entry of companyDir) {
          if (entry.category !== cat) continue;
          if (!entry.linkedin_company_id) continue;
          if (seenCompany.has(entry.linkedin_company_id)) continue;
          seenCompany.add(entry.linkedin_company_id);
          companyIds.push({ id: entry.linkedin_company_id, name: entry.canonical_name, source: 'preset_provenance' });
          fromPreset++;
        }
      }
    }

    // ─── Pedigree preset : companies_avoid (catégorie) → exclude keywords ─
    // On résout chaque catégorie en noms d'entreprises canoniques du directory
    // et on les injecte comme keywords DOESNT_HAVE côté Unipile. N'agit que sur
    // Recruiter + Database (company_keywords non supporté Classic/Sales Nav).
    if (pedigreeRequirements?.companies_avoid?.length) {
      for (const cat of pedigreeRequirements.companies_avoid) {
        for (const entry of companyDir) {
          if (entry.category !== cat) continue;
          const kw = entry.canonical_name.trim();
          if (!kw) continue;
          const key = norm(kw);
          if (seenExcludeKeyword.has(key)) continue;
          seenExcludeKeyword.add(key);
          excludeCompanyKeywords.push(kw);
        }
      }
    }

    // ─── Pedigree preset : min_seniority → seniority levels ──────────────
    if (pedigreeRequirements?.min_seniority) {
      const levels = MIN_SENIORITY_TO_LEVELS[pedigreeRequirements.min_seniority];
      if (levels?.length) seniorityLevels.push(...levels);
      const snInclude = MIN_SENIORITY_TO_SN_INCLUDE[pedigreeRequirements.min_seniority];
      if (snInclude?.length) salesNavSeniorityInclude.push(...snInclude);
    }

    // ─── Concurrents (linkedin_company_id résolu via cron) ──────────────
    for (const c of competitors) {
      if (!c.enabled) continue;
      if (c.linkedin_company_id) {
        if (!seenCompany.has(c.linkedin_company_id)) {
          seenCompany.add(c.linkedin_company_id);
          companyIds.push({ id: c.linkedin_company_id, name: c.competitor_name, source: 'competitor' });
          fromCompetitors++;
        }
      } else {
        unresolvedCompanyNames.push(c.competitor_name);
      }
    }

    if (
      schoolIds.length === 0
      && companyIds.length === 0
      && excludeCompanyKeywords.length === 0
      && seniorityLevels.length === 0
      && salesNavSeniorityInclude.length === 0
      && unresolvedSchoolNames.length === 0
      && unresolvedCompanyNames.length === 0
    ) {
      return null;
    }

    return {
      schoolIds,
      companyIds,
      excludeCompanyKeywords,
      seniorityLevels,
      salesNavSeniorityInclude,
      unresolvedSchoolNames,
      unresolvedCompanyNames,
      counts: {
        schools: schoolIds.length,
        companies: companyIds.length,
        fromPreset,
        fromCompetitors,
        excludedCompanies: excludeCompanyKeywords.length,
        seniorityLevels: seniorityLevels.length,
      },
    };
  }, [enabled, pedigreeRequirements, competitors, schoolDir, companyDir]);
}
