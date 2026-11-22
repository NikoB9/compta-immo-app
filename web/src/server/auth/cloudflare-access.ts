import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type AccessIdentity = {
  email: string;
  subject: string;
};

export class AccessConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessConfigurationError";
  }
}

function getAccessConfiguration() {
  const rawTeamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
  const audience = process.env.CLOUDFLARE_ACCESS_AUD;

  if (!rawTeamDomain || !audience || /\s/.test(audience)) {
    throw new AccessConfigurationError("Cloudflare Access is not configured.");
  }

  let teamUrl: URL;
  try {
    teamUrl = new URL(rawTeamDomain);
  } catch {
    throw new AccessConfigurationError("Cloudflare Access team domain is invalid.");
  }

  if (
    teamUrl.protocol !== "https:" ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamUrl.hostname) ||
    (teamUrl.pathname !== "/" && teamUrl.pathname !== "") ||
    teamUrl.search ||
    teamUrl.hash ||
    teamUrl.username ||
    teamUrl.password
  ) {
    throw new AccessConfigurationError("Cloudflare Access team domain is invalid.");
  }

  return { issuer: teamUrl.origin, audience };
}

let cachedIssuer: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(issuer: string) {
  if (cachedIssuer !== issuer || !cachedJwks) {
    cachedIssuer = issuer;
    cachedJwks = createRemoteJWKSet(
      new URL(`${issuer}/cdn-cgi/access/certs`),
      { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 300_000 },
    );
  }

  return cachedJwks;
}

export async function verifyCloudflareAccessToken(token: string): Promise<AccessIdentity | null> {
  if (token.length < 16 || token.length > 8_192) return null;

  const { issuer, audience } = getAccessConfiguration();

  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["iss", "aud", "exp", "iat"],
    });

    return parseIdentity(payload);
  } catch {
    return null;
  }
}

function parseIdentity(payload: JWTPayload): AccessIdentity | null {
  if (payload.type !== "app") return null;
  if (typeof payload.email !== "string" || typeof payload.sub !== "string") return null;

  const email = payload.email.trim().toLowerCase();
  const subject = payload.sub.trim();

  if (!email.includes("@") || !subject) return null;
  return { email, subject };
}
