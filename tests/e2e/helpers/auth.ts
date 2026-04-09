import { type Page, expect } from '@playwright/test';

/* ------------------------------------------------------------------ */
/*  Environment helpers                                                */
/* ------------------------------------------------------------------ */

export function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const SUPABASE_URL = () => env('SUPABASE_URL');
export const SUPABASE_ANON_KEY = () => env('SUPABASE_ANON_KEY');

/* ------------------------------------------------------------------ */
/*  UI login – fills the /auth form and waits for navigation           */
/* ------------------------------------------------------------------ */

export async function loginViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/auth');
  await page.waitForLoadState('networkidle');

  // Make sure we're on the login form (not signup)
  const heading = page.locator('h2');
  const headingText = await heading.textContent();
  if (headingText?.includes('Inscription')) {
    // Switch to login mode
    await page.getByText('Déjà un compte ? Se connecter').click();
  }

  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.locator('button[type="submit"]').click();

  // Wait until we leave /auth (dashboard, missions, or onboarding)
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), {
    timeout: 15_000,
  });
}

/* ------------------------------------------------------------------ */
/*  UI signup – creates a new account via the /auth form               */
/* ------------------------------------------------------------------ */

export async function signupViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/auth');
  await page.waitForLoadState('networkidle');

  // Switch to signup mode if needed
  const heading = page.locator('h2');
  const headingText = await heading.textContent();
  if (!headingText?.includes('Inscription')) {
    await page.getByText("Pas encore de compte ? S'inscrire").click();
  }

  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.locator('button[type="submit"]').click();
}

/* ------------------------------------------------------------------ */
/*  Supabase REST helper – direct anonymous API call                   */
/* ------------------------------------------------------------------ */

export async function supabaseRestGet(
  table: string,
  queryParams: string = '',
): Promise<Response> {
  const url = `${SUPABASE_URL()}/rest/v1/${table}${queryParams ? `?${queryParams}` : ''}`;
  return fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY(),
      Authorization: `Bearer ${SUPABASE_ANON_KEY()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Wait for the app shell to be ready (post-auth)                     */
/* ------------------------------------------------------------------ */

export async function waitForAppShell(page: Page): Promise<void> {
  // The app always shows at least one of these once authenticated
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/dashboard') ||
      url.pathname.startsWith('/missions') ||
      url.pathname.startsWith('/onboarding') ||
      url.pathname.startsWith('/settings'),
    { timeout: 15_000 },
  );
}
