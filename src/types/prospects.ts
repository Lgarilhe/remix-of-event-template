export interface ProspectProfile {
  id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  profile_pic_url?: string | null;
  job_title?: string;
  job_title_role?: string;
  job_title_levels?: string[];
  job_company_name?: string;
  job_company_industry?: string;
  job_company_size?: string;
  job_company_founded?: number;
  job_company_funding_raised?: number;
  job_company_funding_stage?: string;
  job_company_website?: string | null;
  job_company_linkedin_url?: string | null;
  job_start_date?: string;
  location_name?: string;
  location_locality?: string;
  location_region?: string;
  location_country?: string;
  linkedin_url?: string;
  emails?: string[];
  phone_numbers?: string[];
  skills?: string[];
  experience?: { title: string; company: string; start_date?: string; end_date?: string }[];
  education?: { school: string; degree?: string }[];
  intent_signals?: {
    job_change?: boolean;
    recently_funded?: boolean;
    hiring?: boolean;
  };
  score?: number;
  source?: 'pdl' | 'apollo';
}
