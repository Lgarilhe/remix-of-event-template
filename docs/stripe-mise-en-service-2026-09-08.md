# Mise en service du paiement : 8 septembre 2026

Onze organisations sont en essai Cabinet jusqu'au **21 septembre**. Passé cette
date, sans paiement possible, elles retombent sur le plan gratuit à 100 crédits
sans moyen de s'abonner. Ce document est la marche à suivre, dans l'ordre.

## 1. Ce qui bloquait avant ce lot

Le parcours de paiement n'avait jamais tourné une seule fois. Deux défauts le
rendaient inopérant, tous deux reproduits sur une base PostgreSQL 16 avec les
contraintes réelles.

L'enregistrement du client de paiement passait par un `upsert` dont trois champs
valaient `undefined` quand la ligne d'abonnement existait déjà. Ces champs
disparaissent du corps de la requête, PostgREST construit un `INSERT` sans
`plan_id`, et Postgres contrôle `NOT NULL` avant d'arbitrer le conflit. Les
dix-sept organisations ont une ligne d'abonnement : le refus était systématique,
après création d'un client chez le prestataire, orphelin de plus à chaque essai.

Le second défaut ne se serait vu que le 21 septembre : une organisation ayant
consommé plus de cent crédits pendant son essai tombait à zéro crédit au lieu des
cent du plan gratuit, et n'était rechargée qu'un mois plus tard.

Les deux sont corrigés dans le commit `fcc58dc`, avec vingt-sept autres constats
issus de la relecture contradictoire. Rien de tout cela n'est en production tant
que la branche n'est pas mergée.

## 2. Ordre des opérations

### Étape 1 : déployer le code

Merger `claude/repository-audit-pcgg0y` sur `main`. Deux workflows partent :
`deploy-edge-functions.yml` redéploie tout (`_shared/` a changé) et
`deploy-migrations.yml` applique `20260908222329_stripe_payment_path_fixes.sql`.
Vérifier que les deux passent avant la suite. Le repli en cas d'erreur de suivi
reste `workflow_dispatch` avec `repair_tracking=true`.

Rien de ce qui suit ne fonctionne sur l'ancien code.

### Étape 2 : les secrets, en mode test d'abord

Dans le tableau de bord Stripe en **mode test**, récupérer la clé secrète, puis :

```bash
supabase secrets set --project-ref crckfywoyjxkawathdff \
  STRIPE_SECRET_KEY=sk_test_...
```

Vérifier que `APP_URL` vaut bien `https://konekt-app-navy.vercel.app` : les URL
de retour de paiement en dépendent.

### Étape 3 : le point de terminaison webhook

Créer l'endpoint sur
`https://crckfywoyjxkawathdff.supabase.co/functions/v1/stripe-webhook`
avec **six** événements :

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Le deuxième est souvent oublié : sans lui, un paiement à notification différée
(prélèvement, virement) n'est jamais crédité. Le code le traite déjà.

Puis poser le secret de signature affiché à la création :

```bash
supabase secrets set --project-ref crckfywoyjxkawathdff \
  STRIPE_WEBHOOK_SECRET=whsec_...
```

### Étape 4 : produits, prix et portail

Le premier paiement ne demande aucun produit : la fonction construit le prix à la
volée depuis `subscription_plans`. Les prix servent au portail client, seul
endroit d'où un abonné peut changer de plan ou ajouter un siège. Sans eux, les
boutons « Changer de plan » et « Ajouter un siège » mènent à un portail qui ne
propose que le moyen de paiement, les factures et l'annulation.

```bash
export STRIPE_SECRET_KEY=sk_test_...

# Voir l'état du compte, sans rien écrire
node scripts/stripe-setup.mjs check

# Décrire ce qui serait créé, puis créer
node scripts/stripe-setup.mjs prices
node scripts/stripe-setup.mjs prices --apply

# Autoriser le changement de plan et de quantité dans le portail
node scripts/stripe-setup.mjs portal --apply
```

Le script est rejouable : un produit ou un prix déjà conforme est réutilisé,
jamais dupliqué. Il crée trois produits (Solo, Cabinet, Entreprise) et six prix
récurrents par siège, mensuels et annuels, aux montants lus dans la base.

### Étape 5 : enregistrer les identifiants de prix

`prices --apply` affiche les ordres SQL à jouer dans l'éditeur Supabase. Ils
remplissent `stripe_price_id_monthly` et `stripe_price_id_yearly`. Tant que ces
colonnes sont vides, le premier paiement fonctionne mais le portail ne peut rien
changer.

