/** Passwords shipped with the demo data or on every "most common" list. */
const WEAK = new Set([
  "admin123",
  "editor123",
  "writer123",
  "password",
  "password1",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "abc12345",
]);

export const MIN_PASSWORD_LENGTH = 8;

export function isWeakPassword(password: string) {
  return password.length < MIN_PASSWORD_LENGTH || WEAK.has(password.toLowerCase());
}
