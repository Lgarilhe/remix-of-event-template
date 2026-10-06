// ────────────────────────────────────────────────────────────────────
// Mise en place Stripe pour Konekt : produits, prix récurrents par siège,
// configuration du portail client, et état de compte.
//
// Le premier paiement ne demande aucun produit : create-checkout-session
// construit le prix en ligne depuis subscription_plans. Les prix créés ici
// servent au portail client, seul endroit d'où un abonné peut changer de
// plan ou ajouter un siège.
//
// Usage :
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs check
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs prices
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs prices --apply
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs portal --apply
//
// Sans --apply, rien n'est écrit chez Stripe : la commande affiche ce
// qu'elle ferait. Les deux commandes sont rejouables : un produit ou un
// prix déjà conforme est réutilisé, jamais dupliqué.
//
// Les montants viennent de subscription_plans. Le script les lit par
// l'API REST publique si SUPABASE_URL et SUPABASE_ANON_KEY sont dans
// l'environnement, sinon il utilise la copie ci-dessous.
// ────────────────────────────────────────────────────────────────────

const STRIPE_API = "https://api.stripe.com/v1";

// Copie de secours de subscription_plans (montants en centimes, par siège).
// À garder alignée sur la base ; le script signale tout écart qu'il lit.
const FALLBACK_PLANS = [
  { id: "solo", name: "Solo", price_monthly: 5900, price_yearly: 59000, currency: "eur" },
  { id: "cabinet", name: "Cabinet", price_monthly: 13900, price_yearly: 139000, currency: "eur" },
  { id: "entreprise", name: "Entreprise", price_monthly: 18900, price_yearly: 189000, currency: "eur" },
];

const CYCLES = [
  { key: "monthly", interval: "month", column: "stripe_price_id_monthly", amountField: "price_monthly" },
  { key: "yearly", interval: "year", column: "stripe_price_id_yearly", amountField: "price_yearly" },
];

// ─── Utilitaires ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || "check";
const apply = args.includes("--apply");

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("STRIPE_SECRET_KEY manquante dans l'environnement.");
  process.exit(1);
}
const mode = KEY.startsWith("sk_live_") ? "LIVE" : KEY.startsWith("sk_test_") ? "TEST" : "INCONNU";

/** Encode un objet imbriqué au format attendu par Stripe (a[b][0][c]=v). */
function encodeForm(obj, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") encodeForm(item, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (typeof value === "object") {
      encodeForm(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

async function stripe(method, path, body) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: encodeForm(body) } : {}),
  });
  const payload = await res.json();
  if (!res.ok) {
    const message = payload?.error?.message || JSON.stringify(payload);
    throw new Error(`${method} ${path} → ${res.status} : ${message}`);
  }
  return payload;
}

function euros(cents) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

