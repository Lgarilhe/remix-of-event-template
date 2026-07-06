import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { normalizeAiContext } from '@/hooks/useAiContext';
import { buildAiContextDraft, buildSignatureHtml, type EnrichmentSnapshot } from '@/lib/activationDrafts';
import { toast } from 'sonner';
import type { OnboardingCompanyData } from '@/pages/Onboarding';

/**
 * SceneExpressSettings — dernier écran de l'onboarding (« Réglages express »).
 *
 * Demande du 06/07 : remplir dès l'inscription un maximum de réglages que
 * l'app CONSOMME réellement (audit tracé écriture→lecture), pré-rédigés quand
 * c'est possible — sans jamais bloquer :
 *  1. poste → {{mon_poste}} + signature,
 *  2. email d'envoi → sans lui les étapes email des séquences ne partent pas,
 *  3. signature email par défaut (pré-rédigée, sequence-send-email),
 *  4. contexte IA org (pré-rédigé depuis la fiche société, 9+ fonctions IA).
 * Le reste (ICP, équipe, missions) reste dans la checklist du dashboard.
 */

interface EmailAccount {
  id: string;
  name?: string;
  identifier?: string;
  status?: string;
  type?: string;
}

interface Props {
  orgId: string | null;
  orgName: string | null;
  companyData: OnboardingCompanyData | null;
  onFinish: () => void;
  onBack: () => void;
  /** 04 en enterprise/agency, 03 en freelance. */
  stepLabel?: string;
}

