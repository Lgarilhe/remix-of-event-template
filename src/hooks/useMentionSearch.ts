import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export type MentionType = 'mission' | 'candidat' | 'shortlist';

export interface MentionEntity {
  id: string;
  type: MentionType;
  label: string;
  subtitle?: string;
  /** Payload injected into the agent context */
  contextPayload?: Record<string, unknown>;
}

const TYPE_META: Record<MentionType, { icon: string; label: string }> = {
  mission: { icon: 'mission', label: 'Mission' },
  candidat: { icon: 'candidat', label: 'Candidat' },
  shortlist: { icon: 'shortlist', label: 'Shortlist' },
};

export const MENTION_TYPES = Object.entries(TYPE_META).map(([key, meta]) => ({
  type: key as MentionType,
  ...meta,
}));

export function useMentionSearch() {
  const [results, setResults] = useState<MentionEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const { organizationId } = useOrganization();
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (query: string, type?: MentionType) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!organizationId || query.length < 1) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const entities: MentionEntity[] = [];

        // ── Missions ──
        if (!type || type === 'mission') {
          const [byName, byTitle] = await Promise.all([
            supabase
              .from('sourcing_projects')
              .select('id, name, job_title, client_name, status')
              .eq('organization_id', organizationId)
              .ilike('name', `%${query}%`)
              .in('status', ['active', 'paused'])
              .order('updated_at', { ascending: false })
              .limit(6),
            supabase
              .from('sourcing_projects')
              .select('id, name, job_title, client_name, status')
              .eq('organization_id', organizationId)
              .ilike('job_title', `%${query}%`)
              .in('status', ['active', 'paused'])
              .order('updated_at', { ascending: false })
              .limit(6),
          ]);

          const missionMap = new Map<string, { id: string; name: string | null; job_title: string | null; client_name: string | null; status: string | null }>();
          for (const project of [...(byName.data || []), ...(byTitle.data || [])]) {
            missionMap.set(project.id, project);
          }

          entities.push(
            ...Array.from(missionMap.values()).slice(0, 6).map((p) => ({
              id: p.id,
              type: 'mission' as MentionType,
              label: p.job_title || p.name || 'Mission sans titre',
              subtitle: [p.client_name, p.name && p.job_title && p.name !== p.job_title ? p.name : null].filter(Boolean).join(' · '),
            })),
          );
        }

        // ── Candidates ──
        if (!type || type === 'candidat') {
          const { data } = await supabase
            .from('candidate_profiles')
            .select('id, candidate_id, name, headline')
            .eq('organization_id', organizationId)
            .ilike('name', `%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(6);

          if (data) {
            entities.push(
              ...data.map((c) => ({
                id: c.candidate_id,
                type: 'candidat' as MentionType,
                label: c.name || 'Sans nom',
                subtitle: c.headline || undefined,
              })),
            );
          }
        }

        // ── Shortlists (missions with shortlisted candidates) ──
        if (!type || type === 'shortlist') {
          const { data } = await supabase
            .from('sourcing_projects')
            .select('id, name, client_name, stats_shortlisted')
            .eq('organization_id', organizationId)
            .gt('stats_shortlisted', 0)
            .ilike('name', `%${query}%`)
            .order('updated_at', { ascending: false })
            .limit(6);

          if (data) {
            entities.push(
              ...data.map((p) => ({
                id: p.id,
                type: 'shortlist' as MentionType,
                label: `Shortlist — ${p.name}`,
                subtitle: `${p.stats_shortlisted} candidat${(p.stats_shortlisted || 0) > 1 ? 's' : ''} · ${p.client_name || ''}`,
              })),
            );
          }
        }

        if (!controller.signal.aborted) {
          setResults(entities);
        }
      } catch {
        // ignore aborted
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [organizationId],
  );

  const clear = useCallback(() => {
    setResults([]);
    abortRef.current?.abort();
  }, []);

  return { results, loading, search, clear, MENTION_TYPES };
}
