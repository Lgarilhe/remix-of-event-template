import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { PageLayout } from '@/components/layout/PageLayout';
import { ErrorState } from '@/components/layout/ErrorState';
import { Button } from '@/components/ui/button';
import { Illustration, type IllustrationName } from '@/components/ui/illustration';
import { Spinner } from '@/components/ui/spinner';
import { useConnection } from '@/hooks/useConnection';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { RETURN_PAGE, SUCCESS, successTitle } from '@/lib/connectionCopy';
import { forgetReturnTarget, readReturnTarget, returnTargetPath } from '@/components/connections/returnTarget';
import {
  CONNECTIONS_PATH,
  connectionsAnchor,
  failedBody,
  readReturnState,
  serverReturnTarget,
  viewOfPoll,
  type ReturnView,
} from '@/components/connections/returnState';

/**
 * Retour d'une connexion de compte (/settings/account/connections/retour).
 *
 * La page lit une seule valeur de l'adresse, `state` : l'identifiant de la
 * tentative que Konekt a créée au départ. Le reste de l'adresse est ignoré : le
 * résultat vient de l'état de la tentative côté serveur (connection_status), qui
 * vérifie qu'elle appartient à la personne connectée. Tant que le compte n'est
 * pas rattaché, la page se met à jour toute seule, puis propose de revérifier.
 */

type Card = { illustration: IllustrationName; title: string; body?: string };

function cardOf(view: ReturnView): Card | null {
  switch (view.kind) {
    case 'success':
      return { illustration: 'valide', title: successTitle(view.provider), body: view.accountName ? SUCCESS.accountLine(view.accountName) : undefined };
    case 'failed':
      return { illustration: 'connexion', title: RETURN_PAGE.failedTitle, body: failedBody(view.message) };
    case 'expired':
      return { illustration: 'orientation', title: RETURN_PAGE.expiredTitle, body: RETURN_PAGE.expiredBody };
    case 'cancelled':
      return { illustration: 'orientation', title: RETURN_PAGE.cancelledTitle, body: RETURN_PAGE.cancelledBody };
    case 'invalid':
      return { illustration: 'orientation', title: RETURN_PAGE.invalidTitle, body: RETURN_PAGE.invalidBody };
    case 'not_found':
      return { illustration: 'orientation', title: RETURN_PAGE.notFoundTitle, body: RETURN_PAGE.notFoundBody };
    default:
      return null;
  }
}

