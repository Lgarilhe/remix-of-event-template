import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAcceptMissionInvitation } from '@/hooks/useMissionInvitations';
import { SEOHead } from '@/components/SEOHead';
import { Loader2, CheckCircle2 } from 'lucide-react';

export default function AcceptMissionInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { accept } = useAcceptMissionInvitation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setStatus('error'); return; }

    accept(token).then((pId) => {
      if (pId) {
        setProjectId(pId);
        setStatus('success');
      } else {
        setStatus('error');
      }
    });
  }, [token, accept]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <SEOHead title="Invitation mission | Skalr" description="Accepter une invitation" />
      <div className="text-center max-w-md space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Acceptation de l'invitation...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="w-8 h-8 text-foreground mx-auto" />
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">Invitation acceptée</h1>
            <p className="text-xs text-muted-foreground">Vous avez été ajouté à la mission. Vous pouvez maintenant sourcer et proposer des candidats.</p>
            <button
              onClick={() => navigate(projectId ? `/missions/${projectId}` : '/missions')}
              className="relative overflow-hidden h-[34px] px-6 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider group"
            >
              <span className="relative z-10">Voir la mission</span>
              <span className="absolute inset-0 bg-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </button>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-4xl">🔒</div>
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">Invitation invalide</h1>
            <p className="text-xs text-muted-foreground">
              Ce lien d'invitation n'est plus valide ou a expiré. Contactez le recruteur qui vous a invité.
            </p>
            <button
              onClick={() => navigate('/missions')}
              className="text-sm text-foreground underline hover:opacity-70"
            >
              Retour aux missions
            </button>
          </>
        )}
      </div>
    </div>
  );
}