/** Lit subscription_plans par l'API REST publique, sinon rend la copie locale. */
async function loadPlans() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    console.log("Montants : copie locale du script (SUPABASE_URL / SUPABASE_ANON_KEY absentes).\n");
    return FALLBACK_PLANS;
  }
  try {
    const query = "select=id,name,currency,price_monthly,price_yearly&is_active=eq.true&id=neq.free";
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/subscription_plans?${query}`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("aucun plan actif");
    console.log(`Montants : lus depuis subscription_plans (${rows.length} plans actifs).\n`);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      currency: (r.currency || "eur").toLowerCase(),
      price_monthly: Number(r.price_monthly),
      price_yearly: Number(r.price_yearly),
    }));
  } catch (err) {
    console.log(`Montants : copie locale du script (lecture de la base impossible : ${err.message}).\n`);
    return FALLBACK_PLANS;
  }
}

// ─── Produits et prix ───────────────────────────────────────────────

/** Produit du plan, repéré par metadata.konekt_plan_id. Jamais deux fois le même. */
async function findProduct(planId) {
  const { data } = await stripe("GET", "/products?limit=100&active=true");
  return data.find((p) => p.metadata?.konekt_plan_id === planId) || null;
}

async function findPrice(productId, { interval, amount, currency }) {
  const { data } = await stripe("GET", `/prices?product=${encodeURIComponent(productId)}&limit=100&active=true`);
  return (
    data.find(
      (p) =>
        p.recurring?.interval === interval &&
        p.recurring?.interval_count === 1 &&
        p.unit_amount === amount &&
        p.currency === currency &&
        p.billing_scheme === "per_unit",
    ) || null
  );
}

async function setupPrices() {
  const plans = await loadPlans();
  const updates = [];

  for (const plan of plans) {
    let product = await findProduct(plan.id);
    if (product) {
      console.log(`Plan ${plan.id} : produit existant ${product.id} (${product.name})`);
    } else if (apply) {
      product = await stripe("POST", "/products", {
        name: `Konekt ${plan.name}`,
        description: "Abonnement Konekt, par siège",
        metadata: { konekt_plan_id: plan.id },
      });
      console.log(`Plan ${plan.id} : produit créé ${product.id}`);
    } else {
      console.log(`Plan ${plan.id} : produit à créer (Konekt ${plan.name})`);
    }

    for (const cycle of CYCLES) {
      const amount = plan[cycle.amountField];
      if (!Number.isInteger(amount) || amount <= 0) {
        console.log(`  ${cycle.key} : montant inutilisable (${amount}), ignoré`);
        continue;
      }
      const spec = { interval: cycle.interval, amount, currency: plan.currency || "eur" };

      if (!product) {
        console.log(`  ${cycle.key} : prix à créer, ${euros(amount)} par siège`);
        continue;
      }

      let price = await findPrice(product.id, spec);
      if (price) {
        console.log(`  ${cycle.key} : prix existant ${price.id} (${euros(amount)} par siège)`);
      } else if (apply) {
        price = await stripe("POST", "/prices", {
          product: product.id,
          currency: spec.currency,
          unit_amount: amount,
          recurring: { interval: cycle.interval, interval_count: 1, usage_type: "licensed" },
          nickname: `Konekt ${plan.name} ${cycle.key === "monthly" ? "mensuel" : "annuel"}`,
          metadata: { konekt_plan_id: plan.id, konekt_cycle: cycle.key },
        });
        console.log(`  ${cycle.key} : prix créé ${price.id} (${euros(amount)} par siège)`);
      } else {
        console.log(`  ${cycle.key} : prix à créer, ${euros(amount)} par siège`);
      }

      if (price) updates.push({ planId: plan.id, column: cycle.column, priceId: price.id });
    }
  }

  if (updates.length === 0) {
    console.log("\nAucun identifiant de prix à enregistrer. Relancez avec --apply.");
    return;
  }

  console.log("\n── SQL à jouer dans l'éditeur Supabase ──\n");
  const byPlan = new Map();
  for (const u of updates) {
    if (!byPlan.has(u.planId)) byPlan.set(u.planId, {});
    byPlan.get(u.planId)[u.column] = u.priceId;
  }
  for (const [planId, cols] of byPlan) {
    const sets = Object.entries(cols)
      .map(([col, id]) => `${col} = '${id}'`)
      .join(",\n    ");
    console.log(`update public.subscription_plans set\n    ${sets}\n  where id = '${planId}';`);
  }
  console.log(
    "\nselect id, stripe_price_id_monthly, stripe_price_id_yearly from public.subscription_plans order by id;",
  );
}

// ─── Portail client ─────────────────────────────────────────────────

/**
 * create-portal-session n'envoie pas de paramètre configuration : Stripe
 * applique la configuration par défaut du compte. C'est donc celle-ci que
 * l'on met à jour, sans quoi le portail ne propose ni changement de plan
 * ni ajout de siège.
 */
async function setupPortal() {
  const plans = await loadPlans();
  const products = [];

  for (const plan of plans) {
    const product = await findProduct(plan.id);
    if (!product) {
      console.log(`Plan ${plan.id} : aucun produit. Lancez d'abord "prices --apply".`);
      continue;
    }
    const prices = [];
    for (const cycle of CYCLES) {
      const amount = plan[cycle.amountField];
      if (!Number.isInteger(amount) || amount <= 0) continue;
      const price = await findPrice(product.id, { interval: cycle.interval, amount, currency: plan.currency || "eur" });
      if (price) prices.push(price.id);
    }
    if (prices.length === 0) {
      console.log(`Plan ${plan.id} : aucun prix trouvé, ignoré.`);
      continue;
    }
    console.log(`Plan ${plan.id} : ${product.id} avec ${prices.length} prix`);
    products.push({ product: product.id, prices });
  }

  if (products.length === 0) {
    console.log("Rien à configurer.");
    return;
  }

  const features = {
    customer_update: { enabled: true, allowed_updates: ["address", "email", "name", "tax_id"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price", "quantity", "promotion_code"],
      proration_behavior: "create_prorations",
      products,
    },
  };

  const { data: existing } = await stripe("GET", "/billing_portal/configurations?is_default=true&limit=1");
  const current = existing[0] || null;

  if (!apply) {
    console.log(
      current
        ? `\nConfiguration par défaut ${current.id} à mettre à jour (changement de plan et de quantité).`
        : "\nAucune configuration par défaut : une configuration serait créée.",
    );
    console.log("Relancez avec --apply pour l'appliquer.");
    return;
  }

  if (current) {
    const updated = await stripe("POST", `/billing_portal/configurations/${current.id}`, { features });
    console.log(`\nConfiguration ${updated.id} mise à jour.`);
  } else {
    const created = await stripe("POST", "/billing_portal/configurations", {
      features,
      business_profile: { headline: "Konekt, gestion de votre abonnement" },
    });
    console.log(`\nConfiguration ${created.id} créée (elle devient la configuration par défaut).`);
  }
}

