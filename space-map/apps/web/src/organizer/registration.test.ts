import { describe, expect, it } from 'vitest';
import { registrationError } from './registration.ts';

describe('регистрация', () => {
  it('принимает заполненные поля и совпадающие пароли', () => {
    expect(registrationError(' Иван ', ' ivan@example.com ', 'password-2026', 'password-2026')).toBeNull();
  });

  it.each([
    ['  ', 'ivan@example.com', 'password-2026', 'password-2026', 'Укажите имя.'],
    ['Иван', 'не почта', 'password-2026', 'password-2026', 'Укажите корректный email.'],
    ['Иван', 'ivan@example.com', 'short', 'short', 'Пароль должен содержать не меньше 8 символов.'],
    ['Иван', 'ivan@example.com', 'password-2026', 'другой пароль', 'Пароли не совпадают.'],
  ])('показывает понятную ошибку до отправки', (name, email, password, confirmation, message) => {
    expect(registrationError(name, email, password, confirmation)).toBe(message);
  });
});
