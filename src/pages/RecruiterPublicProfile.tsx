import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Linkedin, ArrowLeft, Briefcase, Award, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';

interface RecruiterProfile {
  display_name: string | null;
  recruiter_bio: string | null;
  recruiter_headline: string | null;
  linkedin_url: string | null;
  linkedin_skills: string[] | null;
  years_experience: number | null;
  job_title: string | null;
  specializations: string[] | null;
}

const RecruiterPublicProfile: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<RecruiterProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }

    supabase
      .from('profiles')
      .select('display_name, recruiter_bio, recruiter_headline, linkedin_url, linkedin_skills, years_experience, job_title, specializations')
      .eq('public_slug', slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data || !data.recruiter_bio) {
          setNotFound(true);
        } else {
          setProfile(data as RecruiterProfile);
        }
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Profil introuvable</h1>
          <p className="text-muted-foreground text-sm">Ce profil n'existe pas ou n'est plus disponible.</p>
          <Link to="/" className="text-sm underline text-foreground/60 hover:text-foreground">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  const name = profile.display_name || 'Recruteur';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const allSkills = [
    ...(profile.specializations || []),
    ...(profile.linkedin_skills || []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <>
      <SEOHead
        title={`${name} — Recruteur | Skalr`}
        description={profile.recruiter_bio?.slice(0, 160) || `Profil de ${name}, recruteur professionnel.`}
      />
      <div className="min-h-screen bg-background">
        {/* Top bar */}
        <div className="border-b-2 border-foreground/10 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Skalr
            </Link>
            {profile.linkedin_url && (
              <a
                href={profile.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <Linkedin className="w-3.5 h-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        </div>

        {/* Profile card */}
        <div className="max-w-2xl mx-auto px-4 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border-2 border-foreground/15 p-6 md:p-8 space-y-6"
            style={{ boxShadow: '4px 4px 0px 0px hsl(var(--brutal-accent))' }}
          >
            {/* Header */}
            <div className="flex items-start gap-4">
              <div
                className="w-16 h-16 flex items-center justify-center text-xl font-bold text-white border-2 border-foreground shrink-0"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))',
                }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl md:text-2xl font-bold text-foreground">{name}</h1>
                {profile.recruiter_headline && (
                  <p className="text-sm text-muted-foreground mt-0.5">{profile.recruiter_headline}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  {profile.years_experience && profile.years_experience > 0 && (
                    <span className="flex items-center gap-1">
                      <Briefcase className="w-3 h-3" />
                      {profile.years_experience} ans d'expérience
                    </span>
                  )}
                  {profile.job_title && (
                    <span className="flex items-center gap-1">
                      <Award className="w-3 h-3" />
                      {profile.job_title}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Bio */}
            <div className="border-l-4 border-foreground/20 pl-4">
              <p className="text-sm leading-relaxed text-foreground/80">{profile.recruiter_bio}</p>
            </div>

            {/* Skills */}
            {allSkills.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Spécialisations & Compétences
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {allSkills.slice(0, 15).map((skill) => (
                    <span
                      key={skill}
                      className="px-2.5 py-1 text-[11px] font-semibold border-2 border-foreground/15 text-foreground/70"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            {profile.linkedin_url && (
              <div className="pt-2 border-t-2 border-foreground/10">
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 transition-colors"
                  style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
                >
                  <Linkedin className="w-4 h-4" />
                  Contacter sur LinkedIn
                </a>
              </div>
            )}
          </motion.div>

          {/* Footer */}
          <p className="text-center text-[10px] text-muted-foreground/50 mt-8">
            Profil généré par Skalr
          </p>
        </div>
      </div>
    </>
  );
};

export default RecruiterPublicProfile;
