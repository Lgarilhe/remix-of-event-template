# Konekt Chrome Extension

Extension Chrome qui complète l'app web Konekt sur LinkedIn :
- 🔌 **Reconnect LinkedIn en 1 clic** — capture le cookie li_at depuis votre session active
- 🏷️ **Badges pipeline overlay** — sur chaque profil dans une recherche LinkedIn, un badge indique son statut Konekt (déjà contacté, scoré, en pipeline, etc.)
- ➕ **Ajout rapide au pipeline** — bouton flottant sur chaque profil pour l'ajouter à votre pool en 1 clic
- 📝 **Notes rapides** — sans quitter LinkedIn

## Stack

- Manifest V3 (Chrome / Edge / Brave compat)
- Vite + React 18 + TypeScript
- Tailwind CSS (config minimale)
- Communication via `chrome.runtime.sendMessage` entre popup / content / SW

## Architecture

```
extensions/chrome/
├── manifest.json                    # Manifest V3
├── public/icons/                    # 16/32/48/128 PNG (placeholders à remplir)
├── src/
│   ├── background/sw.ts             # Service worker : capture cookies, route messages
│   ├── popup/                       # UI popup (3 tabs : Reconnect / Add / Settings)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Popup.tsx
│   ├── options/                     # Page de réglage (paste token Konekt)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Options.tsx
│   ├── content/                     # Content scripts injectés sur linkedin.com
│   │   ├── linkedin.ts              # bouton flottant + overlay badges
│   │   └── linkedin.css             # styles overlay (préfixés .konekt-)
│   ├── lib/
│   │   ├── config.ts                # URLs API + storage keys
│   │   ├── konekt-api.ts            # client REST authentifié
│   │   └── storage.ts               # wrapper chrome.storage.local
│   └── styles.css                   # Tailwind + tokens design (popup/options)
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
└── vite.config.ts
```

## Installation locale (mode développeur)

1. **Build de l'extension** :
   ```bash
   cd extensions/chrome
   npm install
   npm run build
   ```
   → produit `dist/` avec `manifest.json` + popup/options/content/sw.

2. **Charger dans Chrome** :
   - Ouvrir `chrome://extensions/`
   - Activer **"Mode développeur"** (toggle haut droite)
   - Cliquer **"Charger l'extension non empaquetée"** → sélectionner `extensions/chrome/dist/`
   - L'icône Konekt apparaît dans la barre Chrome

3. **Configurer le token** :
   - Aller sur https://konekt-app-navy.vercel.app/settings?tab=account
   - Section "Extension Chrome Konekt" → "Nouveau token" → copier le token
   - Cliquer sur l'icône Konekt → "Ouvrir les réglages" → coller le token → "Sauvegarder"

4. **Tester** :
   - **Reconnect** : dans la popup → tab "🔌 Reconnecter" → cliquer le bouton (capture cookie li_at automatiquement)
   - **Pipeline overlay** : aller sur une recherche LinkedIn (`https://www.linkedin.com/search/results/people/...`) → badges Konekt apparaissent en haut à droite des cards
   - **Quick add** : sur un profil LinkedIn (`/in/...`) → bouton flottant "+ Konekt" en bas à droite OU popup tab "➕ Ajouter"

## Build de production

```bash
npm run build:prod   # build optimisé
npm run package      # build + zip → konekt-extension.zip prêt pour Chrome Web Store
```

## Publication sur Chrome Web Store

1. Créer un compte développeur (5 USD one-time) : https://chrome.google.com/webstore/devconsole/
2. Uploader le `konekt-extension.zip`
3. Compléter la fiche : screenshots (1280x800), description, catégorie "Productivity"
4. Soumettre — review prend 1-3 jours

## Sécurité

- Le **token API** est stocké dans `chrome.storage.local` (sandbox extension, isolé des pages web).
- Toutes les requêtes API utilisent le header `X-Konekt-Extension-Token` — jamais en query string.
- Le cookie LinkedIn `li_at` n'est **jamais persisté** dans l'extension : il est lu via `chrome.cookies.get` au moment du clic "Reconnecter" et envoyé directement au backend.
- Permissions minimales (`cookies` sur linkedin.com uniquement, `storage`, `activeTab`).

## Dev workflow

```bash
# Watch mode (rebuild auto) — recharger l'extension dans chrome://extensions/ après chaque change
npm run dev
```

Pour debugger le service worker : `chrome://extensions/` → carte de l'extension → "Inspecter les vues : service worker".

## Roadmap V2+

- Capture filtres recherche LinkedIn → template mission Konekt
- Évaluer rapide depuis l'extension (scoring IA en background)
- Hover preview anti-doublon (tooltip Konekt sur les noms LinkedIn)
- Inbox unifiée mini (5 derniers messages)
- Email finder inline
- Auto-import jobs depuis page entreprise LinkedIn
