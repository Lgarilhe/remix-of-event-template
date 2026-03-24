import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, CheckCircle2, MapPin, Building2, Briefcase, GraduationCap, Tag, Quote } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ScanResultData {
  bio: string;
  headline: string;
  skills: string[];
  yearsExperience: number;
  slug: string;
  name: string;
  seniority?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  location?: string | null;
  industries?: string[];
  tags?: string[];
  companies?: string[];
  photoUrl?: string | null;
  education?: string[];
  recommendations?: { body: string; recommenderName?: string | null; recommenderTitle?: string | null }[];
}

export interface ProfileFormState {
  displayName: string;
  jobTitle: string;
  linkedinUrl: string;
  selectedSpecs: string[];
  scanResult: ScanResultData | null;
}

interface Props {
  onNext: () => void;
  onBack: () => void;
  orgType?: 'enterprise' | 'agency' | 'freelance' | null;
  savedState?: ProfileFormState;
  onStateChange?: (state: ProfileFormState) => void;
}

export const SceneProfile: React.FC<Props> = ({ onNext, onBack, orgType, savedState, onStateChange }) => {
  const [displayName, setDisplayName] = useState(savedState?.displayName ?? '');
  const [jobTitle, setJobTitle] = useState(savedState?.jobTitle ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(savedState?.linkedinUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResultData | null>(savedState?.scanResult ?? null);

  const isFreelance = orgType === 'freelance';

  useEffect(() => {
    if (savedState) return; // Don't overwrite restored state
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const meta = user.user_metadata;
        if (meta?.full_name) setDisplayName(meta.full_name);
        else if (meta?.name) setDisplayName(meta.name);
      }
    });
  }, [savedState]);

  // Sync state back to parent for persistence
  useEffect(() => {
    onStateChange?.({
      displayName,
      jobTitle,
      linkedinUrl,
      selectedSpecs: savedState?.selectedSpecs ?? [],
      scanResult,
    });
  }, [displayName, jobTitle, linkedinUrl, scanResult, onStateChange]);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const handleScanLinkedIn = async () => {
    if (!linkedinUrl.trim()) return;
    setScanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Non authentifié');

      const { data, error } = await supabase.functions.invoke('scan-recruiter-linkedin', {
        body: { linkedinUrl: linkedinUrl.trim() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setScanResult(data);
      if (data.name && !displayName.trim()) setDisplayName(data.name);
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success('Profil LinkedIn analysé avec succès !');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du scan LinkedIn');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: user.id,
          display_name: displayName.trim() || null,
          job_title: isFreelance ? 'Recruteur indépendant' : (jobTitle.trim() || null),
          specializations: Array.from(selectedSpecs),
          linkedin_url: linkedinUrl.trim() || null,
        } as any,
        { onConflict: 'user_id' }
      );

      if (error) throw error;
      onNext();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          {isFreelance ? '02' : '04'} — Votre profil
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Faisons connaissance</h2>
        <p className="text-muted-foreground text-sm">
          {isFreelance
            ? 'Présentez-vous et connectez votre LinkedIn pour générer votre vitrine.'
            : 'Comment souhaitez-vous apparaître auprès de votre équipe ?'}
        </p>
      </div>

      {/* Avatar */}
      <motion.div
        className="mx-auto flex items-center justify-center w-20 h-20 text-2xl font-bold text-white border-2 border-foreground"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))',
          boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))',
        }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {initials || '?'}
      </motion.div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Nom complet
          </label>
          <Input
            placeholder="Jean Dupont"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
            className="border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11"
          />
        </div>

        {!isFreelance && (
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Fonction / Poste
            </label>
            <Input
              placeholder="Recruteur Senior, DRH, Consultant..."
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11"
            />
          </div>
        )}

        {/* LinkedIn URL + Scan */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />
            Profil LinkedIn
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="https://linkedin.com/in/votre-profil"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              className="border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11 flex-1"
            />
            <Button
              type="button"
              onClick={handleScanLinkedIn}
              disabled={scanning || !linkedinUrl.trim()}
              className="gap-1.5 border-2 border-foreground/20 text-sm h-11 px-3 shrink-0"
              variant="outline"
            >
              {scanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {scanning ? 'Analyse...' : 'Scanner'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            On analyse votre parcours pour générer une bio professionnelle visible sur votre profil public.
          </p>
        </div>

        {/* Scan result preview */}
        <AnimatePresence>
          {scanResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border-2 border-foreground/15 p-4 space-y-4"
              style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent) / 0.3)' }}
            >
              {/* Header with photo */}
              <div className="flex items-start gap-3">
                {scanResult.photoUrl ? (
                  <img
                    src={scanResult.photoUrl}
                    alt={scanResult.name}
                    className="w-12 h-12 border-2 border-foreground/20 object-cover shrink-0"
                  />
                ) : (
                  <div
                    className="w-12 h-12 border-2 border-foreground/20 shrink-0 flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))' }}
                  >
                    {scanResult.name?.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground truncate">
                      {scanResult.name}
                    </span>
                  </div>
                  {scanResult.currentTitle && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {scanResult.currentTitle}
                      {scanResult.currentCompany && ` @ ${scanResult.currentCompany}`}
                    </p>
                  )}
                </div>
              </div>

              {/* Key info badges */}
              <div className="flex flex-wrap gap-1.5">
                {scanResult.yearsExperience > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold border-2 border-foreground/20 text-foreground"
                    style={{ background: 'hsl(var(--skalr-green) / 0.1)' }}>
                    <Briefcase className="w-3 h-3" />
                    {scanResult.yearsExperience} ans d'exp.
                  </span>
                )}
                {scanResult.seniority && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold border-2 border-foreground/20 text-foreground"
                    style={{ background: 'hsl(var(--skalr-purple) / 0.1)' }}>
                    <Tag className="w-3 h-3" />
                    {scanResult.seniority}
                  </span>
                )}
                {scanResult.location && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold border-2 border-foreground/20 text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    {scanResult.location}
                  </span>
                )}
              </div>

              {/* Bio */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bio générée</p>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {scanResult.bio}
                </p>
              </div>

              {/* Industries */}
              {scanResult.industries && scanResult.industries.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Secteurs
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.industries.map((ind) => (
                      <span key={ind} className="px-2 py-0.5 text-[10px] font-semibold border border-foreground/15 text-muted-foreground capitalize">
                        {ind}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Companies */}
              {scanResult.companies && scanResult.companies.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> Entreprises
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.companies.slice(0, 6).map((company) => (
                      <span key={company} className="px-2 py-0.5 text-[10px] font-semibold border border-foreground/15 text-foreground/70">
                        {company}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Skills */}
              {scanResult.skills.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Compétences</p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.skills.slice(0, 12).map((skill) => (
                      <span
                        key={skill}
                        className="px-2 py-0.5 text-[10px] font-semibold border border-foreground/15 text-muted-foreground"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Education */}
              {scanResult.education && scanResult.education.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" /> Formation
                  </p>
                  {scanResult.education.map((edu, i) => (
                    <p key={i} className="text-[11px] text-foreground/60">{edu}</p>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {scanResult.recommendations && scanResult.recommendations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Quote className="w-3 h-3" /> Recommandations ({scanResult.recommendations.length})
                  </p>
                  {scanResult.recommendations.slice(0, 3).map((rec, i) => (
                    <div key={i} className="border-l-2 border-foreground/15 pl-3 space-y-0.5">
                      <p className="text-[11px] text-foreground/70 italic leading-relaxed line-clamp-3">
                        "{rec.body}"
                      </p>
                      {(rec.recommenderName || rec.recommenderTitle) && (
                        <p className="text-[10px] text-muted-foreground font-semibold">
                          — {[rec.recommenderName, rec.recommenderTitle].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {scanResult.tags && scanResult.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-foreground/10">
                  {scanResult.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground/50">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="gap-2 border-2 border-foreground/20 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            type="submit"
            disabled={saving || scanning}
            className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {saving ? 'Enregistrement...' : 'Continuer'}
          </Button>
        </div>
      </form>
    </div>
  );
};
