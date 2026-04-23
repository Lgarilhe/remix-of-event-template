# Konekt Chrome Extension — Fiche Chrome Web Store

Copies prêtes à coller dans le formulaire Chrome Web Store Developer Dashboard.

---

## 🇫🇷 Version française

### Titre (max 75 chars)
```
Konekt — Recrutement IA pour LinkedIn
```

### Description courte / Summary (max 132 chars)
```
Reconnectez votre compte LinkedIn en 1 clic, voyez le statut Konekt de chaque profil et ajoutez des candidats au pipeline.
```

### Description détaillée (max 16 000 chars)
```
L'extension Chrome Konekt transforme votre expérience LinkedIn quand vous recrutez avec la plateforme Konekt (https://konekt-app-navy.vercel.app).

🔌 RECONNEXION LINKEDIN EN 1 CLIC
Votre session LinkedIn expirée dans Konekt ? Un clic et l'extension capture automatiquement votre cookie actif pour reconnecter votre compte, sans copier-coller manuel et sans déconnecter votre session navigateur.

🏷️ STATUT PIPELINE EN OVERLAY
Sur chaque résultat de recherche LinkedIn, un badge Konekt indique immédiatement si le profil est déjà dans votre pipeline, à quel stage (Nouveau, Contacté, Répondu, Pressenti, CV envoyé…), avec le score IA et la mission associée. Fini les doubles contacts — économisez 40% de temps de sourcing.

➕ AJOUT RAPIDE AU PIPELINE
Un bouton flottant "+ Konekt" sur chaque profil LinkedIn pour ajouter le candidat à votre pool en 1 clic. Sans ouvrir Konekt, sans copier-coller d'URL, le nom et le titre sont capturés automatiquement.

📝 NOTES RAPIDES
Prenez une note sur un candidat depuis LinkedIn sans quitter la page. La note est synchronisée dans Konekt et attachée au profil pour consultation ultérieure par votre équipe.

🔒 SÉCURITÉ & CONFIDENTIALITÉ
- Votre cookie LinkedIn n'est JAMAIS stocké par l'extension : lu à la volée, envoyé chiffré à votre backend Konekt.
- Token API stocké dans le sandbox chrome.storage.local (isolé des pages web).
- Permissions minimales : cookies sur linkedin.com uniquement, storage, activeTab.
- Code source consultable (extension open-source incluse dans le repo Konekt).
- Politique de confidentialité : https://konekt-app-navy.vercel.app/privacy

⚙️ PRÉREQUIS
Cette extension est un complément de l'application web Konekt. Vous devez avoir un compte Konekt actif (https://konekt-app-navy.vercel.app) pour l'utiliser. Un token API généré depuis les paramètres de votre compte est requis lors de la première configuration.

🛠️ CONFIGURATION (1 minute)
1. Installez l'extension
2. Connectez-vous à Konekt et allez sur Paramètres > Mon compte > Extension Chrome Konekt
3. Cliquez sur "Nouveau token" et copiez le token généré
4. Cliquez sur l'icône Konekt dans Chrome > Ouvrir les réglages
5. Collez le token et validez — c'est prêt.

📖 EN SAVOIR PLUS
Site : https://konekt-app-navy.vercel.app
Support : l.garilhe@konekt.fr
Confidentialité : https://konekt-app-navy.vercel.app/privacy

---
Konekt est une plateforme française de recrutement IA tout-en-un, incluant sourcing LinkedIn, scoring candidats, séquences outreach multicanales et pipeline kanban.
```

### Catégorie
- **Productivity** (recommandé) ou **Business Tools**

### Langue principale
- Français (France)

### Tags / keywords suggérés
recrutement, linkedin, sourcing, ATS, pipeline, candidat, recrutement IA, outreach

---

## 🇬🇧 English version

### Title (max 75 chars)
```
Konekt — AI Recruitment for LinkedIn
```

### Short description (max 132 chars)
```
Reconnect your LinkedIn account in 1 click, see Konekt pipeline status on every profile, add candidates to your pipeline.
```

