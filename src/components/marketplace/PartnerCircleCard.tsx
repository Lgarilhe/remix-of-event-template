/**
 * PartnerCircleCard : carte « Cercle partenaires » pour un cabinet ou un
 * indépendant. Explique le fonctionnement, porte le formulaire de demande et
 * reflète le statut de l'organisation (inactive, en attente, active, suspendue).
 * Partagée entre la page Marketplace et Paramètres > Marketplace.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield, Loader2, X, Clock, Ban, CheckCircle2, ArrowRight, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePartnerState } from '@/hooks/useMarketplace';
import { useAuthReady } from '@/hooks/useAuthReady';
import { IconTile } from '@/components/ui/IconTile';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatDate } from './huntLabels';

interface PartnerProfile {
  recruiter_headline: string | null;
  recruiter_bio: string | null;
  specializations: string[] | null;
  linkedin_url: string | null;
}

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
    {children}
  </label>
);

export const PartnerCircleCard: React.FC = () => {
  const { state, isLoading, isError, errorText, refetch, canRequest, requestPartner, isRequesting } = usePartnerState();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;

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
      <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !state) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-foreground">Impossible de charger votre statut partenaire.</p>
            {errorText && <p className="text-xs text-muted-foreground mt-1">{errorText}</p>}
          </div>
        </div>
        <Button size="sm" variant="outline" className="rounded-full" onClick={refetch}>
          Réessayer
        </Button>
      </div>
    );
  }

  const status = state.status;
  // Une demande en attente reste modifiable (le serveur accepte la mise à jour
  // tant qu'elle n'est ni active ni suspendue) ; un membre sans droit ne saisit rien.
  const readOnly = status === 'active' || status === 'suspended' || !canRequest;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <IconTile icon={Shield} size="md" />
        <div>
          <h3 className="font-display text-sm font-bold tracking-tight text-foreground">Cercle partenaires</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Missions confiées par des entreprises aux recruteurs validés par Konekt.
          </p>
        </div>
      </div>

      {status === 'active' ? (
        <div className="rounded-lg border border-success/30 bg-success/10 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              Votre organisation fait partie du cercle partenaires
              {state.validated_at ? ` depuis le ${formatDate(state.validated_at)}` : ''}.
            </p>
            <Link
              to="/marketplace"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4"
            >
              Voir les missions ouvertes <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2 text-sm text-foreground/90 leading-relaxed">
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
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 flex items-start gap-3">
              <Clock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                Demande envoyée{state.requested_at ? ` le ${formatDate(state.requested_at)}` : ''}.
                {' '}L'équipe Konekt examine chaque demande avant d'ouvrir l'accès. Vous pouvez encore
                modifier votre fiche ci dessous.
              </p>
            </div>
          )}

          {status === 'suspended' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
              <Ban className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                Votre accès au cercle est suspendu : vous ne voyez plus les missions ouvertes et ne
                pouvez plus postuler. Vos missions en cours restent accessibles depuis Missions.
                {' '}
                <a href="mailto:l.garilhe@konekt.fr" className="underline underline-offset-4">
                  Écrivez à l'équipe Konekt
                </a>{' '}
                pour comprendre cette décision.
              </p>
            </div>
          )}

          {status === 'inactive' && !canRequest && (
            <p className="text-xs text-muted-foreground">
              Seul un propriétaire ou un administrateur de votre organisation peut envoyer cette demande.
            </p>
          )}

          {status !== 'suspended' && (
            <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t border-border">
              <div>
                <FieldLabel>Titre</FieldLabel>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Recruteur tech senior, 8 ans en cabinet"
                  readOnly={readOnly}
                  maxLength={120}
                />
              </div>
              <div>
                <FieldLabel>Présentation</FieldLabel>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Vos secteurs, vos méthodes, vos derniers placements."
                  rows={4}
                  readOnly={readOnly}
                  maxLength={1500}
                />
              </div>
              <div>
                <FieldLabel>Spécialisations</FieldLabel>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {specializations.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-muted/50 text-xs text-foreground"
                    >
                      {s}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeSpecialization(s)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Retirer ${s}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {readOnly && specializations.length === 0 && (
                    <span className="text-xs text-muted-foreground">Aucune spécialisation renseignée.</span>
                  )}
                </div>
                {!readOnly && (
                  <Input
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
                  />
                )}
              </div>
              <div>
                <FieldLabel>URL LinkedIn</FieldLabel>
                <Input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/in/votre-profil"
                  readOnly={readOnly}
                  inputMode="url"
                />
              </div>

              {!readOnly && (
                <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
                  <Button type="submit" size="sm" className="rounded-full" disabled={isRequesting}>
                    {isRequesting && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                    {status === 'pending_validation' ? 'Mettre à jour ma demande' : 'Demander à rejoindre le cercle'}
                  </Button>
                </div>
              )}
            </form>
          )}
        </>
      )}
    </div>
  );
};

export default PartnerCircleCard;
