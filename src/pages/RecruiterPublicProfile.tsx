import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Award, Briefcase, Clock, Linkedin, Quote, Star, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { StatTile } from '@/components/layout';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicDeadEnd } from '@/components/public/PublicDeadEnd';
import { withPreviewAccessToken } from '@/lib/previewToken';

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

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

const percent = (rate: number) => `${Math.round(rate * 100)} %`;

const RecruiterPublicProfile: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<RecruiterProfile | null>(null);
  const [status, setStatus] = useState<LoadState>('loading');
  const [retrying, setRetrying] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!slug) {
      setStatus('missing');
      return;
    }
    try {
      // Colonnes publiques uniquement : le rôle anonyme n'a le droit de lire qu'elles.
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, recruiter_bio, recruiter_headline, linkedin_url, linkedin_skills, years_experience, job_title, specializations, rating, placements_count, avg_time_to_fill_days, first_round_rate, mid_round_rate, intro_video_url, testimonials')
        .eq('public_slug', slug)
        .maybeSingle();
      if (error) {
        console.error('[RecruiterPublicProfile] Load error:', error);
        setStatus('error');
        return;
      }
      if (!data || !data.recruiter_bio) {
        setStatus('missing');
        return;
      }
      setProfile(data as unknown as RecruiterProfile);
      setStatus('ready');
    } catch (e: unknown) {
      console.error('[RecruiterPublicProfile] Load error:', e);
      setStatus('error');
    }
  }, [slug]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const retry = () => {
    setRetrying(true);
    void loadProfile().finally(() => setRetrying(false));
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" label="Chargement du profil" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <PublicDeadEnd
        kind="network"
        title="Impossible d'afficher ce profil"
        description="La connexion au service a échoué. Vérifiez votre connexion internet, puis réessayez."
        onRetry={retry}
        retrying={retrying}
        seo={{ title: 'Profil de recruteur', description: 'Profil public de recruteur sur Konekt.' }}
      />
    );
  }

  if (status === 'missing' || !profile) {
    return (
      <PublicDeadEnd
        kind="missing"
        title="Profil introuvable"
        description="Ce profil n'existe pas ou n'est plus public."
        action={
          <Button asChild variant="outline" className="max-md:h-11">
            <Link to={withPreviewAccessToken('/')}>Aller à l'accueil de Konekt</Link>
          </Button>
        }
        seo={{ title: 'Profil introuvable', description: 'Profil public de recruteur sur Konekt.' }}
      />
    );
  }

  const name = profile.display_name || 'Recruteur';
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
  const allSkills = [...(profile.specializations || []), ...(profile.linkedin_skills || [])].filter((v, i, a) => a.indexOf(v) === i);
  const testimonials = (profile.testimonials || []) as Testimonial[];
  const stats = [
    profile.placements_count != null && profile.placements_count > 0 && { label: 'Placements', value: String(profile.placements_count), icon: Award },
    profile.avg_time_to_fill_days != null && profile.avg_time_to_fill_days > 0 && { label: 'Délai moyen de recrutement', value: `${profile.avg_time_to_fill_days} jours`, icon: Clock },
    profile.first_round_rate != null && profile.first_round_rate > 0 && { label: 'Passage au 1er tour', value: percent(profile.first_round_rate), icon: TrendingUp },
    profile.mid_round_rate != null && profile.mid_round_rate > 0 && { label: 'Passage aux tours intermédiaires', value: percent(profile.mid_round_rate), icon: Star },
  ].filter(Boolean) as { label: string; value: string; icon: React.ElementType }[];

  return (
    <>
      <SEOHead
        title={`${name}, recruteur`}
        description={profile.recruiter_bio?.slice(0, 160) || `Profil de ${name}, recruteur professionnel.`}
      />
      <div className="flex min-h-screen flex-col bg-background">
        <PublicHeader
          width="narrow"
          actions={
            profile.linkedin_url && (
              <Button asChild variant="ghost" size="sm" className="max-md:h-11">
                <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer">
                  <Linkedin aria-hidden="true" />
                  LinkedIn
                  <span className="sr-only">(s'ouvre dans un nouvel onglet)</span>
                </a>
              </Button>
            )
          }
        />

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
          <article className="space-y-8 rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="recruteur-nom">
            {/* Identité */}
            <header className="flex items-start gap-4">
              <span
                className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-muted text-lg font-semibold text-foreground-secondary"
                aria-hidden="true"
              >
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <h1 id="recruteur-nom" className="text-2xl font-semibold tracking-tight text-foreground">{name}</h1>
                {profile.recruiter_headline && (
                  <p className="mt-0.5 text-sm text-foreground-secondary">{profile.recruiter_headline}</p>
                )}
                <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {profile.years_experience != null && profile.years_experience > 0 && (
                    <li className="flex items-center gap-1">
                      <Briefcase className="h-3.5 w-3.5" aria-hidden="true" /> {profile.years_experience} ans d'expérience
                    </li>
                  )}
                  {profile.job_title && (
                    <li className="flex items-center gap-1">
                      <Award className="h-3.5 w-3.5" aria-hidden="true" /> {profile.job_title}
                    </li>
                  )}
                  {profile.rating != null && profile.rating > 0 && (
                    <li className="flex items-center gap-1 font-semibold text-foreground">
                      <Star className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Note moyenne : </span>
                      {profile.rating.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}/5
                    </li>
                  )}
                </ul>
              </div>
            </header>

            {/* Vidéo de présentation : pas de lecture automatique, image entière */}
            {profile.intro_video_url && (
              <section aria-labelledby="recruteur-video" className="space-y-2">
                <h2 id="recruteur-video" className="text-sm font-semibold text-foreground">Vidéo de présentation</h2>
                <div className="aspect-video overflow-hidden rounded-lg border border-border bg-muted">
                  <video
                    src={profile.intro_video_url}
                    controls
                    preload="metadata"
                    className="h-full w-full object-contain"
                    aria-label={`Vidéo de présentation de ${name}`}
                  />
                </div>
              </section>
            )}

            {/* Présentation */}
            <p className="whitespace-pre-wrap text-md leading-relaxed text-foreground-secondary">{profile.recruiter_bio}</p>

            {/* Chiffres */}
            {stats.length > 0 && (
              <section aria-labelledby="recruteur-chiffres">
                <h2 id="recruteur-chiffres" className="sr-only">Chiffres clés</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {stats.map((stat) => (
                    <StatTile key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} className="bg-background" />
                  ))}
                </div>
              </section>
            )}

            {/* Spécialisations */}
            {allSkills.length > 0 && (
              <section aria-labelledby="recruteur-specialisations" className="space-y-2">
                <h2 id="recruteur-specialisations" className="text-sm font-semibold text-foreground">Spécialisations</h2>
                <ul className="flex flex-wrap gap-1.5">
                  {allSkills.slice(0, 20).map((skill) => (
                    <li key={skill}>
                      <Badge variant="outline">{skill}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Témoignages */}
            {testimonials.length > 0 && (
              <section aria-labelledby="recruteur-temoignages" className="space-y-3">
                <h2 id="recruteur-temoignages" className="text-sm font-semibold text-foreground">Témoignages clients</h2>
                {testimonials.map((t, i) => (
                  <figure key={i} className="space-y-2 rounded-lg border border-border bg-background p-4">
                    <blockquote className="flex items-start gap-2">
                      <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <p className="text-sm leading-relaxed text-foreground-secondary">{t.text}</p>
                    </blockquote>
                    <figcaption className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-foreground">{t.client_name}</span>
                      {t.date && <span className="text-muted-foreground">{t.date}</span>}
                    </figcaption>
                  </figure>
                ))}
              </section>
            )}

            {/* Contact */}
            {profile.linkedin_url && (
              <div className="border-t border-border pt-6">
                <Button asChild variant="primary" className="max-md:h-11 max-sm:w-full">
                  <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer">
                    <Linkedin aria-hidden="true" />
                    Contacter sur LinkedIn
                    <span className="sr-only">(s'ouvre dans un nouvel onglet)</span>
                  </a>
                </Button>
              </div>
            )}
          </article>

          <p className="mt-8 text-center text-xs text-muted-foreground">Profil publié avec Konekt</p>
        </main>
      </div>
    </>
  );
};

export default RecruiterPublicProfile;
