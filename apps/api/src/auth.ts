import { timingSafeEqual, randomBytes } from "node:crypto";

export interface OperatorSession {
  token: string;
  username: string;
  expiresAt: string;
}

interface StoredOperatorSession extends OperatorSession {
  expiresAtMs: number;
}

export interface OperatorAuthServiceOptions {
  username: string;
  password: string;
  sessionTtlMs?: number;
}

export interface OperatorAuthConfigDiagnostics {
  configured: boolean;
  missingConfigKeys: Array<"OPERATOR_USERNAME" | "OPERATOR_PASSWORD">;
}

const REQUIRED_OPERATOR_AUTH_CONFIG_KEYS = [
  "OPERATOR_USERNAME",
  "OPERATOR_PASSWORD"
] as const;

export class OperatorAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorAuthConfigError";
  }
}

export class OperatorAuthService {
  private readonly username: string;
  private readonly password: string;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, StoredOperatorSession>();

  constructor(options: OperatorAuthServiceOptions) {
    this.username = options.username;
    this.password = options.password;
    this.sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000;
  }

  login(username: string, password: string): OperatorSession | null {
    if (!this.credentialsMatch(username, password)) {
      return null;
    }

    const expiresAtMs = Date.now() + this.sessionTtlMs;
    const session: StoredOperatorSession = {
      token: randomBytes(24).toString("hex"),
      username: this.username,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs
    };

    this.sessions.set(session.token, session);
    return this.toPublicSession(session);
  }

  getSession(token: string): OperatorSession | null {
    this.pruneExpiredSessions();
    const session = this.sessions.get(token);

    if (!session) {
      return null;
    }

    return this.toPublicSession(session);
  }

  logout(token: string): boolean {
    return this.sessions.delete(token);
  }

  private credentialsMatch(username: string, password: string): boolean {
    return this.safeEqual(username, this.username) && this.safeEqual(password, this.password);
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private pruneExpiredSessions(): void {
    const now = Date.now();

    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAtMs <= now) {
        this.sessions.delete(token);
      }
    }
  }

  private toPublicSession(session: StoredOperatorSession): OperatorSession {
    return {
      token: session.token,
      username: session.username,
      expiresAt: session.expiresAt
    };
  }
}

export function createOperatorAuthServiceFromEnv(): OperatorAuthService {
  const username = process.env.OPERATOR_USERNAME?.trim() ?? "";
  const password = process.env.OPERATOR_PASSWORD ?? "";
  const { missingConfigKeys } = getOperatorAuthConfigDiagnosticsFromEnv();

  if (missingConfigKeys.length > 0) {
    throw new OperatorAuthConfigError(
      `Missing required operator auth config: ${missingConfigKeys.join(", ")}`
    );
  }

  return new OperatorAuthService({
    username,
    password,
    sessionTtlMs: Number.parseInt(process.env.OPERATOR_SESSION_TTL_MS ?? "", 10) || undefined
  });
}

export function getOperatorAuthConfigDiagnosticsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OperatorAuthConfigDiagnostics {
  const missingConfigKeys = REQUIRED_OPERATOR_AUTH_CONFIG_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  return {
    configured: missingConfigKeys.length === 0,
    missingConfigKeys: [...missingConfigKeys]
  };
}

export function getBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