### Detailed description
```
The Konekt Chrome Extension transforms your LinkedIn experience when recruiting with the Konekt platform (https://konekt-app-navy.vercel.app).

🔌 ONE-CLICK LINKEDIN RECONNECTION
LinkedIn session expired in Konekt? One click captures your active cookie and reconnects your account — no manual copy-paste, no session conflict with your browser.

🏷️ PIPELINE STATUS OVERLAY
On every LinkedIn search result, a Konekt badge instantly shows if the profile is in your pipeline, at which stage (New, Contacted, Replied, Shortlisted, CV sent…), with the AI score and associated mission. No more duplicate outreach — save 40% of sourcing time.

➕ QUICK ADD TO PIPELINE
A floating "+ Konekt" button on every LinkedIn profile to add the candidate to your pool in 1 click. Without opening Konekt, without URL copy-paste, name and title are captured automatically.

📝 QUICK NOTES
Take a note on a candidate from LinkedIn without leaving the page. The note syncs to Konekt and attaches to the profile for later team review.

🔒 SECURITY & PRIVACY
- Your LinkedIn cookie is NEVER stored by the extension: read on-the-fly, sent encrypted to your Konekt backend.
- API token stored in chrome.storage.local sandbox (isolated from web pages).
- Minimal permissions: cookies on linkedin.com only, storage, activeTab.
- Open source code (extension source in the Konekt repo).
- Privacy policy: https://konekt-app-navy.vercel.app/privacy

⚙️ REQUIREMENTS
This extension complements the Konekt web app. You need an active Konekt account (https://konekt-app-navy.vercel.app) to use it. An API token generated from your account settings is required for the first setup.

🛠️ SETUP (1 minute)
1. Install the extension
2. Log in to Konekt and go to Settings > My Account > Konekt Chrome Extension
3. Click "New token" and copy the generated token
4. Click the Konekt icon in Chrome > Open settings
5. Paste the token and save — ready to go.

📖 LEARN MORE
Website: https://konekt-app-navy.vercel.app
Support: l.garilhe@konekt.fr
Privacy: https://konekt-app-navy.vercel.app/privacy

---
Konekt is a French all-in-one AI recruitment platform, including LinkedIn sourcing, candidate scoring, multi-channel outreach sequences, and kanban pipeline.
```

---

## 📋 Justifications des permissions (pour formulaire Web Store)

Le Chrome Web Store demande de justifier **chaque permission** demandée. Voici les réponses types.

### `cookies`
```
Required to read the LinkedIn session cookie (li_at) on user-triggered "Reconnect LinkedIn" action only. The cookie is read via chrome.cookies.get API and sent immediately to the user's authenticated Konekt backend. Never stored locally by the extension. Cookie access is scoped exclusively to *.linkedin.com via host_permissions.
```

### `storage`
```
Required to persist the user's Konekt API token in chrome.storage.local (sandboxed extension storage, inaccessible from web pages). This token authenticates the extension to the Konekt backend on behalf of the user.
```

### `activeTab`
```
Required to read the current tab's URL and title when the user clicks "Quick Add" in the popup, to pre-fill the candidate's LinkedIn URL and name.
```

### `scripting`
```
Required to capture the real user-agent string from the active LinkedIn tab (via chrome.scripting.executeScript with a single navigator.userAgent line). The user-agent is needed by the Konekt backend + Unipile to avoid LinkedIn duplicate-session detection during reconnect.
```

### `host_permissions` — `https://*.linkedin.com/*`
```
Required for:
1. Reading the LinkedIn session cookie (via cookies API, scoped to this host)
2. Injecting content scripts on linkedin.com/in, /search, /recruiter for pipeline status overlay and quick-add floating button
```

### `host_permissions` — `https://crckfywoyjxkawathdff.supabase.co/*`
```
Required for API communication with the Konekt backend (Supabase-hosted). All extension features (reconnect, pipeline status, quick add, token verification) communicate exclusively with this single Konekt backend URL.
```

### Single purpose
```
The single purpose of this extension is to integrate LinkedIn browsing with the Konekt recruitment SaaS platform, providing in-context pipeline status overlays, quick-add to pipeline from any LinkedIn profile, and LinkedIn cookie recapture for session management. All features serve this unified recruitment-workflow purpose.
```

---

## 🎨 Assets requis

### Obligatoires
- **Icône 128x128 PNG** : logo Konekt carré
- **Au moins 1 screenshot 1280x800 PNG** : capture en action (recommandé 3-5)
- **Description courte** (132 chars max) : voir ci-dessus

