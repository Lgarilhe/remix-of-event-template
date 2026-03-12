import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeUnipile } from '@/lib/invokeUnipile';

export interface EnrichedProfile {
  name: string;
  headline?: string;
  summary?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  experiences?: Array<{
    title: string;
    company: string;
    logo?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
  }>;
  education?: Array<{
    school: string;
    logo?: string;
    degree?: string;
    field?: string;
    startYear?: string;
    endYear?: string;
  }>;
  yearsOfExperience?: number;
  languages?: string[];
  recentPosts?: Array<{
    text?: string;
    title?: string;
    date?: string;
    reactions?: number;
    comments?: number;
  }>;
}

interface UseProfileEnrichmentResult {
  enrichedProfile: EnrichedProfile | null;
  loading: boolean;
  error: string | null;
  enrichProfile: (profileUrl: string, accountId: string) => Promise<EnrichedProfile | null>;
}

// Cache to avoid redundant API calls
const profileCache = new Map<string, { data: EnrichedProfile; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_PROFILE_CACHE = 200;

function evictProfileCache() {
  // First, remove expired entries
  const now = Date.now();
  for (const [key, val] of profileCache) {
    if (now - val.timestamp > CACHE_TTL) profileCache.delete(key);
  }
  // Then, evict oldest if still over limit
  if (profileCache.size > MAX_PROFILE_CACHE) {
    const excess = profileCache.size - MAX_PROFILE_CACHE;
    const keys = profileCache.keys();
    for (let i = 0; i < excess; i++) {
      const key = keys.next().value;
      if (key !== undefined) profileCache.delete(key);
    }
  }
}

export function useProfileEnrichment(): UseProfileEnrichmentResult {
  const [enrichedProfile, setEnrichedProfile] = useState<EnrichedProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enrichProfile = useCallback(async (
    profileUrl: string, 
    accountId: string
  ): Promise<EnrichedProfile | null> => {
    if (!profileUrl || !accountId) return null;

    // Check cache first
    const cacheKey = profileUrl;
    const cached = profileCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setEnrichedProfile(cached.data);
      return cached.data;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: response } = await invokeUnipile({
        body: {
          action: 'get_profile',
          account_id: accountId,
          profile_url: profileUrl,
        },
      });

      if (!response?.success) throw new Error(response?.error as string || 'Failed to fetch profile');

      const profile = response.profile as Record<string, any>;
      
      // Transform Unipile profile data to our format
      const enriched: EnrichedProfile = {
        name: profile.name || profile.first_name + ' ' + profile.last_name || 'Inconnu',
        headline: profile.headline || profile.occupation,
        summary: profile.about || profile.summary,
        currentRole: profile.headline?.split(' at ')[0] || profile.headline?.split(' chez ')[0],
        currentCompany: profile.headline?.split(' at ')[1] || profile.headline?.split(' chez ')[1],
        location: profile.location?.name || profile.location,
        skills: profile.skills?.map((s: any) => typeof s === 'string' ? s : s.name) || [],
        experiences: (profile.positions || profile.experiences || []).slice(0, 5).map((exp: any) => ({
          title: exp.title,
          company: exp.company_name || exp.company,
          logo: exp.company_logo || exp.logo_url || exp.logo || undefined,
          description: exp.description,
          startDate: exp.start_date || exp.starts_at,
          endDate: exp.end_date || exp.ends_at,
          isCurrent: !exp.end_date && !exp.ends_at,
        })),
        education: (profile.education || []).slice(0, 3).map((edu: any) => ({
          school: edu.school_name || edu.school || edu.school_details?.name,
          logo: edu.school_logo || edu.logo_url || edu.logo || edu.school_details?.logo,
          degree: edu.degree_name || edu.degree,
          field: edu.field_of_study || edu.field,
          startYear: edu.start_date?.year || edu.starts_at?.year,
          endYear: edu.end_date?.year || edu.ends_at?.year,
        })),
        languages: profile.languages?.map((l: any) => typeof l === 'string' ? l : l.name) || [],
      };

      // Fetch recent posts (separate API call, fire in parallel but don't block)
      try {
        const profileId = profile.provider_id || profile.public_identifier || profile.id;
        if (profileId) {
          const { data: postsResponse } = await invokeUnipile({
            body: {
              action: 'get_user_posts',
              account_id: accountId,
              identifier: profileId,
              limit: 5,
            },
          });
          if (postsResponse?.success && Array.isArray((postsResponse as any).items)) {
            enriched.recentPosts = (postsResponse as any).items.slice(0, 5).map((p: any) => ({
              text: p.text,
              title: p.title,
              date: p.date || p.parsed_datetime,
              reactions: p.reaction_counter,
              comments: p.comment_counter,
            }));
          }
        }
      } catch (postErr) {
        console.warn('Could not fetch posts:', postErr);
      }

      // Calculate years of experience
      if (enriched.experiences && enriched.experiences.length > 0) {
        const sortedExp = [...enriched.experiences].sort((a, b) => {
          const aYear = a.startDate ? parseInt(a.startDate.split('-')[0]) : 9999;
          const bYear = b.startDate ? parseInt(b.startDate.split('-')[0]) : 9999;
          return aYear - bYear;
        });
        const firstExpYear = sortedExp[0]?.startDate ? parseInt(sortedExp[0].startDate.split('-')[0]) : null;
        if (firstExpYear) {
          enriched.yearsOfExperience = new Date().getFullYear() - firstExpYear;
        }
      }

      // Cache the result
      profileCache.set(cacheKey, { data: enriched, timestamp: Date.now() });
      evictProfileCache();
      setEnrichedProfile(enriched);
      return enriched;
    } catch (err) {
      console.error('Error enriching profile:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    enrichedProfile,
    loading,
    error,
    enrichProfile,
  };
}

// Utility to format enriched profile for AI context
export function formatProfileForAI(profile: EnrichedProfile): string {
  const sections: string[] = [];
  
  sections.push(`Nom: ${profile.name}`);
  if (profile.headline) sections.push(`Titre: ${profile.headline}`);
  if (profile.location) sections.push(`Localisation: ${profile.location}`);
  if (profile.yearsOfExperience) sections.push(`Expérience: ~${profile.yearsOfExperience} ans`);
  
  // Summary/About
  if (profile.summary) {
    const truncatedSummary = profile.summary.length > 400 
      ? profile.summary.slice(0, 400) + '...' 
      : profile.summary;
    sections.push(`Résumé: ${truncatedSummary}`);
  }
  
  // Last 3 experiences with descriptions
  if (profile.experiences && profile.experiences.length > 0) {
    const expStrings = profile.experiences.slice(0, 3).map(exp => {
      let expStr = `• ${exp.title} chez ${exp.company}`;
      if (exp.startDate) {
        expStr += ` (${exp.startDate.split('-')[0]}${exp.endDate ? `-${exp.endDate.split('-')[0]}` : '-Présent'})`;
      }
      if (exp.description) {
        const truncDesc = exp.description.length > 150 
          ? exp.description.slice(0, 150) + '...' 
          : exp.description;
        expStr += `\n  ${truncDesc}`;
      }
      return expStr;
    });
    sections.push(`Expériences:\n${expStrings.join('\n')}`);
  }
  
  // Education
  if (profile.education && profile.education.length > 0) {
    const eduStrings = profile.education.slice(0, 2).map(edu => {
      let eduStr = `• ${edu.school}`;
      if (edu.degree) eduStr += ` - ${edu.degree}`;
      if (edu.field) eduStr += ` (${edu.field})`;
      return eduStr;
    });
    sections.push(`Formation: ${eduStrings.join('; ')}`);
  }
  
  // Skills
  if (profile.skills && profile.skills.length > 0) {
    sections.push(`Compétences: ${profile.skills.slice(0, 15).join(', ')}`);
  }
  
  // Languages
  if (profile.languages && profile.languages.length > 0) {
    sections.push(`Langues: ${profile.languages.join(', ')}`);
  }
  
  // Recent posts
  if (profile.recentPosts && profile.recentPosts.length > 0) {
    const postStrings = profile.recentPosts.slice(0, 3).map(p => {
      const text = p.text ? (p.text.length > 200 ? p.text.slice(0, 200) + '...' : p.text) : '';
      return `• ${p.title || ''}${text ? ` ${text}` : ''}`.trim();
    }).filter(Boolean);
    if (postStrings.length > 0) {
      sections.push(`Posts récents:\n${postStrings.join('\n')}`);
    }
  }
  
  return sections.join('\n');
}
