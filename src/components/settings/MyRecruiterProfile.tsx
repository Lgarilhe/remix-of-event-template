/**
 * MyRecruiterProfile — édition du profil recruteur dans Réglages → Mon compte.
 *
 * Avant la refonte onboarding (06/07/2026), profiles.display_name / job_title /
 * recruiter_bio n'étaient éditables QUE pendant l'onboarding (SceneProfile,
 * supprimée) — alors qu'ils alimentent les variables {{ma_signature}} /
 * {{mon_poste}} des séquences, la page publique /r/:slug et l'équipe des
 * missions. Cette carte est la destination de l'item « Profil recruteur » de
 * la checklist d'activation.
 *
 * Le scan LinkedIn (scan-recruiter-linkedin) persiste lui-même headline/skills/
 * slug ; la génération de bio (generate-recruiter-bio) persiste recruiter_bio.
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, ScanSearch, Sparkles, UserCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';
import { toast } from 'sonner';

interface ProfileRow {
  display_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  recruiter_bio: string | null;
}

interface ScanResult {
  name?: string;
  headline?: string;
  about?: string;
  experiences?: unknown[];
  yearsExperience?: number;
  location?: string;
  currentCompany?: string;
  currentTitle?: string;
  education?: unknown[];
  companies?: unknown[];
}

export const MyRecruiterProfile: React.FC = () => {
  const { user } = useAuthReady();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['recruiter-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await (supabase as any)
        .from('profiles')
        .select('display_name, job_title, linkedin_url, recruiter_bio')
        .eq('user_id', user.id)
        .maybeSingle();
      return (data ?? null) as ProfileRow | null;
    },
    enabled: !!user?.id,
  });

  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [bio, setBio] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [generatingBio, setGeneratingBio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Deps primitives (convention CLAUDE.md « useEffect — avoid object deps ») :
  // l'effet ne doit tourner qu'à l'arrivée initiale du profil, pas à chaque
  // nouvelle référence d'objet produite par un refetch.
  const profileLoaded = !!profile;
  useEffect(() => {
    if (profileLoaded && !hydrated) {
      setDisplayName(profile!.display_name || '');
      setJobTitle(profile!.job_title || '');
      setLinkedinUrl(profile!.linkedin_url || '');
      setBio(profile!.recruiter_bio || '');
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoaded, hydrated]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['recruiter-profile'] });
    // Le greeting/avatar du dashboard et la checklist lisent 'current-profile'.
    queryClient.invalidateQueries({ queryKey: ['current-profile'] });
  };

  const handleScan = async () => {
    if (!linkedinUrl.trim()) return;
    setScanning(true);
    try {
      // invokeEdgeFunction (pas supabase.functions.invoke) : gère le refresh
      // de session sur 401 — un onglet Réglages resté ouvert ne casse pas.
      const { data, error } = await invokeEdgeFunction<ScanResult & { error?: string }>('scan-recruiter-linkedin', {
        linkedinUrl: linkedinUrl.trim(),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setScanResult(data as ScanResult);
      if (!displayName.trim() && data?.name) setDisplayName(data.name);
      if (!jobTitle.trim() && (data?.currentTitle || data?.headline)) setJobTitle(data.currentTitle || data.headline);
      toast.success('Profil LinkedIn analysé');
      invalidate();
    } catch (err: any) {
      console.error('[MyRecruiterProfile] Scan failed:', err);
      toast.error(err?.message || "Impossible d'analyser ce profil LinkedIn");
    } finally {
      setScanning(false);
    }
  };

  const handleGenerateBio = async () => {
    if (!scanResult) return;
    setGeneratingBio(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ bio?: string; error?: string }>('generate-recruiter-bio', {
        profileData: {
          name: scanResult.name || displayName,
          headline: scanResult.headline || jobTitle,
          about: scanResult.about || '',
          experiences: scanResult.experiences || [],
          yearsExperience: scanResult.yearsExperience,
          location: scanResult.location,
          currentCompany: scanResult.currentCompany,
          education: scanResult.education || [],
          companies: scanResult.companies || [],
        },
        classifications: [],
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.bio) setBio(data.bio);
      toast.success('Bio générée — relisez et ajustez.');
      invalidate();
    } catch (err: any) {
      console.error('[MyRecruiterProfile] Bio generation failed:', err);
      toast.error(err?.message || 'Impossible de générer la bio');
    } finally {
      setGeneratingBio(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('profiles').upsert(
        {
          user_id: user.id,
          display_name: displayName.trim() || null,
          job_title: jobTitle.trim() || null,
          linkedin_url: linkedinUrl.trim() || null,
          recruiter_bio: bio.trim() || null,
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
      toast.success('Profil enregistré');
      invalidate();
    } catch (err: any) {
      console.error('[MyRecruiterProfile] Save failed:', err);
      toast.error(err?.message || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCircle className="w-4 h-4" />
          Mon profil recruteur
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rp-name">Nom affiché</Label>
              <Input
                id="rp-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Prénom Nom"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-title">Poste</Label>
              <Input
                id="rp-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Talent Acquisition Manager"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-linkedin">URL LinkedIn</Label>
            <div className="flex gap-2">
              <Input
                id="rp-linkedin"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://www.linkedin.com/in/…"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleScan}
                disabled={!linkedinUrl.trim() || scanning}
                className="gap-1.5 shrink-0"
              >
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
                Scanner
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Le scan pré-remplit votre nom, votre poste et vos compétences depuis votre profil LinkedIn.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="rp-bio">Bio</Label>
              {scanResult && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleGenerateBio}
                  disabled={generatingBio}
                  className="gap-1.5 h-7 text-xs"
                >
                  {generatingBio ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Générer ma bio
                </Button>
              )}
            </div>
            <Textarea
              id="rp-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Quelques lignes sur votre parcours et vos spécialités — affichées sur votre page publique."
              rows={4}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Enregistrer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
