# Politique de confidentialité — Extension Chrome Konekt

**Dernière mise à jour** : 2026-04-23
**Contact** : l.garilhe@konekt.fr

L'extension Chrome Konekt ("l'extension") est un outil destiné aux recruteurs utilisant la plateforme Konekt (https://konekt-app-navy.vercel.app). Cette politique explique quelles données l'extension collecte, pourquoi, et comment elles sont utilisées.

---

## 1. Données collectées

### 1.1 Cookie LinkedIn (`li_at`, `li_a`)

**Quand** : uniquement lorsque l'utilisateur clique explicitement sur **"Reconnecter mon compte LinkedIn"** dans la popup de l'extension.

**Comment** : l'extension utilise l'API `chrome.cookies.get` pour lire les cookies `li_at` (session LinkedIn) et `li_a` (Sales Navigator) depuis le domaine `linkedin.com`.

**Pourquoi** : ces cookies permettent à l'infrastructure Konekt (via le partenaire Unipile) de maintenir une session LinkedIn active au nom de l'utilisateur pour envoyer des messages et effectuer des recherches depuis l'app Konekt.

**Stockage** : **aucun**. Les cookies sont lus à la volée au moment du clic et envoyés directement à l'API Konekt de l'utilisateur. L'extension ne stocke **jamais** les cookies ni localement ni ailleurs.

### 1.2 User-Agent du navigateur

**Quand** : en même temps que le cookie LinkedIn, pour que le serveur Unipile utilise le même User-Agent que l'utilisateur afin d'éviter les détections de duplicate session par LinkedIn.

**Stockage** : aucun côté extension.

### 1.3 URLs de profils LinkedIn visités

**Quand** : lorsque l'utilisateur navigue sur `linkedin.com/in/*`, `linkedin.com/search/*` ou `linkedin.com/recruiter/*`.

**Comment** : le content script extrait les URLs des profils LinkedIn visibles dans la page courante et les envoie en batch (max 100 URLs/requête) au backend Konekt pour récupérer le statut pipeline associé.

**Pourquoi** : afficher les badges "Déjà en pipeline Konekt" sur les cards de résultats de recherche LinkedIn (feature d'anti-doublon).

**Stockage** : cache mémoire côté service worker (5 min TTL). Les URLs sont également stockées côté backend Konekt dans `job_candidate_status` si l'utilisateur a explicitement ajouté le candidat au pipeline.

### 1.4 Token API Konekt

**Quand** : l'utilisateur colle une fois son token API généré depuis https://konekt-app-navy.vercel.app/settings.

**Stockage** : `chrome.storage.local` (sandbox isolé de l'extension, non accessible aux pages web). Le token transite en header `X-Konekt-Extension-Token` uniquement vers l'API Konekt (HTTPS).

---

## 2. Données PAS collectées

- ❌ **Aucune donnée LinkedIn** hors celles demandées explicitement (nom, headline, URL affichés sur la page où l'utilisateur clique "Ajouter")
- ❌ **Aucune donnée de navigation** hors de linkedin.com
- ❌ **Aucune donnée personnelle** (pas de collecte de mot de passe, d'email hors ce que l'utilisateur fournit à Konekt, de coordonnées bancaires, etc.)
- ❌ **Aucune télémétrie anonymisée** envoyée à un tiers (ni Google Analytics, ni Sentry côté extension)
- ❌ **Aucune donnée de santé, géolocalisation, ou information personnelle sensible**

---

## 3. Destinataires des données

Toutes les données collectées sont envoyées **exclusivement** à :
- **Le backend Konekt** (hébergé chez Supabase, projet `crckfywoyjxkawathdff`, région EU Ireland)

Et, indirectement via le backend Konekt :
- **Unipile** (partenaire LinkedIn — lorsque l'utilisateur déclenche un "Reconnect LinkedIn"), conformément à leur politique de confidentialité : https://www.unipile.com/privacy

**Aucune donnée n'est vendue ni partagée** avec des tiers publicitaires, data brokers, ou entités autres que celles nécessaires au fonctionnement du service.

---

## 4. Sécurité

- **HTTPS** pour toutes les communications extension → backend Konekt
- **Token hashé SHA-256** en base (le token en clair n'est jamais stocké côté serveur Konekt)
- **Permissions Chrome minimales** : `cookies` scopé à linkedin.com uniquement, `storage`, `activeTab`, `scripting`
- **Sandbox d'extension** : le token et les préférences sont dans `chrome.storage.local`, isolés des pages web visitées (inaccessibles depuis JavaScript de sites tiers)

---

## 5. Durée de conservation

- **Token API côté extension** : conservé jusqu'à la désinstallation de l'extension ou la révocation manuelle par l'utilisateur.
- **Cache pipeline status** : 5 minutes en mémoire service worker, vidé au redémarrage de Chrome.
- **Cookie LinkedIn** : jamais stocké par l'extension (transmis à la volée).

---

## 6. Droits de l'utilisateur (RGPD)

Conformément au RGPD (règlement UE 2016/679) :

- **Droit d'accès** : voir toutes les données associées à votre compte dans Konekt (Settings > Mon compte)
- **Droit de rectification** : modifier vos données depuis l'app Konekt
- **Droit à l'effacement** : Settings > Mon compte > Supprimer mes données (ou envoyer un email à l.garilhe@konekt.fr)
- **Droit de révocation** : révoquer les tokens extension à tout moment depuis Settings > Mon compte
- **Droit d'opposition** : désinstaller l'extension à tout moment (suppression automatique du token local)

Pour exercer ces droits ou toute question : **l.garilhe@konekt.fr**

---

## 7. Modifications de cette politique

Toute modification majeure sera notifiée via l'app Konekt et/ou par email aux utilisateurs de l'extension avec un préavis raisonnable.

---

## 8. Juridiction

Cette extension est éditée par **Konekt** (France). Toute contestation relative à cette politique est régie par le droit français, juridiction des tribunaux de Paris.
