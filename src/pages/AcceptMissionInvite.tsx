/**
 * Acceptation d'une invitation à une mission (lien reçu par e-mail).
 *
 * Un seul appel par lien : la requête en cours est gardée dans un ref, un
 * nouveau rendu ou le double montage du mode strict la réutilisent. Relancée à
 * chaque rendu, elle trouvait l'invitation déjà utilisée et la page passait sur
 * « Invitation invalide » juste après un succès (B-01). Seul « Réessayer »
 * relance, après une panne du réseau ou du serveur.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Check, Clock, Link2Off, LogIn, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { ErrorState } from '@/components/layout/ErrorState';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { Spinner } from '@/components/ui/spinner';
import { useAuthReady } from '@/hooks/useAuthReady';
import { withPreviewAccessToken } from '@/lib/previewToken';
import {
  useAcceptMissionInvitation,
  type AcceptMissionInvitationResult,
} from '@/hooks/useMissionInvitations';

type Outcome =
  | { kind: 'success'; projectId: string | null; alreadyMember: boolean }
  | { kind: 'expired' }
  | { kind: 'wrong_account' }
  | { kind: 'invalid' }
  | { kind: 'session' }
  | { kind: 'unreachable' };

/** Une cause par code de la fonction accept-mission-invitation. */
function outcomeOf(result: AcceptMissionInvitationResult): Outcome {
  if (result.ok === true) return { kind: 'success', projectId: result.projectId, alreadyMember: result.alreadyMember };
  switch (result.status) {
    case 410:
      return { kind: 'expired' };
    case 401:
      return { kind: 'session' };
    case 403:
      // Même code pour « autre adresse » et « invitation invalide » : le message tranche.
      return /adresse/i.test(result.message) ? { kind: 'wrong_account' } : { kind: 'invalid' };
    case 400:
    case 404:
      return { kind: 'invalid' };
    default:
      // Pas de réponse, délai dépassé, serveur en panne : réessayer a un sens.
      return { kind: 'unreachable' };
  }
}

const ACTION_CLASS = 'min-h-11 w-full sm:min-h-0 sm:w-auto';

const InviteCard: React.FC<{
  icon: LucideIcon;
  tone: 'default' | 'success' | 'warning';
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}> = ({ icon, tone, title, children, actions }) => (
  // Même anatomie que ErrorState (tuile de 40 px, titre de 14 px) : les issues se lisent comme une famille.
  <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
    <IconTile icon={icon} tone={tone} className="mx-auto mb-3 h-10 w-10" iconClassName="h-5 w-5" aria-hidden="true" />
    <h2 className="text-md font-semibold text-foreground">{title}</h2>
    <div className="mt-1 space-y-2 text-sm text-muted-foreground">{children}</div>
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">{actions}</div>
  </div>
);

export default function AcceptMissionInvite() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const { user } = useAuthReady();
  const { accept } = useAcceptMissionInvitation();
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState(true);
  const requestRef = useRef<{ key: string; promise: Promise<AcceptMissionInvitationResult> } | null>(null);
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setOutcome({ kind: 'invalid' });
      setPending(false);
      return;
    }
    const key = `${token}:${attempt}`;
    if (requestRef.current?.key !== key) {
      requestRef.current = { key, promise: accept(token) };
    }
    let active = true;
    setPending(true);
    requestRef.current.promise
      .then((result) => {
        if (!active) return;
        const next = outcomeOf(result);
        setOutcome(next);
        if (next.kind === 'success' && notifiedRef.current !== key) {
          notifiedRef.current = key;
          toast.success(next.alreadyMember ? 'Vous faisiez déjà partie de cette mission' : 'Invitation acceptée : vous avez rejoint la mission');
        }
      })
      .catch(() => {
        if (active) setOutcome({ kind: 'unreachable' });
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [token, attempt, accept]);

  const backToMissions = (
    <Button asChild variant="outline" className={ACTION_CLASS}>
      <Link to="/missions">Retour aux missions</Link>
    </Button>
  );

  let content: React.ReactNode;
  if (!outcome) {
    content = (
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" label="Acceptation de l'invitation en cours" />
        <p aria-hidden="true" className="text-sm text-muted-foreground">
          Acceptation de l'invitation…
        </p>
      </div>
    );
  } else if (outcome.kind === 'success') {
    content = (
      <InviteCard
        icon={Check}
        tone="success"
        title="Invitation acceptée"
        actions={
          <Button asChild variant="primary" className={ACTION_CLASS}>
            <Link to={outcome.projectId ? `/missions/${outcome.projectId}` : '/missions'}>
              {outcome.projectId ? 'Ouvrir la mission' : 'Voir mes missions'}
            </Link>
          </Button>
        }
      >
        <p>
          {outcome.alreadyMember
            ? "Vous faisiez déjà partie de l'équipe de cette mission."
            : "Vous faites maintenant partie de l'équipe de la mission : vous pouvez sourcer et proposer des candidats."}
        </p>
      </InviteCard>
    );
  } else if (outcome.kind === 'expired') {
    content = (
      <InviteCard icon={Clock} tone="warning" title="Invitation expirée" actions={backToMissions}>
        <p>Ce lien n'est plus valable. Demandez au recruteur qui vous a invité de vous envoyer une nouvelle invitation.</p>
      </InviteCard>
    );
  } else if (outcome.kind === 'wrong_account') {
    content = (
      <InviteCard icon={UserX} tone="warning" title="Invitation destinée à une autre adresse" actions={backToMissions}>
        <p>
          Cette invitation a été envoyée à une autre adresse e-mail que celle de votre compte
          {user?.email ? <> (<span className="text-foreground">{user.email}</span>)</> : null}.
        </p>
        <p>Connectez-vous avec l'adresse qui a reçu l'invitation, ou demandez au recruteur de vous inviter avec celle-ci.</p>
      </InviteCard>
    );
  } else if (outcome.kind === 'invalid') {
    content = (
      <InviteCard
        icon={Link2Off}
        tone="default"
        title="Invitation introuvable"
        actions={
          <Button asChild variant="primary" className={ACTION_CLASS}>
            <Link to="/missions">Voir mes missions</Link>
          </Button>
        }
      >
        <p>Ce lien a déjà été utilisé ou n'existe plus. Si vous avez déjà accepté cette invitation, la mission figure dans votre liste.</p>
      </InviteCard>
    );
  } else if (outcome.kind === 'session') {
    content = (
      <InviteCard
        icon={LogIn}
        tone="default"
        title="Session expirée"
        actions={
          <Button asChild variant="primary" className={ACTION_CLASS}>
            <Link to={withPreviewAccessToken('/auth')} state={{ from: location.pathname }}>
              Se reconnecter
            </Link>
          </Button>
        }
      >
        <p>Reconnectez-vous : l'invitation sera acceptée à votre retour sur cette page.</p>
      </InviteCard>
    );
  } else {
    content = (
      <ErrorState
        className="w-full max-w-md"
        title="L'invitation n'a pas pu être acceptée"
        description="Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez."
        onRetry={() => setAttempt((n) => n + 1)}
        retrying={pending}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <SEOHead title="Invitation à une mission" description="Accepter une invitation à rejoindre une mission" />
      <KonektLogo theme="auto" size={28} />
      <h1 className="sr-only">Invitation à une mission</h1>
      {content}
    </div>
  );
}
