/**
 * Content script LinkedIn — injecté sur linkedin.com/in/* et /search/* et /recruiter/*.
 *
 * Fonctionnalités :
 *  1. Bouton flottant "+ Konekt" en bas à droite sur les pages profil pour
 *     ajouter rapidement le profil au pipeline
 *  2. Badge overlay sur chaque profil dans une page de search/recruiter
 *     indiquant son statut Konekt (déjà en pipeline, score, stage…)
 *
 * Communication : envoie des messages au service worker (sw.ts) qui fait
 * les appels API authentifiés.
 */

import type { Message, MessageResponse } from '../background/sw';

interface PipelineStatusEntry {
  status: string;
  pipeline_stage: string | null;
  score: number | null;
  recommendation: string | null;
  mission_title: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendMessage(msg: Message): Promise<MessageResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || 'SW unavailable' });
        return;
      }
      resolve(response);
    });
  });
}

function isProfilePage(): boolean {
  return /\/in\/[^/]+\/?(?:\?|$)/.test(location.pathname);
}

function isListingPage(): boolean {
  return location.pathname.includes('/search/') || location.pathname.includes('/recruiter/');
}

function getCurrentProfileSlug(): string | null {
  const m = location.pathname.match(/\/in\/([^/?#]+)/);
  return m ? m[1] : null;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ─── 1. Bouton flottant "+ Konekt" sur page profil ───────────────────────────

function injectFloatingButton() {
  if (!isProfilePage()) return;
  if (document.getElementById('konekt-fab')) return;

  const button = document.createElement('button');
  button.id = 'konekt-fab';
  button.className = 'konekt-fab';
  button.innerHTML = `
    <span class="konekt-fab-icon">+</span>
    <span class="konekt-fab-label">Konekt</span>
  `;
  button.title = 'Ajouter au pipeline Konekt';
  button.setAttribute('aria-label', 'Ajouter ce profil au pipeline Konekt');

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.classList.add('konekt-fab--loading');

    const profileUrl = location.href.split('?')[0];
    const name = (document.querySelector('h1')?.textContent || '').trim();
    const headline = (document.querySelector('.text-body-medium')?.textContent || '').trim();

    const response = await sendMessage({
      type: 'QUICK_ADD_CANDIDATE',
      payload: {
        linkedin_url: profileUrl,
        name: name || undefined,
        headline: headline || undefined,
      },
    });

    button.disabled = false;
    button.classList.remove('konekt-fab--loading');

    if (response.ok) {
      const data = response.data as any;
      button.classList.add('konekt-fab--success');
      button.innerHTML = `<span class="konekt-fab-icon">✓</span><span class="konekt-fab-label">${data?.already_in_pipeline ? 'Déjà ajouté' : 'Ajouté !'}</span>`;
      setTimeout(() => {
        button.classList.remove('konekt-fab--success');
        button.innerHTML = `<span class="konekt-fab-icon">+</span><span class="konekt-fab-label">Konekt</span>`;
      }, 3000);
    } else {
      button.classList.add('konekt-fab--error');
      button.innerHTML = `<span class="konekt-fab-icon">✗</span><span class="konekt-fab-label">Erreur</span>`;
      console.error('[Konekt] quick-add failed:', response.error);
      setTimeout(() => {
        button.classList.remove('konekt-fab--error');
        button.innerHTML = `<span class="konekt-fab-icon">+</span><span class="konekt-fab-label">Konekt</span>`;
      }, 3000);
    }
  });

  document.body.appendChild(button);
}

// ─── 2. Pipeline status overlay sur listings ─────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  discovered: { label: 'En pool', className: 'konekt-badge--discovered' },
  scored: { label: 'Scoré', className: 'konekt-badge--scored' },
  messaged: { label: 'Contacté', className: 'konekt-badge--messaged' },
  replied: { label: 'A répondu', className: 'konekt-badge--replied' },
  shortlisted: { label: 'Pressenti', className: 'konekt-badge--shortlisted' },
  dismissed: { label: 'Écarté', className: 'konekt-badge--dismissed' },
};

/**
 * Trouve les liens vers des profils LinkedIn dans la page courante.
 * Retourne une map element → URL nettoyée pour batch query.
 */
function collectProfileLinks(): Map<HTMLElement, string> {
  const result = new Map<HTMLElement, string>();
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]');

  for (const link of links) {
    const url = (link.href || '').split('?')[0];
    if (!url || !url.includes('/in/')) continue;
    if (link.dataset.konektProcessed === '1') continue;

    // Container du profil = le plus proche article ou li parent (varie selon vue)
    const container = link.closest('article, li, div[data-test-id], div[data-chameleon-result-urn]') as HTMLElement | null;
    if (container) {
      result.set(container, url);
    }
  }

  return result;
}

function badgeFor(status: PipelineStatusEntry): HTMLElement {
  const meta = STATUS_LABELS[status.status] || { label: status.status, className: 'konekt-badge--unknown' };
  const badge = document.createElement('div');
  badge.className = `konekt-badge ${meta.className}`;

  let parts = `<span class="konekt-badge-dot"></span><span>K · ${meta.label}</span>`;
  if (status.score != null && status.score > 0) parts += ` <span class="konekt-badge-score">${status.score}%</span>`;
  if (status.mission_title) parts += ` <span class="konekt-badge-mission" title="${status.mission_title}">· ${status.mission_title.slice(0, 20)}${status.mission_title.length > 20 ? '…' : ''}</span>`;

  badge.innerHTML = parts;
  badge.title = `Konekt — ${meta.label}${status.pipeline_stage ? ' · stage: ' + status.pipeline_stage : ''}${status.mission_title ? ' · mission: ' + status.mission_title : ''}`;
  return badge;
}

async function refreshPipelineOverlay() {
  if (!isListingPage()) return;

  // Read user pref (overlay enabled?)
  const { konekt_pipeline_overlay_enabled } = await chrome.storage.local.get('konekt_pipeline_overlay_enabled');
  if (konekt_pipeline_overlay_enabled === false) return;

  const links = collectProfileLinks();
  if (links.size === 0) return;

  const urls = Array.from(new Set(links.values()));
  const response = await sendMessage({ type: 'GET_PIPELINE_STATUS', urls });
  if (!response.ok) return;

  const statuses = (response.data as any)?.statuses as Record<string, PipelineStatusEntry> || {};

  for (const [container, url] of links) {
    container.dataset.konektProcessed = '1';
    const status = statuses[url];
    if (!status) continue;
    if (container.querySelector('.konekt-badge')) continue;

    const badge = badgeFor(status);
    badge.dataset.konektUrl = url;
    container.style.position = container.style.position || 'relative';
    container.appendChild(badge);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const debouncedRefresh = debounce(() => {
  injectFloatingButton();
  refreshPipelineOverlay();
}, 300);

// Initial run
debouncedRefresh();

// LinkedIn est une SPA → on observe les mutations DOM pour re-injecter
const observer = new MutationObserver(() => {
  debouncedRefresh();
});
observer.observe(document.body, { childList: true, subtree: true });

// Re-run sur navigation history (SPA route changes)
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    // Reset processed flags pour re-scanner sur la nouvelle page
    document.querySelectorAll('[data-konekt-processed]').forEach((el) => {
      delete (el as HTMLElement).dataset.konektProcessed;
    });
    document.querySelectorAll('.konekt-badge').forEach((el) => el.remove());
    debouncedRefresh();
  }
}, 1000);
