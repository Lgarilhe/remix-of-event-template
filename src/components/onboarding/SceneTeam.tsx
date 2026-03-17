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
import { toast } from 'sonner';

import teamIcon from '@/assets/icon-team-3d.png';
import linkedinLogo from '@/assets/linkedin-logo.png';

interface Props {
  organizationId: string | null;
  onFinish: () => void;
  onBack: () => void;
}

interface SuggestedProfile {
  id: string;
  name: string;
  role: string;
  source: 'linkedin' | 'apollo';
}

/* ─── Fake scan results for demo ─── */
const FAKE_PROFILES: SuggestedProfile[] = [
  { id: '1', name: 'Marie Laurent', role: 'Talent Acquisition Manager', source: 'linkedin' },
  { id: '2', name: 'Thomas Bernard', role: 'Recruteur Senior', source: 'linkedin' },
  { id: '3', name: 'Sophie Petit', role: 'DRH', source: 'apollo' },
  { id: '4', name: 'Alexandre Moreau', role: 'HR Business Partner', source: 'linkedin' },
  { id: '5', name: 'Camille Dubois', role: 'Responsable Recrutement', source: 'apollo' },
];

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

  const startScan = useCallback(() => {
    setScanPhase('scanning');
    // Simulate scan delay
    setTimeout(() => {
      setProfiles(FAKE_PROFILES);
      setScanPhase('results');
    }, 2800);
  }, []);

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

  const totalInvites = selected.size + invitedEmails.length;

  const handleFinish = async () => {
    // In production, would send invites for selected profiles too
    onFinish();
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          05 — Votre équipe
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Invitez vos collaborateurs</h2>
        <p className="text-muted-foreground text-sm">Le recrutement est un sport d'équipe.</p>
      </div>

      <motion.img
        src={teamIcon}
        alt=""
        className="mx-auto w-14 h-14 drop-shadow-md"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
      />

      {/* LinkedIn scan section */}
      {hasLinkedIn && scanPhase === 'idle' && (
        <motion.button
          onClick={startScan}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-2 border-foreground/15 p-4 flex items-center gap-4 text-left hover:border-foreground/30 transition-colors w-full"
        >
          <img src={linkedinLogo} alt="LinkedIn" className="w-10 h-10 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Scanner mes connexions</span>
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
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
            className="border-2 border-foreground/10 p-6 flex flex-col items-center gap-3"
          >
            <motion.img
              src={linkedinLogo}
              alt=""
              className="w-10 h-10"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            <p className="text-sm text-muted-foreground">Analyse en cours...</p>
            <div className="w-32 h-1 bg-foreground/5 overflow-hidden">
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
              className="text-[11px] font-semibold text-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
            >
              {selected.size === profiles.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          </div>

          {profiles.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 p-2.5 border border-foreground/10 hover:border-foreground/20 transition-colors cursor-pointer"
            >
              <Checkbox
                checked={selected.has(p.id)}
                onCheckedChange={() => toggleProfile(p.id)}
              />
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=random&size=32&font-size=0.4`}
                alt={p.name}
                className="w-8 h-8 border border-foreground/10 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-[11px] text-muted-foreground block truncate">{p.role}</span>
              </div>
              <img
                src={p.source === 'linkedin' ? linkedinLogo : undefined}
                alt={p.source}
                className="w-4 h-4 object-contain opacity-50"
                style={p.source === 'apollo' ? { display: 'none' } : {}}
              />
              {p.source === 'apollo' && (
                <span className="text-[9px] px-1.5 py-0.5 bg-muted text-muted-foreground font-mono">Apollo</span>
              )}
            </label>
          ))}
        </motion.div>
      )}

      {/* Manual invite */}
      <div className="space-y-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Invitation par email
        </span>
        <form onSubmit={handleManualInvite} className="flex gap-2">
          <Input
            type="email"
            placeholder="collegue@entreprise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 border-2 border-foreground/15 text-sm h-10"
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-24 text-xs border-2 border-foreground/15 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Membre</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="submit"
            size="icon"
            disabled={isInviting || !email.trim()}
            className="h-10 w-10 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 shrink-0"
            style={{ boxShadow: '2px 2px 0px 0px hsl(var(--brutal-accent))' }}
          >
            {isInviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </form>

        {invitedEmails.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {invitedEmails.map((em) => (
              <Badge key={em} variant="secondary" className="text-[11px] gap-1 font-mono">
                <Check className="w-3 h-3" style={{ color: 'hsl(var(--skalr-green))' }} />
                {em}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} className="gap-2 border-2 border-foreground/20 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={handleFinish}
          className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
        >
          <ArrowRight className="w-4 h-4" />
          {totalInvites > 0 ? `Inviter ${totalInvites} & terminer` : 'Passer'}
        </Button>
      </div>
    </div>
  );
};
