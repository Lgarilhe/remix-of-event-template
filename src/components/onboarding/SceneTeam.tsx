import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Send, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

import linkedinLogo from '@/assets/linkedin-logo.webp';

interface Props {
  organizationId: string | null;
  onFinish: (invitedCount: number) => void;
  onBack: () => void;
}

interface SuggestedProfile {
  id: string;
  name: string;
  role: string;
  email?: string;
  source: 'linkedin' | 'apollo';
}

export const SceneTeam: React.FC<Props> = ({ organizationId, onFinish, onBack }) => {
  const { accounts } = useLinkedInAccounts();
  const { organization } = useOrganization();
  const { inviteMember, isInviting } = useOrganizationMembers(organizationId);

  const hasLinkedIn = accounts.length > 0;

  const [scanPhase, setScanPhase] = useState<'idle' | 'scanning' | 'results'>('idle');
  const [profiles, setProfiles] = useState<SuggestedProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Manual invite
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);

  const startScan = useCallback(async () => {
    setScanPhase('scanning');
    const orgName = organization?.name || '';
    const results: SuggestedProfile[] = [];

    try {
      // Run Apollo + LinkedIn searches in parallel
      const searches = [];

      // Search for HR people at the org
      const searchParams: Record<string, any> = {
        job_company_name: orgName,
        job_title: 'RH,Recruteur,Recruiter,Talent Acquisition,HR,DRH,Manager',
        job_title_role: 'human_resources',
        per_page: 10,
      };

      // Add location filter if org has a website (use France as default)
      searchParams.person_locations = 'France';

      searches.push(
        invokeEdgeFunction('apollo-search', searchParams).then(({ data }) => {
          if (data?.success && Array.isArray((data as any).prospects)) {
            for (const p of (data as any).prospects) {
              results.push({
                id: p.id || crypto.randomUUID(),
                name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
                role: p.job_title || p.headline || '',
                email: p.emails?.[0] || null,
                source: 'apollo',
              });
            }
          }
        }).catch((err) => {
          console.warn('[SceneTeam] Search failed:', err);
        })
      );

      // LinkedIn search if connected
      if (hasLinkedIn && accounts[0]) {
        searches.push(
          invokeEdgeFunction('unipile-search', {
            action: 'search',
            account_id: accounts[0].id,
            keywords: `${orgName} RH Recruteur Manager`,
            limit: 10,
          }).then(({ data }) => {
            if (data?.success && Array.isArray((data as any).results)) {
              for (const p of (data as any).results) {
                // Avoid duplicates by name
                const name = p.full_name || p.name || '';
                if (name && !results.some(r => r.name.toLowerCase() === name.toLowerCase())) {
                  results.push({
                    id: p.id || p.profile_id || crypto.randomUUID(),
                    name,
                    role: p.headline || p.job_title || '',
                    source: 'linkedin',
                  });
                }
              }
            }
          }).catch((err) => {
            console.warn('[SceneTeam] LinkedIn search failed:', err);
          })
        );
      }

      await Promise.allSettled(searches);

      if (results.length === 0) {
        toast.info('Aucun profil RH trouvé pour votre organisation. Invitez manuellement par email.');
      }

      setProfiles(results.slice(0, 15));
      setScanPhase('results');
    } catch (err) {
      console.error('[SceneTeam] Scan error:', err);
      toast.error('Erreur lors du scan. Réessayez ou invitez manuellement.');
      setScanPhase('idle');
    }
  }, [organization, hasLinkedIn, accounts]);
  const toggleProfile = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === profiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(profiles.map((p) => p.id)));
    }
  };

  const handleManualInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await inviteMember({ email: email.trim().toLowerCase(), role });
      setInvitedEmails((prev) => [...prev, email.trim().toLowerCase()]);
      setEmail('');
    } catch {
      // handled in hook
    }
  };

  const invitableFromScan = profiles.filter(
    (p) => selected.has(p.id) && p.email && !invitedEmails.includes(p.email.toLowerCase())
  ).length;
  const totalInvites = invitableFromScan + invitedEmails.length;
  const selectedWithoutEmail = selected.size - invitableFromScan;

  const [isSending, setIsSending] = useState(false);

  const handleFinish = async () => {
    // Send invitations for selected scanned profiles that have an email
    const profilesToInvite = profiles.filter(
      (p) => selected.has(p.id) && p.email && !invitedEmails.includes(p.email.toLowerCase())
    );

    let sentCount = 0;
    if (profilesToInvite.length > 0) {
      setIsSending(true);
      for (const p of profilesToInvite) {
        try {
          await inviteMember({ email: p.email!.toLowerCase(), role: 'member' });
          sentCount++;
        } catch (err) {
          console.warn(`[SceneTeam] Failed to invite ${p.email}:`, err);
        }
      }
      if (sentCount > 0) {
        toast.success(`${sentCount} invitation${sentCount > 1 ? 's' : ''} envoyée${sentCount > 1 ? 's' : ''}`);
      }
      setIsSending(false);
    }

    onFinish(sentCount + invitedEmails.length);
  };

  return (
    <div className="w-full flex flex-col gap-5">
      {/* Header */}
      <div className="mb-2">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">Qui recrute avec vous ?</h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Invitez vos collègues : missions, candidats et statistiques partagés dans un seul espace.
        </p>
      </div>

      {/* LinkedIn scan section */}
      {hasLinkedIn && scanPhase === 'idle' && (
        <motion.button
          onClick={startScan}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-border p-4 flex items-center gap-4 text-left hover:border-border transition-colors w-full"
        >
          <img src={linkedinLogo} alt="LinkedIn" className="w-10 h-10 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Scanner mes connexions</span>
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              On filtre automatiquement les profils RH, recruteurs et managers de votre société.
            </p>
          </div>
        </motion.button>
      )}

      {/* Scanning animation */}
      <AnimatePresence>
        {scanPhase === 'scanning' && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border border-border p-6 flex flex-col items-center gap-3"
          >
            <motion.img
              src={linkedinLogo}
              alt="LinkedIn"
              className="w-10 h-10"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            <p className="text-sm text-muted-foreground">Analyse en cours...</p>
            <div className="w-32 h-1 bg-accent/50 overflow-hidden">
              <motion.div
                className="h-full"
                style={{ background: 'linear-gradient(90deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))' }}
                animate={{ x: ['-100%', '100%'] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scan results */}
      {scanPhase === 'results' && profiles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {profiles.length} profils trouvés
            </span>
            <button
              onClick={selectAll}
              className="text-xs font-semibold text-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
            >
              {selected.size === profiles.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          </div>

          {profiles.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 p-2.5 border border-border hover:border-border transition-colors cursor-pointer"
            >
              <Checkbox
                checked={selected.has(p.id)}
                onCheckedChange={() => toggleProfile(p.id)}
              />
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=random&size=32&font-size=0.4`}
                alt={p.name}
                className="w-8 h-8 border border-border shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground block truncate">{p.role}</span>
              </div>
              {!p.email && selected.has(p.id) && (
                <span className="text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive font-medium shrink-0">
                  Pas d'email
                </span>
              )}
              <img
                src={p.source === 'linkedin' ? linkedinLogo : undefined}
                alt={p.source}
                className="w-4 h-4 object-contain opacity-50"
                style={p.source !== 'linkedin' ? { display: 'none' } : {}}
              />
            </label>
          ))}
        </motion.div>
      )}

      {/* Manual invite */}
      <div className="space-y-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Invitation par email
        </span>
        <form onSubmit={handleManualInvite} className="flex flex-wrap sm:flex-nowrap gap-2">
          <Input
            type="email"
            placeholder="collegue@entreprise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 min-w-0 border border-border text-sm h-10"
          />
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-24 text-xs border border-border h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Membre</SelectItem>
                <SelectItem value="collaborator">Collaborateur externe</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="submit"
              size="icon"
              disabled={isInviting || !email.trim()}
              className="h-10 w-10 border border-border bg-foreground text-background hover:bg-foreground/90 shrink-0"
            >
              {isInviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>
        </form>

        {invitedEmails.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {invitedEmails.map((em) => (
              <Badge key={em} variant="secondary" className="text-xs gap-1 font-mono">
                <Check className="w-3 h-3 text-success" />
                {em}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex flex-col items-end gap-1 pt-2">
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onBack} className="gap-2 border border-border text-sm">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            onClick={handleFinish}
            disabled={isSending}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {isSending ? 'Envoi...' : totalInvites > 0 ? `Inviter ${totalInvites} & terminer` : 'Passer'}
          </Button>
        </div>
        {selectedWithoutEmail > 0 && (
          <p className="text-xs text-destructive">
            {selectedWithoutEmail} profil{selectedWithoutEmail > 1 ? 's' : ''} sans email — non invitable{selectedWithoutEmail > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
};
