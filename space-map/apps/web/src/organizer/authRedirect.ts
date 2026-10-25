/** После входа разрешены только известные страницы кабинета; login не может ссылаться сам на себя. */
export function authDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app';
  try {
    const url = new URL(value, 'https://space-map.local');
    if (url.origin !== 'https://space-map.local') return '/app';
    const path = url.pathname;
    if (path !== '/app' && path !== '/app/' && path !== '/app/editor' && !/^\/app\/venues\/[0-9a-f-]{36}(?:\/stats)?$/i.test(path)) return '/app';
    return `${path}${url.search}${url.hash}`;
  } catch {
    return '/app';
  }
}
