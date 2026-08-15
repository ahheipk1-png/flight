/** Row shapes and the small set of queries the routes share. Kept in one
 * place so the SQLite-vs-JS type conversions (is_admin INTEGER <-> boolean,
 * NULL <-> null) happen exactly once. */

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  status: "pending" | "approved" | "denied" | "disabled";
  is_admin: number;
  serpapi_api_key_encrypted: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Trim + lowercase, applied before every insert and lookup. Matches the
 * Python reference's normalize_username() -- deliberately application-level
 * rather than a DB collation so the behavior is identical and explicit. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE username = ?").bind(normalizeUsername(username)).first<UserRow>();
}

export async function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export function isAdmin(user: UserRow): boolean {
  return user.is_admin === 1;
}

export function hasApiKey(user: UserRow): boolean {
  return user.serpapi_api_key_encrypted !== null && user.serpapi_api_key_encrypted !== "";
}
