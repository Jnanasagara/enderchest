import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

// Hash a plain text password for storage.

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Verify a plain text password against a stored hash.
 
export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