// ─── État du compte ─────────────────────────────────────────────────

async function check() {
  const plans = await loadPlans();

  console.log("── Produits et prix ──");
  for (const plan of plans) {
    const product = await findProduct(plan.id);
    if (!product) {
      console.log(`  ${plan.id} : aucun produit`);
      continue;
    }
    const found = [];
    for (const cycle of CYCLES) {
      const amount = plan[cycle.amountField];
      const price = await findPrice(product.id, { interval: cycle.interval, amount, currency: plan.currency || "eur" });
      found.push(`${cycle.key}=${price ? price.id : "absent"}`);
    }
    console.log(`  ${plan.id} : ${product.id} — ${found.join(", ")}`);
  }

  console.log("\n── Points de terminaison webhook ──");
  const { data: endpoints } = await stripe("GET", "/webhook_endpoints?limit=50");
  if (endpoints.length === 0) {
    console.log("  aucun");
  }
  const attendus = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  for (const ep of endpoints) {
    const events = ep.enabled_events || [];
    const tout = events.includes("*");
    const manquants = tout ? [] : attendus.filter((e) => !events.includes(e));
    console.log(`  ${ep.url}`);
    console.log(`    statut ${ep.status}, ${tout ? "tous les événements" : events.length + " événements"}`);
    if (manquants.length) console.log(`    manquants : ${manquants.join(", ")}`);
  }

  console.log("\n── Portail client ──");
  const { data: configs } = await stripe("GET", "/billing_portal/configurations?is_default=true&limit=1");
  const config = configs[0];
  if (!config) {
    console.log("  aucune configuration par défaut");
  } else {
    const su = config.features?.subscription_update;
    console.log(`  ${config.id}, actif ${config.active}`);
    console.log(`    changement d'abonnement : ${su?.enabled ? "activé" : "désactivé"}`);
    if (su?.enabled) {
      console.log(`    modifications permises : ${(su.default_allowed_updates || []).join(", ") || "aucune"}`);
      console.log(`    produits proposés : ${(su.products || []).length}`);
    }
    console.log(`    annulation : ${config.features?.subscription_cancel?.enabled ? "activée" : "désactivée"}`);
  }
}

// ─── Entrée ─────────────────────────────────────────────────────────

console.log(`Clé Stripe en mode ${mode}${apply ? ", écriture activée" : ", simulation (ajoutez --apply pour écrire)"}\n`);

try {
  if (command === "check") await check();
  else if (command === "prices") await setupPrices();
  else if (command === "portal") await setupPortal();
  else {
    console.error(`Commande inconnue : ${command}. Utilisez check, prices ou portal.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\nÉchec : ${err.message}`);
  process.exit(1);
}
