import { describe, expect, it } from 'vitest';
import { authDestination } from './authRedirect.ts';

describe('возврат после входа', () => {
  it('сохраняет страницу площадки, параметры и выбранный раздел', () => {
    const path = '/app/venues/da8b007e-c29d-4896-8d8d-efca6976ec62?capture=1#plan';
    expect(authDestination(path)).toBe(path);
    expect(authDestination('/app')).toBe('/app');
  });

  it.each([null, '/app/login', '/app/login?next=/app/login', '/application', '//example.com/app', 'https://example.com/app', '/app/../app/login', '/app/venues/unknown', '/app\\login'])(
    'отклоняет циклический, чужой или неизвестный адрес %s', (path) => {
      expect(authDestination(path)).toBe('/app');
    },
  );
});
