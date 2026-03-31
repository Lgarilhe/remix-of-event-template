import React, { useState } from 'react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useClientPortalTokens } from '@/hooks/useClientPortalTokens';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { Link2, Copy, Trash2, ExternalLink, Plus, Lock, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MissionClientPortalProps {
  project: SourcingProject;
}

export const MissionClientPortal: React.FC<MissionClientPortalProps> = ({ project }) => {
  const { orgType } = useOrganization();
  const canUse = hasFeature(orgType, 'client_portal');
  const { tokens, isLoading, createToken, isCreating, deleteToken } = useClientPortalTokens();
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter tokens that include this project
  const projectTokens = tokens.filter(t =>
    !t.project_ids || t.project_ids.length === 0 || t.project_ids.includes(project.id)
  );

  if (!canUse) {
    return (
      <div className="border border-foreground/20 p-6 text-center">
        <Lock className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Le portail client est réservé aux cabinets et freelances.
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!clientName.trim()) {
      toast.error('Entrez le nom du client');
      return;
    }
    try {
      await createToken({
        client_name: clientName.trim(),
        client_email: clientEmail.trim() || undefined,
        project_ids: [project.id],
      });
      setClientName('');
      setClientEmail('');
      setShowForm(false);
    } catch {
      // Error already toasted by hook
    }
  };

  const handleCopy = async (tokenValue: string) => {
    const url = `${window.location.origin}/client/${tokenValue}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(tokenValue);
      toast.success('Lien copié !');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Impossible de copier — copiez manuellement : ' + url);
    }
  };

  const handleDelete = async (tokenId: string, clientName: string) => {
    if (!confirm(`Révoquer l'accès pour "${clientName}" ? Cette action est irréversible.`)) return;
    try {
      await deleteToken(tokenId);
    } catch {
      // Error already toasted by hook
    }
  };

  return (
    <div className="border border-foreground/20 p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Portail client ({projectTokens.length})
          </h3>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 h-[30px] px-3 text-xs font-medium uppercase tracking-wider border border-foreground/30 bg-background text-foreground hover:border-foreground transition-colors"
          >
            <Plus className="w-3 h-3" /> Créer un accès
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="border border-foreground/20 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nom du client *</label>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Thomas Dupont"
                className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email (optionnel)</label>
              <input
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                type="email"
                placeholder="thomas@client.com"
                className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isCreating || !clientName.trim()}
              className="h-[34px] px-4 bg-foreground text-background text-xs font-bold uppercase tracking-wider border border-foreground disabled:opacity-50"
            >
              {isCreating ? 'Création...' : 'Générer le lien'}
            </button>
            <button
              onClick={() => { setShowForm(false); setClientName(''); setClientEmail(''); }}
              className="h-[34px] px-3 text-muted-foreground hover:text-foreground border border-foreground/30 text-xs font-bold uppercase tracking-wider"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Token list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground animate-spin" />
        </div>
      ) : projectTokens.length === 0 && !showForm ? (
        <p className="text-xs text-muted-foreground py-2">
          Aucun accès client créé. Générez un lien pour donner accès au hiring manager.
        </p>
      ) : (
        <div className="space-y-2">
          {projectTokens.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2 border border-foreground/10 hover:border-foreground/30 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{t.client_name}</p>
                {t.client_email && (
                  <p className="text-xs text-muted-foreground truncate">{t.client_email}</p>
                )}
              </div>
              {t.last_accessed_at && (
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                  Vu {formatDistanceToNow(new Date(t.last_accessed_at), { addSuffix: true, locale: fr })}
                </span>
              )}
              <button
                onClick={() => handleCopy(t.token)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Copier le lien"
              >
                {copiedId === t.token ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={`/client/${t.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Ouvrir le portail"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => handleDelete(t.id, t.client_name)}
                className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                title="Révoquer l'accès"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