### Étape 6 : un paiement de test par plan et par cycle

Aucun test automatisé ne couvre ce parcours. À faire à la main, en mode test :

1. Depuis une organisation en essai, `/pricing`, choisir Cabinet mensuel. La
   fin d'essai est reportée sur l'abonnement : le paiement n'est pas prélevé
   immédiatement et le statut reste « essai » jusqu'au 21.
2. Vérifier dans Paramètres, Abonnement : le plan, la mention « déjà couvert par
   votre abonnement », la prochaine échéance, le nombre de sièges facturés.
3. Ouvrir « Gérer l'abonnement », changer de plan, revenir, et vérifier que la
   base suit (voir les requêtes ci-dessous). C'est le point qui échouait avant ce
   lot.
4. Ajouter un siège depuis le portail, vérifier que `seats` bouge.
5. Annuler, vérifier le passage sur le plan gratuit et le recalcul des crédits.
6. Acheter un pack de crédits, vérifier `topup_credits`.
7. Rejouer chaque événement depuis le tableau de bord Stripe : aucun état ne doit
   changer deux fois.

### Étape 7 : passer en réel

Refaire les étapes 2 à 5 avec la clé `sk_live_`, un nouvel endpoint webhook et un
nouveau secret de signature. Les produits et prix du mode test n'existent pas en
mode réel, et les identifiants de client non plus : la colonne
`stripe_customer_id` des organisations qui auraient payé en test doit être
remise à `NULL` avant l'ouverture, sinon leur premier paiement réel échoue sur un
client introuvable.

```sql
update public.organization_subscriptions
set stripe_customer_id = null, stripe_subscription_id = null
where stripe_customer_id like 'cus_%';
```

À ne jouer qu'après les tests et avant le passage en réel. Une organisation qui
avait payé en test reprend alors le cours normal de son essai, et son abonnement
de test n'a plus aucun effet.

`node scripts/stripe-setup.mjs check` avec la clé réelle liste les six événements
attendus et signale ceux qui manquent sur l'endpoint : à lancer une fois la
configuration terminée.

## 3. Requêtes de contrôle

```sql
-- Les prix sont-ils enregistrés ?
select id, stripe_price_id_monthly, stripe_price_id_yearly
from public.subscription_plans where is_active order by id;

-- Qui paie, sur quel plan, avec combien de sièges ?
select o.name, s.plan_id, s.status, s.seats, s.current_period_end,
       s.stripe_customer_id is not null as client_pose,
       s.stripe_subscription_id is not null as abonnement_pose
from public.organizations o
join public.organization_subscriptions s on s.organization_id = o.id
order by s.status, o.name;

-- Les crédits suivent-ils le plan ?
select s.plan_id, b.plan_credits, b.topup_credits, b.period_end
from public.organization_subscriptions s
join public.ai_credit_balances b on b.organization_id = s.organization_id
order by s.plan_id;
```

## 4. Décisions restées ouvertes

**Huit organisations n'ont pas de `org_type`.** Le plan Solo est réservé aux
indépendants ; le contrôle serveur refuse maintenant par défaut, donc ces huit
organisations ne peuvent plus prendre Solo. Deux d'entre elles sont en essai
Cabinet et pourront s'abonner à Cabinet sans problème. Reste à décider si
l'onboarding doit imposer le champ, ou si un rattrapage manuel est préférable
avant l'ouverture.

**Deux plans hérités.** `pro` et `enterprise` sont inactifs et sans prix. Aucune
organisation ne les porte. Ils peuvent rester, ils ne sont ni affichés ni
achetables.

**Le compte interne Konekt.** Après le rattrapage il reçoit les crédits de son
plan comme les autres. Pour le garder illimité, le rattacher à un plan dont
`limits.ai_credits` vaut -1, ou poser `plan_credits = 999999` avec une
`period_end` lointaine.

## 5. Ce que la relecture a écarté

Onze constats sur quarante n'ont pas survécu à la réfutation, dont deux qui
paraissaient sérieux : la conversion d'un essai en abonnement payant ne recrédite
pas l'organisation, ce qui est le comportement attendu puisque le plan ne change
pas ; et l'absence de clé d'idempotence sur la création du client de paiement,
sans conséquence maintenant que l'identifiant est enregistré du premier coup.