const ConnectReturn = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const attemptId = readReturnState(location.search);
  const { watch, stopWatching, refreshAccounts } = useConnection();
  const [view, setView] = useState<ReturnView>(attemptId ? { kind: 'reading' } : { kind: 'invalid' });
  const [rechecking, setRechecking] = useState(false);
  // Destination gardée par le serveur avec la tentative : prime sur la note locale, qui ne survit pas à un autre navigateur.
  const [serverTarget, setServerTarget] = useState<'onboarding' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const run = useCallback(() => {
    if (!attemptId) return undefined;
    const handle = watch(attemptId, {
      // Tentative encore en cours : la page l'annonce, sans clignoter à chaque lecture.
      onUpdate: (read) => {
        const target = serverReturnTarget(read);
        if (target) setServerTarget(target);
        if (read.status === 'pending') setView((current) => (current.kind === 'waiting' ? current : { kind: 'waiting', slow: false }));
      },
    });
    void handle.result
      .then((result) => {
        if (result.kind === 'aborted') return;
        const target = serverReturnTarget(result);
        if (target) setServerTarget(target);
        const next = viewOfPoll(result);
        setView(next);
        if (next.kind === 'success') void refreshAccounts();
      })
      .catch(() => setView({ kind: 'load_error', message: RETURN_PAGE.loadErrorBody }))
      .finally(() => setRechecking(false));
    return handle;
  }, [attemptId, watch, refreshAccounts]);

  useEffect(() => {
    if (!attemptId) {
      setView({ kind: 'invalid' });
      return undefined;
    }
    setView({ kind: 'reading' });
    setServerTarget(null);
    const handle = run();
    return () => {
      handle?.stop();
      stopWatching();
    };
  }, [attemptId, run, stopWatching]);

  // Le titre prend le focus à chaque nouvel écran : la personne entend le résultat. L'attente
  // lente est un autre écran (autre titre, bouton « Revérifier ») : sa clé compte aussi, sinon le
  // focus tombe sur le corps de la page quand « Revérifier » remplace l'écran.
  const screenKey = `${view.kind}:${view.kind === 'waiting' && view.slow ? 'slow' : 'fast'}`;
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [screenKey]);

  const recheck = () => {
    setRechecking(true);
    setView({ kind: 'waiting', slow: false });
    run();
  };

  const provider = view.kind === 'success' ? view.provider : null;
  // Connexion lancée depuis l'installation : le bouton la reprend (?li=ok attend le compte, ?li=ko propose
  // de réessayer). ?li=ok seulement une fois le compte rattaché : tant que l'état est inconnu (lecture
  // impossible, attente lente), l'installation ne doit pas attendre un compte qui n'existe peut-être pas.
  const resume = returnTargetPath(serverTarget ?? readReturnTarget(attemptId), view.kind === 'success');

  // Depuis l'installation, une connexion réussie reprend toute seule : pas de clic de plus dans le tunnel.
  const resumeSearch = resume?.search;
  const resumePath = resume?.pathname;
  const resumeAuto = view.kind === 'success' && resumePath !== undefined;
  useEffect(() => {
    if (!resumeAuto || !resumePath) return;
    forgetReturnTarget();
    navigate(withPreviewAccessToken(resumePath, resumeSearch ?? ''), { replace: true });
  }, [resumeAuto, resumePath, resumeSearch, navigate]);
  const backTo = resume
    ? withPreviewAccessToken(resume.pathname, resume.search)
    : withPreviewAccessToken(CONNECTIONS_PATH, '', view.kind === 'success' ? connectionsAnchor(provider) : '');
  const backLabel = resume ? RETURN_PAGE.backToOnboarding : RETURN_PAGE.back;
  const backButton = (
    <Button asChild variant="primary" className="max-md:h-11" onClick={resume ? () => forgetReturnTarget() : undefined}>
      <Link to={backTo}>{backLabel}</Link>
    </Button>
  );

  const terminal = cardOf(view);
  let body: ReactNode;
  if (terminal) {
    body = (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <Illustration name={terminal.illustration} size="md" tile={false} className="mx-auto mb-4" />
        <h1 ref={headingRef} tabIndex={-1} className="text-md font-semibold text-foreground focus:outline-none">{terminal.title}</h1>
        {terminal.body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{terminal.body}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{backButton}</div>
      </div>
    );
  } else if (view.kind === 'load_error') {
    body = (
      <ErrorState
        title={RETURN_PAGE.loadErrorTitle}
        description={view.message}
        onRetry={recheck}
        retrying={rechecking}
        action={<Button asChild variant="ghost" className="max-md:h-11"><Link to={backTo}>{backLabel}</Link></Button>}
      />
    );
  } else if (view.kind === 'waiting' && view.slow) {
    body = (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-md font-semibold text-foreground focus:outline-none">{RETURN_PAGE.slowTitle}</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{RETURN_PAGE.slowBody}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="default" onClick={recheck} loading={rechecking} className="max-md:h-11">
            {!rechecking && <RefreshCw aria-hidden="true" />}
            {rechecking ? RETURN_PAGE.recheckBusy : RETURN_PAGE.recheck}
          </Button>
          <Button asChild variant="ghost" className="max-md:h-11"><Link to={backTo}>{backLabel}</Link></Button>
        </div>
      </div>
    );
  } else {
    // Lecture en cours, puis attente du rattachement du compte.
    const waiting = view.kind === 'waiting';
    body = (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        {/* Décoratif : le titre, qui prend le focus, dit déjà ce qui se passe. */}
        <span aria-hidden="true" className="mb-4 flex justify-center"><Spinner size="lg" /></span>
        <h1 ref={headingRef} tabIndex={-1} className="text-md font-semibold text-foreground focus:outline-none">{RETURN_PAGE.reading}</h1>
        {waiting && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{RETURN_PAGE.waiting}</p>}
      </div>
    );
  }

  return (
    <PageLayout maxWidth="sm">
      <SEOHead title={RETURN_PAGE.documentTitle} description={RETURN_PAGE.documentDescription} />
      <div className="mx-auto max-w-md">{body}</div>
    </PageLayout>
  );
};

export default ConnectReturn;
