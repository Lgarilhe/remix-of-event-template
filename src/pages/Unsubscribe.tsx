import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle, MailX } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { IconTile } from '@/components/ui/IconTile';
import { Banner } from '@/components/ui/banner';
import { PublicDeadEnd } from '@/components/public/PublicDeadEnd';
import { withPreviewAccessToken } from '@/lib/previewToken';

/**
 * Désinscription des e-mails envoyés par l'intermédiaire de Konekt (séquences
 * des recruteurs, e-mails de service). Un lien expiré et une panne ne se
 * confondent jamais : la panne propose « Réessayer ».
 */
type Status = 'loading' | 'valid' | 'already' | 'invalid' | 'error' | 'success';

const SEO = {
  title: 'Désinscription',
  description: "Ne plus recevoir d'e-mails envoyés par l'intermédiaire de Konekt.",
};

const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [retrying, setRetrying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);

  const validate = useCallback(async () => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
      // 404 et 400 : lien inconnu ou expiré ; toute autre erreur est une panne.
      if (res.status === 404 || res.status === 400) {
        setStatus('invalid');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const data = await res.json();
      if (data.valid === false && data.reason === 'already_unsubscribed') {
        setStatus('already');
        return;
      }
      setStatus(data.valid ? 'valid' : 'invalid');
    } catch {
      setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    void validate();
  }, [validate]);

  const retry = () => {
    setRetrying(true);
    void validate().finally(() => setRetrying(false));
  };

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    setConfirmFailed(false);
    try {
      const { data, error } = await supabase.functions.invoke('handle-email-unsubscribe', { body: { token } });
      if (error) {
        const statusCode = error instanceof FunctionsHttpError ? (error.context as Response | undefined)?.status : undefined;
        if (statusCode === 404 || statusCode === 400) setStatus('invalid');
        else setConfirmFailed(true);
        return;
      }
      if (data?.success) setStatus('success');
      else if (data?.reason === 'already_unsubscribed') setStatus('already');
      else setConfirmFailed(true);
    } catch {
      setConfirmFailed(true);
    } finally {
      setProcessing(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <SEOHead title={SEO.title} description={SEO.description} />
        <Spinner size="lg" label="Vérification du lien de désinscription" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <PublicDeadEnd
        kind="network"
        title="Impossible de vérifier le lien"
        description="La connexion au service a échoué. Vérifiez votre connexion internet, puis réessayez."
        onRetry={retry}
        retrying={retrying}
        seo={SEO}
      />
    );
  }

  if (status === 'invalid') {
    return (
      <PublicDeadEnd
        kind="link"
        title="Ce lien de désinscription n'est plus valide"
        description="Il a peut-être expiré. Utilisez le lien de désinscription du dernier e-mail reçu."
        seo={SEO}
      />
    );
  }

  const homeLink = (
    <Button asChild variant="ghost" className="max-md:h-11">
      <Link to={withPreviewAccessToken('/')}>Aller à l'accueil de Konekt</Link>
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEOHead title={SEO.title} description={SEO.description} />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link
          to={withPreviewAccessToken('/')}
          aria-label="Konekt, accueil"
          className="mb-8 inline-flex min-h-11 items-center rounded-md px-1 md:min-h-0"
        >
          <KonektLogo theme="auto" size={24} ariaLabel="" />
        </Link>

        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center sm:p-8">
          {status === 'valid' && (
            <>
              <IconTile icon={MailX} size="lg" className="mx-auto mb-4" aria-hidden="true" />
              <h1 className="text-lg font-semibold text-foreground">Se désinscrire des e-mails</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Votre adresse ne recevra plus d'e-mails envoyés par l'intermédiaire de Konekt.
              </p>
              {confirmFailed && (
                <Banner tone="danger" icon={AlertTriangle} role="alert" className="mt-5 rounded-lg border text-left">
                  La désinscription n'a pas abouti. Vérifiez votre connexion, puis réessayez.
                </Banner>
              )}
              <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                <Button variant="primary" onClick={() => { void handleUnsubscribe(); }} loading={processing} className="max-md:h-11">
                  {processing ? 'Désinscription…' : confirmFailed ? 'Réessayer la désinscription' : 'Confirmer la désinscription'}
                </Button>
              </div>
            </>
          )}

          {status === 'success' && (
            <div role="status">
              <IconTile icon={CheckCircle} tone="success" size="lg" className="mx-auto mb-4" aria-hidden="true" />
              <h1 className="text-lg font-semibold text-foreground">Désinscription confirmée</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Votre adresse ne recevra plus d'e-mails envoyés par l'intermédiaire de Konekt.
              </p>
              <div className="mt-6 flex justify-center">{homeLink}</div>
            </div>
          )}

          {status === 'already' && (
            <>
              <IconTile icon={CheckCircle} size="lg" className="mx-auto mb-4" aria-hidden="true" />
              <h1 className="text-lg font-semibold text-foreground">Désinscription déjà enregistrée</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Votre adresse ne reçoit déjà plus d'e-mails envoyés par l'intermédiaire de Konekt.
              </p>
              <div className="mt-6 flex justify-center">{homeLink}</div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Unsubscribe;