export const SceneExpressSettings: React.FC<Props> = ({ orgId, orgName, companyData, onFinish, onBack, stepLabel = '04' }) => {
  const { displayName } = useCurrentProfile();

  const [jobTitle, setJobTitle] = useState('');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [includeAiContext, setIncludeAiContext] = useState(true);
  const [aiContextText, setAiContextText] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Email d'envoi (même mécanique que Réglages : lien hébergé + détection) ──
  const [emailConnecting, setEmailConnecting] = useState(false);
  const [emailLinked, setEmailLinked] = useState<string | null>(null);
  const baselineIdsRef = useRef<Set<string> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pré-rédaction du contexte IA depuis la fiche société de l'écran 2.
  useEffect(() => {
    const snapshot: EnrichmentSnapshot | null = companyData
      ? {
          name: companyData.name,
          domain: companyData.domain,
          industry: companyData.industry ?? null,
          size: companyData.size ?? null,
          location: companyData.location ?? null,
          description: companyData.description ?? null,
        }
      : null;
    const draft = buildAiContextDraft(snapshot, orgName || '');
    setAiContextText(draft.free_text);
    // Volontairement au mount uniquement : l'utilisateur peut éditer ensuite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
  }, []);

  const listEmailAccounts = useCallback(async (): Promise<EmailAccount[]> => {
    const { data } = await invokeEdgeFunction('unipile-accounts', { action: 'list_email' });
    return ((data as any)?.accounts as EmailAccount[]) || [];
  }, []);

  const handleConnectEmail = async (provider: 'GOOGLE' | 'OUTLOOK') => {
    setEmailConnecting(true);
    try {
      if (!baselineIdsRef.current) {
        const existing = await listEmailAccounts();
        baselineIdsRef.current = new Set(existing.map((a) => a.id));
      }
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'hosted_auth_link',
        providers: [provider],
        success_redirect_url: window.location.href,
        failure_redirect_url: window.location.href,
        org_name: orgName || undefined,
      });
      if (!(data as any)?.success || !(data as any).url) {
        throw new Error((data as any)?.error || 'Erreur lors de la génération du lien');
      }
      window.open((data as any).url, '_blank', 'noopener,noreferrer');
      toast.info('Fenêtre de connexion ouverte — revenez ici après connexion, la détection est automatique.');

      // Détection + association automatique : à l'onboarding l'utilisateur est
      // seul dans son espace, le nouveau compte email est forcément le sien.
      if (pollingRef.current) clearInterval(pollingRef.current);
      let attempts = 0;
      pollingRef.current = setInterval(async () => {
        attempts++;
        if (attempts > 30) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          return;
        }
        try {
          const accounts = await listEmailAccounts();
          const fresh = accounts.find((a) => !baselineIdsRef.current!.has(a.id));
          if (fresh && orgId) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { error } = await (supabase as any).from('member_email_accounts').upsert({
                organization_id: orgId,
                user_id: user.id,
                email_account_id: fresh.id,
                email_address: fresh.identifier || fresh.name || null,
                provider: fresh.type || null,
                linked_by: user.id,
              }, { onConflict: 'organization_id,email_account_id' });
              if (error) {
                console.error('[SceneExpressSettings] Email link failed:', error);
              } else {
                setEmailLinked(fresh.identifier || fresh.name || 'Compte connecté');
                toast.success('Email d\'envoi connecté');
              }
            }
          }
        } catch {
          // erreurs de polling ignorées
        }
      }, 10000);
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la connexion');
    } finally {
      setEmailConnecting(false);
    }
  };

  // ── Aperçu signature (recalculé en direct avec le poste saisi) ──
  const signatureHtml = buildSignatureHtml({
    displayName,
    jobTitle: jobTitle.trim() || null,
    orgName,
    website: companyData?.domain ? `https://${companyData.domain}` : null,
  });

  const handleValidate = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      const tasks: Promise<unknown>[] = [];

      if (jobTitle.trim()) {
        tasks.push(
          (supabase as any).from('profiles').upsert(
            { user_id: user.id, job_title: jobTitle.trim() },
            { onConflict: 'user_id' },
          ),
        );
      }
      if (includeSignature && orgId) {
        tasks.push(
          (supabase as any).from('email_signatures').insert({
            organization_id: orgId,
            name: 'Signature par défaut',
            content: signatureHtml,
            is_default: true,
            created_by: user.id,
          }),
        );
      }
      if (includeAiContext && aiContextText.trim() && orgId) {
        const normalized = normalizeAiContext({ tone: 'vous', specialty: companyData?.industry || '', do: [], dont: [], free_text: aiContextText.trim() });
        tasks.push(
          (supabase as any).from('organizations').update({ ai_context: normalized }).eq('id', orgId),
        );
      }

      const results = await Promise.allSettled(tasks);
      const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any)?.error));
      if (failed.length) console.error('[SceneExpressSettings] Some settings failed:', failed);

      onFinish();
    } catch (err: any) {
      console.error('[SceneExpressSettings] Validate failed:', err);
      toast.error(err?.message || "Erreur lors de l'enregistrement");
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-wider font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          {stepLabel} — Réglages express
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Prêt à l'emploi dès aujourd'hui</h2>
        <p className="text-muted-foreground text-sm">
          30 secondes pour que vos messages partent avec votre voix, votre signature et votre email.
        </p>
      </div>

      {/* 1. Poste */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-border p-3.5 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Votre poste</p>
        <Input
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Talent Acquisition Manager"
          className="border border-border text-sm h-10"
        />
        <p className="text-[11px] text-muted-foreground">Utilisé dans vos signatures et messages ({'{{mon_poste}}'}).</p>
      </motion.div>

      {/* 2. Email d'envoi */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="border border-border p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Votre email d'envoi</p>
          {emailLinked && (
            <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'hsl(var(--skalr-green))' }}>
              <Check className="w-3.5 h-3.5" /> {emailLinked}
            </span>
          )}
        </div>
        {!emailLinked && (
          <>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleConnectEmail('GOOGLE')} disabled={emailConnecting} className="flex-1 gap-1.5 border border-border text-xs">
                {emailConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Gmail
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleConnectEmail('OUTLOOK')} disabled={emailConnecting} className="flex-1 gap-1.5 border border-border text-xs">
                {emailConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Outlook
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Sans lui, les étapes email de vos séquences ne peuvent pas partir. Détection automatique après connexion.</p>
          </>
        )}
      </motion.div>

      {/* 3. Signature pré-rédigée */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="border border-border p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Signature email — pré-rédigée
          </p>
          <Switch checked={includeSignature} onCheckedChange={setIncludeSignature} />
        </div>
        {includeSignature && (
          <div
            className="text-sm border-l-2 border-foreground/20 pl-3 py-1 [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: signatureHtml }}
          />
        )}
        <p className="text-[11px] text-muted-foreground">Ajoutée à la fin de vos emails de séquence — ajustable dans Réglages.</p>
      </motion.div>

      {/* 4. Contexte IA pré-rédigé */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="border border-border p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Votre voix de marque — pré-rédigée
          </p>
          <Switch checked={includeAiContext} onCheckedChange={setIncludeAiContext} />
        </div>
        {includeAiContext && (
          <Textarea
            value={aiContextText}
            onChange={(e) => setAiContextText(e.target.value)}
            rows={4}
            className="text-sm border border-border"
          />
        )}
        <p className="text-[11px] text-muted-foreground">Guide tous les messages générés par l'IA (approches, réponses, relances).</p>
      </motion.div>

      {/* Navigation */}
      <div className="flex flex-col items-end gap-1.5 pt-1">
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onBack} className="gap-2 border border-border text-sm">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            onClick={handleValidate}
            disabled={saving}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {saving ? 'Enregistrement…' : 'Tout valider et entrer dans Konekt'}
          </Button>
        </div>
        <button onClick={onFinish} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
          Plus tard — tout reste accessible depuis la checklist du tableau de bord
        </button>
      </div>
    </div>
  );
};
