import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, CheckCircle2, MapPin, Building2, Briefcase, GraduationCap, Tag, Quote, Wand2 } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ScanResultData {
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
  about?: string;
  experiences?: string[];
  bio?: string;
}

export interface ExperienceDetail {
  title: string | null;
  company: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
}

export type ExperienceType = 'rpo' | 'cabinet' | 'direct' | 'other' | null;

export interface ExperienceClassification {
  company: string;
  title: string;
  type: ExperienceType;
  logoUrl?: string | null;
}

export interface ProfileFormState {
  displayName: string;
  jobTitle: string;
  linkedinUrl: string;
  selectedSpecs: string[];
  scanResult: ScanResultData | null;
  experienceClassifications: ExperienceClassification[];
}

type ProfileStep = 'form' | 'classify' | 'result';

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
  const [generatingBio, setGeneratingBio] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResultData | null>(savedState?.scanResult ?? null);
  const [expClassifications, setExpClassifications] = useState<ExperienceClassification[]>(
    savedState?.experienceClassifications ?? []
  );
  const [profileStep, setProfileStep] = useState<ProfileStep>(
    savedState?.scanResult?.bio ? 'result' : savedState?.experienceClassifications?.length ? 'classify' : 'form'
  );

  const isFreelance = orgType === 'freelance';

  useEffect(() => {
    if (savedState) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const meta = user.user_metadata;
        if (meta?.full_name) setDisplayName(meta.full_name);
        else if (meta?.name) setDisplayName(meta.name);
      }
    });
  }, [savedState]);

  useEffect(() => {
    onStateChange?.({
      displayName,
      jobTitle,
      linkedinUrl,
      selectedSpecs: savedState?.selectedSpecs ?? [],
      scanResult,
      experienceClassifications: expClassifications,
    });
  }, [displayName, jobTitle, linkedinUrl, scanResult, expClassifications, onStateChange]);

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
      if (data.experienceDetails?.length) {
        const classifications = data.experienceDetails.map((exp: any) => ({
          company: exp.company || '',
          title: exp.title || '',
          type: null as ExperienceType,
          logoUrl: exp.logoUrl || null,
        }));
        setExpClassifications(classifications);
        setProfileStep('classify');
      } else {
        // No experiences to classify, go straight to bio generation
        await generateBio(data, []);
      }
      if (data.name && !displayName.trim()) setDisplayName(data.name);
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success('Profil scanné ! Classez vos expériences.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du scan LinkedIn');
    } finally {
      setScanning(false);
    }
  };

  const generateBio = async (profileData: ScanResultData, classifications: ExperienceClassification[]) => {
    setGeneratingBio(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-recruiter-bio', {
        body: {
          profileData: {
            name: profileData.name,
            headline: profileData.headline,
            about: profileData.about || '',
            experiences: profileData.experiences || [],
            skills: profileData.skills,
            yearsExperience: profileData.yearsExperience,
            location: profileData.location,
            currentCompany: profileData.currentCompany,
            education: profileData.education || [],
            companies: profileData.companies || [],
          },
          classifications: classifications.filter(c => c.type !== null),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setScanResult(prev => prev ? { ...prev, bio: data.bio } : prev);
      setProfileStep('result');
      toast.success('Bio générée avec succès !');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la génération de la bio');
    } finally {
      setGeneratingBio(false);
    }
  };

  const handleGenerateBio = () => {
    if (!scanResult) return;
    generateBio(scanResult, expClassifications);
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
          specializations: savedState?.selectedSpecs ?? [],
          linkedin_url: linkedinUrl.trim() || null,
          experience_classifications: expClassifications.filter(c => c.type !== null),
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

  // --- CLASSIFY STEP ---
  if (profileStep === 'classify' && scanResult) {
    const typeOptions = [
      { value: 'rpo' as const, label: 'RPO', color: 'var(--skalr-purple)' },
      { value: 'cabinet' as const, label: 'Cabinet', color: 'var(--skalr-green)' },
      { value: 'direct' as const, label: 'Direct', color: 'var(--skalr-pink)' },
      { value: 'other' as const, label: 'Autre', color: 'var(--muted-foreground)' },
    ];

    const classifiedCount = expClassifications.filter(c => c.type !== null).length;

    return (
      <motion.div
        className="w-full max-w-lg mx-auto flex flex-col gap-5"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <span
            className="skalr-gradient-text text-xs uppercase tracking-wider font-semibold"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            Classification
          </span>
          <h2 className="font-editorial italic text-3xl md:text-4xl">Classez vos expériences</h2>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Pour chaque poste, indiquez le contexte de recrutement.
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 bg-border overflow-hidden">
            <motion.div
              className="h-full"
              style={{ background: 'linear-gradient(90deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))' }}
              initial={{ width: 0 }}
              animate={{ width: `${expClassifications.length ? (classifiedCount / expClassifications.length) * 100 : 0}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
          <span className="text-xs text-muted-foreground" style={{ fontFamily: "'Space Mono', monospace" }}>
            {classifiedCount}/{expClassifications.length}
          </span>
        </div>

        {/* Experience list — single container */}
        <div
          className="border border-border divide-y divide-foreground/5 overflow-hidden"
          style={{ boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)' }}
        >
          {expClassifications.map((exp, i) => {
            if (!exp.title && !exp.company) return null;
            const isClassified = exp.type !== null;
            const activeOpt = typeOptions.find(o => o.value === exp.type);

            return (
              <div key={i} className="group">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
                  {/* Left: avatar + info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      {exp.logoUrl ? (
                        <img
                          src={exp.logoUrl}
                          alt={exp.company}
                          className="w-8 h-8 border border-border object-contain bg-card p-0.5"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            img.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                      ) : null}
                      <div
                        className={`w-8 h-8 border border-border flex items-center justify-center text-xs font-bold text-muted-foreground ${exp.logoUrl ? 'hidden' : ''}`}
                        style={{ background: `hsl(var(--skalr-purple) / ${0.05 + (i % 3) * 0.03})` }}
                      >
                        {exp.company?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      {isClassified && activeOpt && (
                        <div
                          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 flex items-center justify-center text-[7px] text-white border border-background"
                          style={{ background: `hsl(${activeOpt.color})` }}
                        >
                          ✓
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate leading-tight">
                        {exp.title || 'Poste non renseigné'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {exp.company || 'Entreprise inconnue'}
                      </p>
                    </div>
                  </div>

                  {/* Type pills — wrap on mobile */}
                  <div className="flex gap-1 shrink-0 pl-11 sm:pl-0">
                    {typeOptions.map((opt) => {
                      const isActive = exp.type === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setExpClassifications(prev =>
                              prev.map((c, idx) =>
                                idx === i ? { ...c, type: c.type === opt.value ? null : opt.value } : c
                              )
                            );
                          }}
                          className={`px-2.5 py-1 text-xs font-bold uppercase tracking-wider border-2 transition-all ${
                            isActive
                              ? 'text-white'
                              : 'border-border/8 text-muted-foreground/30 hover:text-muted-foreground/60 hover:border-border'
                          }`}
                          style={
                            isActive
                              ? {
                                  background: `hsl(${opt.color})`,
                                  borderColor: `hsl(${opt.color})`,
                                  boxShadow: `2px 2px 0px 0px hsl(${opt.color} / 0.3)`,
                                }
                              : {}
                          }
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Vous pouvez laisser certaines expériences non classées si elles ne sont pas liées au recrutement.
        </p>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setProfileStep('form')}
            className="gap-2 border border-border text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            type="button"
            onClick={handleGenerateBio}
            disabled={generatingBio}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
          >
            {generatingBio ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {generatingBio ? 'Génération...' : 'Générer ma bio'}
          </Button>
        </div>
      </motion.div>
    );
  }

  // --- RESULT / FORM STEP ---
  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-wider font-semibold"
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
        className="mx-auto flex items-center justify-center w-20 h-20 text-2xl font-bold text-white border border-border"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))',
          boxShadow: '3px 3px 0px 0px hsl(var(--primary))',
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
            className="border border-border focus:border-border focus:shadow-sm transition-shadow text-sm h-11"
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
              className="border border-border focus:border-border focus:shadow-sm transition-shadow text-sm h-11"
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
              className="border border-border focus:border-border focus:shadow-sm transition-shadow text-sm h-11 flex-1"
            />
            <Button
              type="button"
              onClick={handleScanLinkedIn}
              disabled={scanning || !linkedinUrl.trim()}
              className="gap-1.5 border border-border text-sm h-11 px-3 shrink-0"
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
          <p className="text-xs text-muted-foreground">
            On analyse votre parcours pour générer une bio professionnelle visible sur votre profil public.
          </p>
        </div>

        {/* Scan result preview (only when bio is generated) */}
        <AnimatePresence>
          {scanResult?.bio && profileStep === 'result' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border border-border p-4 space-y-4"
              style={{ boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)' }}
            >
              {/* Header with photo */}
              <div className="flex items-start gap-3">
                {scanResult.photoUrl ? (
                  <img
                    src={scanResult.photoUrl}
                    alt={scanResult.name}
                    className="w-12 h-12 border border-border object-cover shrink-0"
                  />
                ) : (
                  <div
                    className="w-12 h-12 border border-border shrink-0 flex items-center justify-center text-sm font-bold text-white"
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
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border border-border text-foreground"
                    style={{ background: 'hsl(var(--skalr-green) / 0.1)' }}>
                    <Briefcase className="w-3 h-3" />
                    {scanResult.yearsExperience} ans d'exp.
                  </span>
                )}
                {scanResult.seniority && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border border-border text-foreground"
                    style={{ background: 'hsl(var(--skalr-purple) / 0.1)' }}>
                    <Tag className="w-3 h-3" />
                    {scanResult.seniority}
                  </span>
                )}
                {scanResult.location && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border border-border text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    {scanResult.location}
                  </span>
                )}
              </div>

              {/* Classifications summary */}
              {expClassifications.some(c => c.type) && (
                <div className="flex flex-wrap gap-1.5">
                  {(['rpo', 'cabinet', 'direct', 'other'] as const).map(type => {
                    const count = expClassifications.filter(c => c.type === type).length;
                    if (!count) return null;
                    const config = {
                      rpo: { label: 'RPO', color: 'var(--skalr-purple)' },
                      cabinet: { label: 'Cabinet', color: 'var(--skalr-green)' },
                      direct: { label: 'Direct', color: 'var(--skalr-pink)' },
                      other: { label: 'Autre', color: 'var(--foreground)' },
                    }[type];
                    return (
                      <span key={type} className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border"
                        style={{ background: `hsl(${config.color} / 0.1)` }}>
                        {config.label} × {count}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Bio */}
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Bio générée</p>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {scanResult.bio}
                </p>
              </div>

              {/* Re-classify button */}
              <button
                type="button"
                onClick={() => setProfileStep('classify')}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Modifier la classification et régénérer
              </button>

              {/* Industries */}
              {scanResult.industries && scanResult.industries.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Secteurs
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.industries.map((ind) => (
                      <span key={ind} className="px-2 py-0.5 text-xs font-semibold border border-border text-muted-foreground capitalize">
                        {ind}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Skills */}
              {scanResult.skills.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Compétences</p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.skills.slice(0, 12).map((skill) => (
                      <span key={skill} className="px-2 py-0.5 text-xs font-semibold border border-border text-muted-foreground">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Education */}
              {scanResult.education && scanResult.education.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" /> Formation
                  </p>
                  {scanResult.education.map((edu, i) => (
                    <p key={i} className="text-xs text-foreground/60">{edu}</p>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {scanResult.recommendations && scanResult.recommendations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Quote className="w-3 h-3" /> Recommandations ({scanResult.recommendations.length})
                  </p>
                  {scanResult.recommendations.slice(0, 3).map((rec, i) => (
                    <div key={i} className="border-l-2 border-border pl-3 space-y-0.5">
                      <p className="text-xs text-foreground/70 italic leading-relaxed line-clamp-3">
                        "{rec.body}"
                      </p>
                      {(rec.recommenderName || rec.recommenderTitle) && (
                        <p className="text-xs text-muted-foreground font-semibold">
                          — {[rec.recommenderName, rec.recommenderTitle].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {scanResult.tags && scanResult.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
                  {scanResult.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-foreground/50">
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
            className="gap-2 border border-border text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            type="submit"
            disabled={saving || scanning}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
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
