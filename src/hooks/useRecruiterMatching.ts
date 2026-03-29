import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RecruiterProfile, rankRecruiters, MissionForMatching } from '@/lib/recruiterMatching';
import type { SourcingProject } from '@/hooks/useSourcingProjects';

/**
 * Fetch all recruiter profiles and rank them against a mission.
 * Used in the marketplace for enterprise clients to find recruiters.
 */
export const useRecruiterMatching = (project: SourcingProject | null) => {
  return useQuery({
    queryKey: ['recruiter-matching', project?.id],
    queryFn: async () => {
      if (!project) return [];

      // Fetch all recruiter profiles (from agency/freelance orgs)
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('user_id, display_name, specializations, linkedin_skills, years_experience, rating, placements_count, avg_time_to_fill_days, first_round_rate, mid_round_rate')
        .not('recruiter_bio', 'is', null); // Only recruiters with a bio (active profiles)

      if (error) throw error;
      if (!profiles || profiles.length === 0) return [];

      // Count active missions per recruiter
      const userIds = profiles.map(p => p.user_id);
      const { data: activeMissions } = await supabase
        .from('mission_team')
        .select('user_id')
        .in('user_id', userIds);

      const missionCounts = new Map<string, number>();
      (activeMissions || []).forEach((m: any) => {
        missionCounts.set(m.user_id, (missionCounts.get(m.user_id) || 0) + 1);
      });

      // Build recruiter profiles with mission count
      const recruiters: RecruiterProfile[] = profiles.map((p: any) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        specializations: p.specializations,
        linkedin_skills: p.linkedin_skills,
        years_experience: p.years_experience,
        rating: p.rating,
        placements_count: p.placements_count,
        avg_time_to_fill_days: p.avg_time_to_fill_days,
        first_round_rate: p.first_round_rate,
        mid_round_rate: p.mid_round_rate,
        active_missions_count: missionCounts.get(p.user_id) || 0,
      }));

      // Rank against the mission
      const mission: MissionForMatching = {
        job_details: project.job_details || {},
        client_name: project.client_name,
      };

      return rankRecruiters(recruiters, mission);
    },
    enabled: !!project?.id,
    staleTime: 5 * 60 * 1000,
  });
};
