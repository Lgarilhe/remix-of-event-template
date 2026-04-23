/**
 * Popup principal de l'extension Konekt.
 *
 * 3 états :
 *   - NOT_AUTHED : message + bouton vers la page Options pour coller le token
 *   - AUTHED : tabs (Reconnecter, Quick Add, Réglages)
 *   - LOADING : check token au montage
 */

import { useEffect, useState } from 'react';
import { storage } from '../lib/storage';
import { konektApi } from '../lib/konekt-api';
import { KONEKT_APP_URL } from '../lib/config';
import type { Message, MessageResponse } from '../background/sw';

type Status = 'loading' | 'not_authed' | 'authed';

async function sendMessage(msg: Message): Promise<MessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || 'SW not ready' });
        return;
      }
      resolve(response);
    });
  });
}

export function Popup() {
  const [status, setStatus] = useState<Status>('loading');
  const [activeTab, setActiveTab] = useState<'reconnect' | 'add' | 'settings'>('reconnect');

  useEffect(() => {
    (async () => {
      const token = await storage.getToken();
      if (!token) { setStatus('not_authed'); return; }
      const valid = await konektApi.checkToken();
      setStatus(valid ? 'authed' : 'not_authed');
    })();
  }, []);

  if (status === 'loading') {
    return (
      <Shell>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
        </div>
      </Shell>
    );
  }

  if (status === 'not_authed') {
    return (
      <Shell>
        <div className="p-5 space-y-4">
          <div className="text-center space-y-2">
            <KonektLogo className="w-12 h-12 mx-auto" />
            <h2 className="text-base font-bold uppercase tracking-wider">Konekt non connecté</h2>
            <p className="text-xs text-muted-foreground">
              Pour utiliser l'extension, créez un token API depuis votre compte Konekt et collez-le dans les réglages.
            </p>
          </div>

          <ol className="text-xs space-y-2 text-foreground bg-muted/30 p-3 border border-border">
            <li><strong>1.</strong> Ouvrez <a href={`${KONEKT_APP_URL}/settings?tab=account`} target="_blank" rel="noopener noreferrer" className="text-info underline">Konekt → Mon compte</a></li>
            <li><strong>2.</strong> Section "Extension Chrome Konekt" → cliquez sur <strong>"Nouveau token"</strong></li>
            <li><strong>3.</strong> Copiez le token affiché</li>
            <li><strong>4.</strong> Cliquez ci-dessous pour ouvrir les réglages de l'extension et collez-le</li>
          </ol>

          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            className="w-full h-10 bg-foreground text-background text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
          >
            Ouvrir les réglages
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton active={activeTab === 'reconnect'} onClick={() => setActiveTab('reconnect')}>
          🔌 Reconnecter
        </TabButton>
        <TabButton active={activeTab === 'add'} onClick={() => setActiveTab('add')}>
          ➕ Ajouter
        </TabButton>
        <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
          ⚙️
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'reconnect' && <ReconnectTab onLogout={() => setStatus('not_authed')} />}
        {activeTab === 'add' && <QuickAddTab />}
        {activeTab === 'settings' && <SettingsTab onLogout={() => setStatus('not_authed')} />}
      </div>
    </Shell>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-[400px] flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
        <KonektLogo className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-wider">Konekt</span>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors border-r border-border last:border-r-0 ${
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted/40'
      }`}
    >
      {children}
    </button>
  );
}

function KonektLogo({ className }: { className?: string }) {
  return (
    <div className={`${className} bg-foreground text-background flex items-center justify-center font-bold text-xs`}>
      K
    </div>
  );
}

// ─── Tab : Reconnect ──────────────────────────────────────────────────────────

function ReconnectTab({ onLogout: _onLogout }: { onLogout: () => void }) {
  const [reconnecting, setReconnecting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lastReconnect, setLastReconnect] = useState<number | null>(null);

  useEffect(() => {
    storage.getLastReconnectAt().then(setLastReconnect);
  }, [result]);

  const handleReconnect = async () => {
    setReconnecting(true);
    setResult(null);
    try {
      const response = await sendMessage({ type: 'RECONNECT_LINKEDIN' });
      if (response.ok) {
        setResult({ type: 'success', message: 'Compte LinkedIn reconnecté ✓ — vous pouvez retourner sur Konekt' });
      } else {
        setResult({ type: 'error', message: response.error || 'Erreur de reconnexion' });
      }
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        En 1 clic, l'extension capture votre cookie LinkedIn actuel et l'envoie à Konekt pour reconnecter votre compte (status CREDENTIALS → OK).
      </div>

      <div className="bg-muted/30 border border-border p-2.5 text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground mb-1">⚠️ Avant de cliquer :</div>
        <ul className="space-y-0.5 ml-3 list-disc">
          <li>Soyez connecté à <strong>linkedin.com</strong> dans CE navigateur</li>
          <li>Idéalement utilisez un <strong>profil Chrome dédié</strong> à Konekt pour éviter les conflits avec votre LinkedIn Recruiter quotidien</li>
        </ul>
      </div>

      <button
        onClick={handleReconnect}
        disabled={reconnecting}
        className="w-full h-11 bg-foreground text-background font-bold uppercase tracking-wider text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {reconnecting ? 'Connexion en cours…' : '🔌 Reconnecter mon compte LinkedIn'}
      </button>

      {result && (
        <div className={`p-2.5 border text-xs ${
          result.type === 'success'
            ? 'bg-success/5 border-success text-success'
            : 'bg-destructive/5 border-destructive text-destructive'
        }`}>
          {result.message}
        </div>
      )}

      {lastReconnect && (
        <p className="text-[10px] text-muted-foreground/70 text-center">
          Dernière reconnexion : {new Date(lastReconnect).toLocaleString('fr-FR')}
        </p>
      )}
    </div>
  );
}

// ─── Tab : Quick Add ──────────────────────────────────────────────────────────

function QuickAddTab() {
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto-prefill depuis l'onglet actif si on est sur un profil LinkedIn
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url?.includes('linkedin.com/in/')) {
        setLinkedinUrl(tab.url);
        if (tab.title) {
          // Title format LinkedIn : "Jean Dupont | LinkedIn" ou "(N) Jean Dupont | LinkedIn"
          const cleaned = tab.title.replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
          if (cleaned) setName(cleaned);
        }
      }
    });
  }, []);

  const handleAdd = async () => {
    if (!linkedinUrl.trim()) return;
    setAdding(true);
    setResult(null);
    try {
      const response = await sendMessage({
        type: 'QUICK_ADD_CANDIDATE',
        payload: {
          linkedin_url: linkedinUrl.trim(),
          name: name.trim() || undefined,
          headline: headline.trim() || undefined,
          note: note.trim() || undefined,
        },
      });
      if (response.ok) {
        const data = response.data as any;
        setResult({
          type: 'success',
          message: data?.already_in_pipeline
            ? 'Profil déjà dans votre pipeline (metadata mise à jour)'
            : 'Profil ajouté à votre pipeline ✓',
        });
        setNote('');
      } else {
        setResult({ type: 'error', message: response.error || 'Erreur' });
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Ajoute un profil LinkedIn à votre pool Konekt (pipeline global). Vous pourrez ensuite l'assigner à une mission.
      </p>

      <div className="space-y-2">
        <Field label="URL LinkedIn">
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/..."
            className="w-full h-9 px-2 text-xs font-mono border border-border bg-background focus:outline-none focus:border-foreground"
          />
        </Field>
        <Field label="Nom">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jean Dupont"
            className="w-full h-9 px-2 text-xs border border-border bg-background focus:outline-none focus:border-foreground"
          />
        </Field>
        <Field label="Headline (optionnel)">
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Senior DevOps Engineer @ Doctolib"
            className="w-full h-9 px-2 text-xs border border-border bg-background focus:outline-none focus:border-foreground"
          />
        </Field>
        <Field label="Note (optionnel)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex: rencontré au meetup Kubernetes, profil top"
            rows={2}
            className="w-full px-2 py-1.5 text-xs border border-border bg-background focus:outline-none focus:border-foreground resize-none"
          />
        </Field>
      </div>

      <button
        onClick={handleAdd}
        disabled={adding || !linkedinUrl.trim()}
        className="w-full h-10 bg-foreground text-background font-bold uppercase tracking-wider text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {adding ? 'Ajout…' : '➕ Ajouter au pipeline'}
      </button>

      {result && (
        <div className={`p-2.5 border text-xs ${
          result.type === 'success'
            ? 'bg-success/5 border-success text-success'
            : 'bg-destructive/5 border-destructive text-destructive'
        }`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// ─── Tab : Settings ──────────────────────────────────────────────────────────

function SettingsTab({ onLogout }: { onLogout: () => void }) {
  const [overlayEnabled, setOverlayEnabled] = useState(true);

  useEffect(() => {
    storage.getPipelineOverlayEnabled().then(setOverlayEnabled);
  }, []);

  const toggle = async (val: boolean) => {
    setOverlayEnabled(val);
    await storage.setPipelineOverlayEnabled(val);
  };

  const handleLogout = async () => {
    await storage.clearToken();
    onLogout();
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-2 p-2.5 border border-border cursor-pointer">
        <div>
          <div className="text-xs font-medium">Overlay pipeline LinkedIn</div>
          <div className="text-[10px] text-muted-foreground">Affiche un badge sur chaque profil déjà en pipeline</div>
        </div>
        <input
          type="checkbox"
          checked={overlayEnabled}
          onChange={(e) => toggle(e.target.checked)}
          className="w-4 h-4 cursor-pointer"
        />
      </label>

      <a
        href={`${KONEKT_APP_URL}/settings?tab=account`}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full p-2.5 text-xs border border-border hover:bg-muted/30 text-center"
      >
        ⚙️ Gérer les tokens dans Konekt →
      </a>

      <button
        onClick={handleLogout}
        className="w-full p-2.5 text-xs border border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        Déconnecter cette extension
      </button>

      <div className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border">
        Konekt extension v0.1.0
      </div>
    </div>
  );
}
