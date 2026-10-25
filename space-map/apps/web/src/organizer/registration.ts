/** Проверка перед отправкой формы. Сервер повторно проверяет данные независимо от браузера. */
export function registrationError(name: string, email: string, password: string, confirmation: string): string | null {
  if (!name.trim()) return 'Укажите имя.';
  if (name.trim().length > 100) return 'Имя должно быть не длиннее 100 символов.';
  if (email.trim().length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Укажите корректный email.';
  if (password.length < 8) return 'Пароль должен содержать не меньше 8 символов.';
  if (password.length > 200) return 'Пароль должен быть не длиннее 200 символов.';
  if (password !== confirmation) return 'Пароли не совпадают.';
  return null;
}
