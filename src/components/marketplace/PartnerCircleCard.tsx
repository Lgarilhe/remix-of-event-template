/**
 * PartnerCircleCard : carte « Cercle partenaires » pour un cabinet ou un
 * indépendant. Explique le fonctionnement, porte le formulaire de demande et
 * reflète le statut de l'organisation (inactive, en attente, active, suspendue).
 * Affichée sur la page Marketplace (l'onglet Marketplace des Paramètres est retiré au lot 3).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield, X, Clock, Ban, CheckCircle2, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePartnerState } from '@/hooks/useMarketplace';
import { useAuthReady } from '@/hooks/useAuthReady';
import { IconTile } from '@/components/ui/IconTile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatDate } from './huntLabels';
import { ErrorBox } from './ErrorBox';

/**
 * Contact du cercle quand l'accès est suspendu (F-31). Adresse personnelle en
 * attendant une adresse d'équipe : à remplacer ici seulement.
 */
const PARTNER_CIRCLE_CONTACT_EMAIL = 'l.garilhe@konekt.fr';

interface PartnerProfile {
  recruiter_headline: string | null;
  recruiter_bio: string | null;
  specializations: string[] | null;
  linkedin_url: string | null;
}

export const PartnerCircleCard: React.FC = () => {
  const { state, isLoading, isError, errorText, refetch, canRequest, requestPartner, isRequesting } = usePartnerState();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const titleId = useId();
  const headlineId = useId();
  const bioId = useId();
  const specsId = useId();
  const specsLabelId = useId();
  const linkedinId = useId();

  // Profil recruteur de l'utilisateur : pré-remplit le formulaire et sert
  // d'affichage en lecture une fois la demande envoyée. La clé porte
  // l'identifiant : un changement de compte ne réutilise pas le profil précédent.
  const { data: profile } = useQuery({
    queryKey: ['marketplace', 'partner-profile', userId],
    queryFn: async (): Promise<PartnerProfile | null> => {
      if (!userId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('recruiter_headline, recruiter_bio, specializations, linkedin_url')
        .eq('user_id', userId)
        .maybeSingle();
      return (data as PartnerProfile | null) ?? null;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [specInput, setSpecInput] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const prefilledFor = useRef<string | null>(null);

  const profileHeadline = profile?.recruiter_headline ?? '';
  const profileBio = profile?.recruiter_bio ?? '';
  const profileLinkedin = profile?.linkedin_url ?? '';
  const profileSpecs = (profile?.specializations ?? []).join('|');

  useEffect(() => {
    if (!userId || !profile || prefilledFor.current === userId) return;
    prefilledFor.current = userId;
    setHeadline(profileHeadline);
    setBio(profileBio);
    setSpecializations(profileSpecs ? profileSpecs.split('|') : []);
    setLinkedinUrl(profileLinkedin);
  }, [userId, profile, profileHeadline, profileBio, profileSpecs, profileLinkedin]);

  const addSpecialization = () => {
    const value = specInput.trim();
    if (!value) return;
    if (!specializations.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setSpecializations((prev) => [...prev, value]);
    }
    setSpecInput('');
  };

  const removeSpecialization = (value: string) => {
    setSpecializations((prev) => prev.filter((s) => s !== value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!headline.trim()) {
      toast.error('Indiquez un titre');
      return;
    }
    if (!bio.trim()) {
      toast.error('Ajoutez une présentation');
      return;
    }
    const url = linkedinUrl.trim();
    if (!/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//i.test(url)) {
      toast.error('Indiquez l\'adresse de votre profil LinkedIn (https://www.linkedin.com/in/...)');
      return;
    }
    // Une puce en cours de saisie mais non validée par Entrée est conservée.
    const specs = specInput.trim() && !specializations.includes(specInput.trim())
      ? [...specializations, specInput.trim()]
      : specializations;
    try {
      await requestPartner({ headline, bio, specializations: specs, linkedin_url: url });
      setSpecInput('');
    } catch {
      // Erreur déjà affichée par le hook
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6" aria-busy="true">
        <span className="sr-only" role="status">Chargement de votre statut partenaire</span>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (isError || !state) {
    return (
      <ErrorBox
        title="Impossible de charger votre statut partenaire."
        detail={errorText ?? 'Vérifiez votre connexion, puis réessayez.'}
        onRetry={refetch}
      />
    );
  }

  const status = state.status;
  // Une demande en attente reste modifiable (le serveur accepte la mise à jour
  // tant qu'elle n'est ni active ni suspendue) ; un membre sans droit ne saisit rien.
  const readOnly = status === 'active' || status === 'suspended' || !canRequest;

  return (
    <section aria-labelledby={titleId} className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <IconTile icon={Shield} size="md" aria-hidden="true" />
        <div>
          <h2 id={titleId} className="text-md font-semibold text-foreground">Cercle partenaires</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Missions confiées par des entreprises aux recruteurs validés par Konekt.
          </p>
        </div>
      </div>

      {status === 'active' ? (
        <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success-muted p-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              Votre organisation fait partie du cercle partenaires
              {state.validated_at ? ` depuis le ${formatDate(state.validated_at)}` : ''}.
            </p>
            <Link
              to="/marketplace"
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Voir les missions ouvertes <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2 text-sm leading-relaxed text-foreground-secondary">
            <p>
              Des entreprises publient des missions de recrutement sur Konekt. Les recruteurs du cercle
              voient ces missions et travaillent dessus avec l'entreprise : recherche, scoring, pipeline.
            </p>
            <p>
              Vous postulez à une mission avec un message. L'entreprise accepte ou refuse. Une fois accepté,
              vous retrouvez la mission dans votre liste et vous sourcez directement dans l'espace de travail.
            </p>
            <p>
              La rémunération est un pourcentage du salaire annuel, fixé par l'entreprise sur chaque mission.
              Vous la facturez directement à l'entreprise à l'embauche. Konekt ne prend pas de commission pendant la bêta.
            </p>
          </div>

          {status === 'pending_validation' && (
            <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning-muted p-4">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-sm text-foreground">
                Demande envoyée{state.requested_at ? ` le ${formatDate(state.requested_at)}` : ''}.
                {' '}L'équipe Konekt examine chaque demande avant d'ouvrir l'accès. Vous pouvez encore
                modifier votre fiche ci-dessous.
              </p>
            </div>
          )}

          {status === 'suspended' && (
            <div className="flex items-start gap-3 rounded-lg border border-danger/25 bg-danger-muted p-4">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="text-sm text-foreground">
                Votre accès au cercle est suspendu : vous ne voyez plus les missions ouvertes et ne
                pouvez plus postuler. Vos missions en cours restent accessibles depuis Missions.
                {' '}
                <a
                  href={`mailto:${PARTNER_CIRCLE_CONTACT_EMAIL}`}
                  className="rounded-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Écrivez à l'équipe Konekt
                </a>{' '}
                pour comprendre cette décision.
              </p>
            </div>
          )}

          {status === 'inactive' && !canRequest && (
            <p className="text-sm text-muted-foreground">
              Seul un propriétaire ou un administrateur de votre organisation peut envoyer cette demande.
            </p>
          )}

          {status !== 'suspended' && (
            <form onSubmit={handleSubmit} className="space-y-4 border-t border-border pt-4">
              <div className="space-y-2">
                <Label htmlFor={headlineId}>Titre</Label>
                <Input
                  id={headlineId}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Recruteur tech senior, 8 ans en cabinet"
                  readOnly={readOnly}
                  maxLength={120}
                  className="h-11 md:h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={bioId}>Présentation</Label>
                <Textarea
                  id={bioId}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Vos secteurs, vos méthodes, vos derniers placements."
                  rows={4}
                  readOnly={readOnly}
                  maxLength={1500}
                />
              </div>
              <div className="space-y-2">
                {readOnly ? (
                  <p id={specsLabelId} className="text-sm font-medium leading-none">Spécialisations</p>
                ) : (
                  <Label htmlFor={specsId} id={specsLabelId}>Spécialisations</Label>
                )}
                {(specializations.length > 0 || readOnly) && (
                  <ul aria-labelledby={specsLabelId} className="flex flex-wrap gap-1.5">
                    {specializations.map((s) => (
                      <li
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2.5 pr-1 text-xs text-foreground"
                      >
                        {s}
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeSpecialization(s)}
                            aria-label={`Retirer ${s}`}
                            className="relative h-5 w-5 rounded-full text-muted-foreground after:absolute after:-inset-3 after:content-[''] hover:text-foreground [&_svg]:size-3"
                          >
                            <X aria-hidden="true" />
                          </Button>
                        )}
                      </li>
                    ))}
                    {readOnly && specializations.length === 0 && (
                      <li className="text-sm text-muted-foreground">Aucune spécialisation renseignée.</li>
                    )}
                  </ul>
                )}
                {!readOnly && (
                  <Input
                    id={specsId}
                    value={specInput}
                    onChange={(e) => setSpecInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSpecialization();
                      }
                    }}
                    onBlur={addSpecialization}
                    placeholder="Ajoutez une spécialisation puis appuyez sur Entrée"
                    maxLength={60}
                    className="h-11 md:h-9"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={linkedinId}>Adresse du profil LinkedIn</Label>
                <Input
                  id={linkedinId}
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/in/votre-profil"
                  readOnly={readOnly}
                  inputMode="url"
                  className="h-11 md:h-9"
                />
              </div>

              {!readOnly && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <Button type="submit" variant="primary" loading={isRequesting} className="min-h-11 md:min-h-0">
                    {status === 'pending_validation' ? 'Mettre à jour ma demande' : 'Demander à rejoindre le cercle'}
                  </Button>
                </div>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
};

export default PartnerCircleCard;
