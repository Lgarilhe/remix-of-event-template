/**
 * useClientSuggestions : les sociétés proposées quand on saisit le client d'une
 * mission. D'abord celles des missions de l'organisation (avec leur logo déjà
 * enregistré), puis l'annuaire des sociétés (pedigree_company_directory, lisible
 * par tout membre connecté, avec le domaine du site).
 *
 * Choisir une proposition donne le nom exact, le site et, s'il existe, le logo :
 * plus de nom approximatif ni de logo d'un homonyme.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';

export interface ClientSuggestion {
  key: string;
  name: string;
  /** Site de la société (https://…), s'il est connu. */
  website: string | null;
  /** Logo déjà enregistré dans une mission de l'organisation. */
  logoUrl: string | null;
  source: 'org' | 'directory';
  /** Précision affichée sous le nom (domaine). */
  detail: string | null;
}

/** Nom comparable : sans accents ni casse ni ponctuation. */
export function normalizeClientName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface DirectoryRow {
  canonical_name: string;
  domain: string | null;
}

/** Valeur de recherche sûre pour un filtre ilike (pas de joker saisi par l'utilisateur). */
const likePattern = (query: string) => `%${query.replace(/[%_\\,()]/g, ' ').trim()}%`;

export function useClientSuggestions(query: string, enabled: boolean): ClientSuggestion[] {
  const { projects } = useSourcingProjects();
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const wanted = normalizeClientName(debounced);

  const orgClients = useMemo(() => {
    const byName = new Map<string, ClientSuggestion>();
    for (const p of projects) {
      const name = (p.jd_client || p.client_name || '').trim();
      if (!name) continue;
      const key = normalizeClientName(name);
      const known = byName.get(key);
      const logoUrl = p.jd_client_logo || known?.logoUrl || null;
      const website = p.jd_client_website || known?.website || null;
      byName.set(key, { key: `org:${key}`, name: known?.name ?? name, website, logoUrl, source: 'org', detail: null });
    }
    return [...byName.values()].filter((c) => !wanted || normalizeClientName(c.name).includes(wanted)).slice(0, 5);
  }, [projects, wanted]);

  const directory = useQuery({
    queryKey: ['client-directory', wanted],
    enabled: enabled && wanted.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DirectoryRow[]> => {
      const { data, error } = await supabase
        .from('pedigree_company_directory' as never)
        .select('canonical_name, domain')
        .ilike('canonical_name', likePattern(debounced))
        .order('canonical_name', { ascending: true })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as unknown as DirectoryRow[];
    },
  });

  return useMemo(() => {
    const out: ClientSuggestion[] = [...orgClients];
    const seen = new Set(orgClients.map((c) => normalizeClientName(c.name)));
    for (const row of directory.data ?? []) {
      const key = normalizeClientName(row.canonical_name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `directory:${key}`,
        name: row.canonical_name,
        website: row.domain ? `https://${row.domain}` : null,
        logoUrl: null,
        source: 'directory',
        detail: row.domain,
      });
    }
    return out;
  }, [orgClients, directory.data]);
}
