import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, CheckCircle2, MapPin, Building2, Briefcase, GraduationCap, Tag, Quote, Wand2 } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.png';
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
      { value: 'rpo' as const, label: 'RPO', emoji: '🏢', color: 'var(--skalr-purple)', desc: 'Embarqué chez le client' },
      { value: 'cabinet' as const, label: 'Cabinet', emoji: '🎯', color: 'var(--skalr-green)', desc: 'Chasse & conseil' },
      { value: 'direct' as const, label: 'Direct', emoji: '🏠', color: 'var(--skalr-pink)', desc: 'Recrutement interne' },
      { value: 'other' as const, label: 'Autre', emoji: '📁', color: 'var(--foreground)', desc: 'Hors recrutement' },
    ];

    const classifiedCount = expClassifications.filter(c => c.type !== null).length;

    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-6">
        <div className="text-center space-y-2">
          <span
            className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            Classification
          </span>
          <h2 className="font-editorial italic text-3xl md:text-4xl">Classez vos expériences</h2>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Pour chaque poste, indiquez le contexte de recrutement. Cela permet de générer un résumé fidèle à votre parcours.
          </p>
        </div>

        {/* Type legend as horizontal pills */}
        <div className="flex flex-wrap justify-center gap-2">
          {typeOptions.map(opt => (
            <div
              key={opt.value}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-foreground/10 text-[10px]"
              style={{ background: `hsl(${opt.color} / 0.06)` }}
            >
              <span>{opt.emoji}</span>
              <span className="font-bold uppercase tracking-wider">{opt.label}</span>
              <span className="text-muted-foreground hidden sm:inline">— {opt.desc}</span>
            </div>
          ))}
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <div className="h-1.5 flex-1 max-w-[200px] bg-muted overflow-hidden border border-foreground/5">
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${expClassifications.length ? (classifiedCount / expClassifications.length) * 100 : 0}%`,
                background: 'linear-gradient(90deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))',
              }}
            />
          </div>
          <span className="font-mono">{classifiedCount}/{expClassifications.length}</span>
        </div>

        {/* Experience cards */}
        <div className="flex flex-col gap-3">
          {expClassifications.map((exp, i) => {
            const label = [exp.title, exp.company].filter(Boolean).join(' @ ');
            if (!label) return null;
            const isClassified = exp.type !== null;
            const activeOpt = typeOptions.find(o => o.value === exp.type);

            return (
              <div
                key={i}
                className={`relative border-2 transition-all duration-200 ${
                  isClassified
                    ? 'border-foreground/20'
                    : 'border-foreground/8 hover:border-foreground/15'
                }`}
                style={
                  isClassified && activeOpt
                    ? {
                        boxShadow: `3px 3px 0px 0px hsl(${activeOpt.color} / 0.25)`,
                        borderColor: `hsl(${activeOpt.color} / 0.3)`,
                      }
                    : { boxShadow: '2px 2px 0px 0px hsl(var(--foreground) / 0.04)' }
                }
              >
                {/* Top section: company info */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Company avatar */}
                  <div className="relative">
                    {exp.logoUrl ? (
                      <img
                        src={exp.logoUrl}
                        alt={exp.company}
                        className="w-9 h-9 shrink-0 border border-foreground/10 object-contain bg-white p-1"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                          img.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div
                      className={`w-9 h-9 shrink-0 border border-foreground/10 flex items-center justify-center text-xs font-bold text-foreground/50 ${exp.logoUrl ? 'hidden' : ''}`}
                      style={{ background: `hsl(var(--skalr-purple) / ${0.06 + (i % 4) * 0.03})` }}
                    >
                      {exp.company?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    {isClassified && (
                      <div
                        className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[8px] border border-background"
                        style={{ background: `hsl(${activeOpt?.color} / 0.9)`, color: 'white' }}
                      >
                        ✓
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{exp.title || 'Poste non renseigné'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{exp.company || 'Entreprise inconnue'}</p>
                  </div>

                  {/* Selected type badge (visible when classified) */}
                  {isClassified && activeOpt && (
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 shrink-0"
                      style={{
                        background: `hsl(${activeOpt.color} / 0.12)`,
                        color: `hsl(${activeOpt.color})`,
                        border: `1px solid hsl(${activeOpt.color} / 0.2)`,
                      }}
                    >
                      {activeOpt.emoji} {activeOpt.label}
                    </span>
                  )}
                </div>

                {/* Bottom section: type selector */}
                <div
                  className="flex border-t border-foreground/5"
                  style={{ background: 'hsl(var(--muted) / 0.3)' }}
                >
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
                        className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-all border-r last:border-r-0 border-foreground/5 ${
                          isActive
                            ? 'text-foreground'
                            : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-foreground/[0.02]'
                        }`}
                        style={
                          isActive
                            ? { background: `hsl(${opt.color} / 0.12)`, color: `hsl(${opt.color})` }
                            : {}
                        }
                      >
                        <span className="hidden sm:inline">{opt.emoji} </span>{opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-muted-foreground/60 text-center italic">
          Laissez non classées les expériences hors recrutement, ou marquez-les « Autre ».
        </p>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => setProfileStep('form')}
            className="gap-2 border-2 border-foreground/20 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button
            type="button"
            onClick={handleGenerateBio}
            disabled={generatingBio}
            className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
          >
            {generatingBio ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {generatingBio ? 'Génération...' : 'Générer ma bio'}
          </Button>
        </div>
      </div>
    );
  }

  // --- RESULT / FORM STEP ---
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

        {/* Scan result preview (only when bio is generated) */}
        <AnimatePresence>
          {scanResult?.bio && profileStep === 'result' && (
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
                      <span key={type} className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-2 border-foreground/20"
                        style={{ background: `hsl(${config.color} / 0.1)` }}>
                        {config.label} × {count}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Bio */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bio générée</p>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {scanResult.bio}
                </p>
              </div>

              {/* Re-classify button */}
              <button
                type="button"
                onClick={() => setProfileStep('classify')}
                className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Modifier la classification et régénérer
              </button>

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

              {/* Skills */}
              {scanResult.skills.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Compétences</p>
                  <div className="flex flex-wrap gap-1.5">
                    {scanResult.skills.slice(0, 12).map((skill) => (
                      <span key={skill} className="px-2 py-0.5 text-[10px] font-semibold border border-foreground/15 text-muted-foreground">
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
