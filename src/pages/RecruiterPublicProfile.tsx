import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Linkedin, ArrowLeft, Briefcase, Award, Star, Clock, TrendingUp, Play, Quote } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { cn } from '@/lib/utils';

interface Testimonial {
  client_name: string;
  text: string;
  date?: string;
}

interface RecruiterProfile {
  display_name: string | null;
  recruiter_bio: string | null;
  recruiter_headline: string | null;
  linkedin_url: string | null;
  linkedin_skills: string[] | null;
  years_experience: number | null;
  job_title: string | null;
  specializations: string[] | null;
  rating: number | null;
  placements_count: number | null;
  avg_time_to_fill_days: number | null;
  first_round_rate: number | null;
  mid_round_rate: number | null;
  intro_video_url: string | null;
  testimonials: Testimonial[] | null;
}

const RecruiterPublicProfile: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<RecruiterProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }

    Promise.resolve(supabase
      .from('profiles')
      .select('display_name, recruiter_bio, recruiter_headline, linkedin_url, linkedin_skills, years_experience, job_title, specializations, rating, placements_count, avg_time_to_fill_days, first_round_rate, mid_round_rate, intro_video_url, testimonials')
      .eq('public_slug', slug)
      .maybeSingle())
      .then(({ data, error }) => {
        if (error || !data || !data.recruiter_bio) {
          setNotFound(true);
        } else {
          setProfile(data as unknown as RecruiterProfile);
        }
        setLoading(false);
      })
      .catch((e: unknown) => console.error('[RecruiterPublicProfile] Load error:', e));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border border-border border-t-foreground animate-spin" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wider">Profil introuvable</h1>
          <p className="text-muted-foreground text-sm">Ce profil n'existe pas ou n'est plus disponible.</p>
          <Link to="/" className="text-sm underline text-foreground/60 hover:text-foreground">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  const name = profile.display_name || 'Recruteur';
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
  const allSkills = [...(profile.specializations || []), ...(profile.linkedin_skills || [])].filter((v, i, a) => a.indexOf(v) === i);
  const testimonials = (profile.testimonials || []) as Testimonial[];
  const hasStats = profile.placements_count || profile.rating || profile.avg_time_to_fill_days || profile.first_round_rate;

  return (
    <>
      <SEOHead
        title={`${name} — Recruteur | Konekt`}
        description={profile.recruiter_bio?.slice(0, 160) || `Profil de ${name}, recruteur professionnel.`}
      />
      <div className="min-h-screen bg-background">
        {/* Top bar */}
        <div className="border-b-2 border-border px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Konekt
            </Link>
            {profile.linkedin_url && (
              <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                <Linkedin className="w-3.5 h-3.5" /> LinkedIn
              </a>
            )}
          </div>
        </div>

        {/* Profile */}
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border border-border p-6 md:p-8 space-y-6"
            style={{ boxShadow: '4px 4px 0px 0px hsl(var(--primary))' }}
          >
            {/* Header */}
            <div className="flex items-start gap-4">
              <div
                className="w-16 h-16 flex items-center justify-center text-xl font-bold text-white border border-border shrink-0"
                style={{ background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))' }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl md:text-2xl font-bold text-foreground uppercase tracking-tight">{name}</h1>
                {profile.recruiter_headline && (
                  <p className="text-sm text-muted-foreground mt-0.5">{profile.recruiter_headline}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                  {profile.years_experience && profile.years_experience > 0 && (
                    <span className="flex items-center gap-1">
                      <Briefcase className="w-3 h-3" /> {profile.years_experience} ans
                    </span>
                  )}
                  {profile.job_title && (
                    <span className="flex items-center gap-1">
                      <Award className="w-3 h-3" /> {profile.job_title}
                    </span>
                  )}
                  {profile.rating != null && profile.rating > 0 && (
                    <span className="flex items-center gap-1 text-foreground font-bold">
                      <Star className="w-3 h-3" /> {profile.rating.toFixed(1)}/5
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Intro video */}
            {profile.intro_video_url && (
              <div>
                {showVideo ? (
                  <div className="border border-border aspect-video bg-accent/50">
                    <video
                      src={profile.intro_video_url}
                      controls
                      autoPlay
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setShowVideo(true)}
                    className="w-full border border-border p-6 flex items-center justify-center gap-3 hover:bg-accent/50 transition-colors group"
                  >
                    <div className="w-12 h-12 border border-border flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                      <Play className="w-5 h-5 text-foreground ml-0.5" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold uppercase tracking-wider text-foreground">Vidéo d'introduction</p>
                      <p className="text-xs text-muted-foreground">Découvrez {name} en quelques minutes</p>
                    </div>
                  </button>
                )}
              </div>
            )}

            {/* Bio */}
            <div className="border-l-4 border-border pl-4">
              <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{profile.recruiter_bio}</p>
            </div>

            {/* Stats */}
            {hasStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {profile.placements_count != null && profile.placements_count > 0 && (
                  <StatCard
                    value={String(profile.placements_count)}
                    label="Placements"
                    icon={<Award className="w-4 h-4" />}
                  />
                )}
                {profile.avg_time_to_fill_days != null && profile.avg_time_to_fill_days > 0 && (
                  <StatCard
                    value={`${profile.avg_time_to_fill_days}j`}
                    label="Délai moyen"
                    icon={<Clock className="w-4 h-4" />}
                  />
                )}
                {profile.first_round_rate != null && profile.first_round_rate > 0 && (
                  <StatCard
                    value={`${Math.round(profile.first_round_rate * 100)}%`}
                    label="Passage 1er tour"
                    icon={<TrendingUp className="w-4 h-4" />}
                  />
                )}
                {profile.mid_round_rate != null && profile.mid_round_rate > 0 && (
                  <StatCard
                    value={`${Math.round(profile.mid_round_rate * 100)}%`}
                    label="Mid-round rate"
                    icon={<Star className="w-4 h-4" />}
                  />
                )}
              </div>
            )}

            {/* Skills */}
            {allSkills.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Spécialisations
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {allSkills.slice(0, 20).map((skill) => (
                    <span
                      key={skill}
                      className="px-2.5 py-1 text-xs font-semibold border border-border text-foreground/70"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Testimonials */}
            {testimonials.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Témoignages clients
                </h3>
                {testimonials.map((t, i) => (
                  <div key={i} className="border border-border p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <Quote className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground/80 italic leading-relaxed">{t.text}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-foreground">{t.client_name}</p>
                      {t.date && (
                        <p className="text-xs text-muted-foreground">{t.date}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            {profile.linkedin_url && (
              <div className="pt-2 border-t-2 border-border">
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border border-border bg-foreground text-background hover:bg-foreground/90 transition-colors"
                  style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
                >
                  <Linkedin className="w-4 h-4" />
                  Contacter sur LinkedIn
                </a>
              </div>
            )}
          </motion.div>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground/50 mt-8">
            Profil généré par Konekt
          </p>
        </div>
      </div>
    </>
  );
};

/** Stat card sub-component */
const StatCard = ({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) => (
  <div className="border border-border p-3 text-center space-y-1">
    <div className="flex items-center justify-center text-muted-foreground">{icon}</div>
    <p className="text-lg font-bold text-foreground">{value}</p>
    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
  </div>
);

export default RecruiterPublicProfile;