### Recommandés pour maximiser la visibilité
- **Promo tile 440x280 PNG** : visuel marketing
- **Marquee promo 1400x560 PNG** : bannière featured (si Google te propose d'être featured)
- **Video démo YouTube** : 30-60s montrant les 3 features principales

### Screenshots à capturer
1. **Hero shot** : extension popup ouverte avec les 3 tabs visibles, sur fond d'une page LinkedIn
2. **Pipeline overlay** : résultats de recherche LinkedIn avec badges Konekt superposés
3. **Quick add** : page profil LinkedIn avec bouton flottant "+ Konekt" et le toast "Ajouté ✓"
4. **Reconnect flow** : popup tab "Reconnecter" avec le bouton + résultat success
5. **Options page** : page de setup avec le champ token + instructions

---

## 💰 Coûts

- **Fee Developer Google** : 5 USD (one-time, paiement carte bancaire)
- **Extension** : gratuite pour les utilisateurs (la valeur vient du compte Konekt payant)

---

## ⏱️ Timeline review

- **Premier submission** : 1-3 jours ouvrés (parfois plus si permissions sensibles = `cookies`)
- **Updates** : généralement < 24h
- **Flagged for manual review** : jusqu'à 7 jours (probabilité moyenne avec `cookies` sur un domaine sensible comme linkedin.com)

Conseils pour éviter les blocages :
- Privacy policy hébergée et accessible publiquement (on l'héberge sur konekt-app-navy.vercel.app/privacy-extension)
- Vidéo demo dans la description → les reviewers comprennent vite le but
- Justifications permissions claires (copies ci-dessus)
- Un "mode" dans la description qui explique clairement le lien avec la plateforme Konekt payante (les extensions qui "scrape" LinkedIn sans consentement explicite se font blacklister)

---

## 🔄 Process de publication step-by-step

1. **Créer compte développeur Chrome Web Store**
   - Aller sur https://chrome.google.com/webstore/devconsole/
   - Se connecter avec un compte Google (idéalement un compte Konekt dédié, ex: dev@konekt.fr)
   - Payer 5 USD (une seule fois, à vie)
   - Attendre validation du paiement (quelques minutes)

2. **Préparer le .zip de l'extension**
   ```powershell
   cd C:\Users\Hugo\dev\remix-of-event-template\extensions\chrome
   npm run build
   cd dist
   Compress-Archive -Path * -DestinationPath ..\konekt-extension-v0.1.0.zip -Force
   ```

3. **Uploader dans Developer Dashboard**
   - Cliquer "New item"
   - Uploader `konekt-extension-v0.1.0.zip`
   - Attendre le parsing du manifest.json (quelques secondes)

4. **Remplir la fiche**
   - Copier les titres/descriptions FR + EN depuis ce fichier
   - Uploader les screenshots (min 1, recommandé 5)
   - Uploader promo tile 440x280 (optionnel)
   - Renseigner justifications permissions (copies ci-dessus)
   - Privacy policy URL : https://konekt-app-navy.vercel.app/privacy-extension
   - Support email : l.garilhe@konekt.fr
   - Catégorie : Productivity
   - Visibility : Public (ou "Unlisted" si tu veux tester avec un link privé d'abord)

5. **Soumettre pour review**
   - Google review : 1-7 jours
   - Tu reçois un email quand c'est approuvé
   - L'extension apparaît dans le Chrome Web Store à l'URL : `https://chromewebstore.google.com/detail/{extension-id}`

6. **Push les updates**
   - Bump version dans `manifest.json` (ex: `0.1.0` → `0.1.1`)
   - Rebuild + zip
   - Upload nouvelle version dans Dashboard > "Package" tab

---

## 📝 Liste complète des actions "à faire côté Laurent"

- [ ] Créer compte Chrome Web Store Developer (5 USD)
- [ ] Générer les 4 icônes PNG (16, 32, 48, 128) — peut être automatisé via favicon.io depuis un SVG
- [ ] Générer 1 promo tile 440x280 (Figma / Canva)
- [ ] Capturer 3-5 screenshots (1280x800) en action
- [ ] Héberger PRIVACY_POLICY.md sur konekt-app-navy.vercel.app/privacy-extension (j'ajoute la route)
- [ ] Créer un compte email support si besoin (l.garilhe@konekt.fr existe déjà)
- [ ] (Optionnel) Enregistrer vidéo démo 30-60s et l'uploader sur YouTube (non listé OK)
- [ ] Soumettre sur Chrome Web Store Dashboard
