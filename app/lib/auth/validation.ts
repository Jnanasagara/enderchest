const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FALLBACK_PASSWORD_MIN = 12;
const FALLBACK_PASSWORD_MAX = 128;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  return EMAIL_REGEX.test(email);
}

export function validatePassword(password: string): string | null {
  const minLength = Number(process.env.PASSWORD_MIN_LENGTH ?? FALLBACK_PASSWORD_MIN);
  const maxLength = Number(process.env.PASSWORD_MAX_LENGTH ?? FALLBACK_PASSWORD_MAX);

  const min = Number.isFinite(minLength) ? minLength : FALLBACK_PASSWORD_MIN;
  const max = Number.isFinite(maxLength) ? maxLength : FALLBACK_PASSWORD_MAX;

  if (password.length < min) {
    return `Password must be at least ${min} characters.`;
  }

  if (password.length > max) {
    return `Password must be at most ${max} characters.`;
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  const strengthCount = [hasLower, hasUpper, hasNumber, hasSymbol].filter(Boolean)
    .length;

  if (strengthCount < 3) {
    return "Password must include at least three of: lowercase, uppercase, number, symbol.";
  }

  return null;
}
