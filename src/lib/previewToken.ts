const PREVIEW_ACCESS_TOKEN_STORAGE_KEY = 'lovable-preview-access-token';
const PREVIEW_ACCESS_TOKEN_PARAM = '__lovable_token';

export const persistPreviewAccessToken = (search = ''): string | null => {
  if (typeof window === 'undefined') return null;

  const token = new URLSearchParams(search).get(PREVIEW_ACCESS_TOKEN_PARAM);
  if (token) {
    window.sessionStorage.setItem(PREVIEW_ACCESS_TOKEN_STORAGE_KEY, token);
  }

  return token;
};

export const getPreviewAccessToken = (): string | null => {
  if (typeof window === 'undefined') return null;

  return window.sessionStorage.getItem(PREVIEW_ACCESS_TOKEN_STORAGE_KEY);
};

export const withPreviewAccessToken = (pathname: string, search = '', hash = '') => {
  const token = getPreviewAccessToken();
  if (!token) {
    return { pathname, search, hash };
  }

  const params = new URLSearchParams(search);
  params.set(PREVIEW_ACCESS_TOKEN_PARAM, token);

  return {
    pathname,
    search: `?${params.toString()}`,
    hash,
  };
};

export const reloadWithPreviewAccessToken = () => {
  if (typeof window === 'undefined') return;

  const nextLocation = withPreviewAccessToken(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  );
  const nextHref = `${window.location.origin}${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`;

  if (nextHref !== window.location.href) {
    window.location.replace(nextHref);
    return;
  }

  window.location.reload();
};