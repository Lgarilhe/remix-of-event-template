import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2, MailX } from 'lucide-react';

const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'valid' | 'already' | 'invalid' | 'success' | 'error'>('loading');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    const validate = async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${token}`;
        const res = await fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
        const data = await res.json();
        if (!res.ok) { setStatus('invalid'); return; }
        if (data.valid === false && data.reason === 'already_unsubscribed') { setStatus('already'); return; }
        if (data.valid) { setStatus('valid'); return; }
        setStatus('invalid');
      } catch { setStatus('invalid'); }
    };
    validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('handle-email-unsubscribe', { body: { token } });
      if (error) throw error;
      if (data?.success) { setStatus('success'); }
      else if (data?.reason === 'already_unsubscribed') { setStatus('already'); }
      else { setStatus('error'); }
    } catch { setStatus('error'); }
    setProcessing(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {status === 'loading' && <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />}
        {status === 'valid' && (
          <>
            <MailX className="w-12 h-12 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Se désabonner</h1>
            <p className="text-muted-foreground">Vous ne recevrez plus d'emails de notre part.</p>
            <Button onClick={handleUnsubscribe} disabled={processing} className="gap-2">
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmer la désinscription
            </Button>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 mx-auto text-emerald-500" />
            <h1 className="text-xl font-semibold text-foreground">Désinscription confirmée</h1>
            <p className="text-muted-foreground">Vous avez été désinscrit avec succès.</p>
          </>
        )}
        {status === 'already' && (
          <>
            <CheckCircle className="w-12 h-12 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Déjà désinscrit</h1>
            <p className="text-muted-foreground">Vous êtes déjà désinscrit de nos emails.</p>
          </>
        )}
        {(status === 'invalid' || status === 'error') && (
          <>
            <XCircle className="w-12 h-12 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold text-foreground">Lien invalide</h1>
            <p className="text-muted-foreground">Ce lien de désinscription est invalide ou a expiré.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
