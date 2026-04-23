/**
 * Options page — collage du token Konekt et configuration initiale.
 */

import { useEffect, useState } from 'react';
import { storage } from '../lib/storage';
import { konektApi } from '../lib/konekt-api';
import { KONEKT_APP_URL } from '../lib/config';

export function Options() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    storage.getToken().then((t) => setSavedToken(t));
  }, []);

  const handleSave = async () => {
    const trimmed = token.trim();
    if (!trimmed.startsWith('kekt_')) {
      setResult({ type: 'error', message: 'Le token doit commencer par "kekt_"' });
      return;
    }
    if (trimmed.length < 30) {
      setResult({ type: 'error', message: 'Token trop court — vérifiez la copie' });
      return;
    }

    setVerifying(true);
    setResult(null);
    try {
      // Sauve le token, puis vérifie qu'il est valide
      await storage.setToken(trimmed);
      const valid = await konektApi.checkToken();
      if (valid) {
        setSavedToken(trimmed);
        setToken('');
        setResult({ type: 'success', message: 'Token validé ✓ — l\'extension est prête à l\'emploi' });
      } else {
        await storage.clearToken();
        setResult({ type: 'error', message: 'Token invalide ou révoqué côté Konekt' });
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Déconnecter l\'extension de Konekt ? Vous devrez recoller un token pour la réactiver.')) return;
    await storage.clearToken();
    setSavedToken(null);
    setResult(null);
  };

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center font-bold">K</div>
          <h1 className="text-2xl font-bold">Konekt — Réglages extension</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configurez l'extension Chrome Konekt en collant un token API généré depuis votre compte.
        </p>
      </header>

      {savedToken ? (
        <section className="border-2 border-success bg-success/5 p-4 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-success">✓ Extension connectée</h2>
          <p className="text-xs text-muted-foreground">
            Token actif : <code className="bg-muted px-1.5 py-0.5 text-[11px] font-mono">{savedToken.slice(0, 12)}…</code>
          </p>
          <p className="text-xs text-foreground">
            L'extension est opérationnelle. Cliquez sur l'icône Konekt dans la barre Chrome pour utiliser ses fonctions.
          </p>
          <button
            onClick={handleRemove}
            className="text-xs px-3 py-1.5 border border-destructive/40 text-destructive hover:bg-destructive/5"
          >
            Déconnecter
          </button>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Étape 1 : générer un token</h2>
            <ol className="text-sm space-y-1.5 ml-4 list-decimal text-foreground">
              <li>Connectez-vous à <a href={KONEKT_APP_URL} target="_blank" rel="noopener noreferrer" className="text-info underline">Konekt</a></li>
              <li>Allez sur <a href={`${KONEKT_APP_URL}/settings?tab=account`} target="_blank" rel="noopener noreferrer" className="text-info underline">Paramètres → Mon compte</a></li>
              <li>Section "Extension Chrome Konekt" → cliquez <strong>"Nouveau token"</strong></li>
              <li>Copiez le token affiché (il ne sera plus jamais ré-affiché)</li>
            </ol>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider">Étape 2 : coller le token</h2>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Token API Konekt</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="kekt_..."
                className="mt-1 w-full h-10 px-3 text-sm font-mono border border-border bg-background focus:outline-none focus:border-foreground"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Le token reste stocké localement dans votre navigateur (chrome.storage.local), jamais transmis ailleurs qu'à votre instance Konekt.
              </p>
            </label>

            <button
              onClick={handleSave}
              disabled={verifying || !token.trim()}
              className="w-full h-10 bg-foreground text-background font-bold uppercase tracking-wider text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {verifying ? 'Validation…' : 'Sauvegarder et activer'}
            </button>

            {result && (
              <div className={`p-3 border text-sm ${
                result.type === 'success'
                  ? 'bg-success/5 border-success text-success'
                  : 'bg-destructive/5 border-destructive text-destructive'
              }`}>
                {result.message}
              </div>
            )}
          </section>
        </>
      )}

      <footer className="pt-6 border-t border-border text-xs text-muted-foreground space-y-1">
        <p>Konekt Extension v0.1.0 — <a href={KONEKT_APP_URL} target="_blank" rel="noopener noreferrer" className="text-info underline">konekt-app-navy.vercel.app</a></p>
      </footer>
    </div>
  );
}
