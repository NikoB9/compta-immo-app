import { AccessConfigurationError, verifyCloudflareAccessToken } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError } from "@/server/auth/authenticated-actor";
import { getDatabasePool } from "@/server/db/pool";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8 * 1024;

export async function GET(request: Request) {
  try {
    const identity = await verifiedIdentity(request);
    if (!isConfiguredOwner(identity.email)) return json({ available: false });

    const result = await getDatabasePool().query<{ available: boolean }>(
      "SELECT app_private.owner_setup_available() AS available",
    );
    return json({ available: result.rows[0]?.available === true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await verifiedIdentity(request);
    if (!isConfiguredOwner(identity.email)) return json({ error: "Configuration initiale indisponible." }, 404);
    assertSameOriginJson(request);

    const body = await readJson(request);
    const values = validateSetup(body);
    const result = await getDatabasePool().query<{ owner_id: string; workspace_id: string }>(
      `SELECT owner_id, workspace_id
       FROM app_private.bootstrap_first_owner($1, $2, $3)`,
      [identity.email, ...values],
    );
    return json({ created: true, workspaceId: result.rows[0]?.workspace_id }, 201);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P0002") {
      return json({ error: "La configuration initiale a déjà été effectuée." }, 409);
    }
    return errorResponse(error);
  }
}

type SetupValues = [string, string];

function validateSetup(body: Record<string, unknown>): SetupValues {
  const displayName = requiredText(body.displayName, 160);
  const workspaceName = requiredText(body.workspaceName, 160);
  return [displayName, workspaceName];
}

function requiredText(value: unknown, maxLength: number) {
  if (typeof value !== "string") throw new SetupInputError("Un des champs est invalide.");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes("\0")) {
    throw new SetupInputError("Vérifiez les champs obligatoires et leur longueur.");
  }
  return normalized;
}

async function verifiedIdentity(request: Request) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new RequestAuthorizationError("Authentification requise.", 401);
  const identity = await verifyCloudflareAccessToken(token);
  if (!identity) throw new RequestAuthorizationError("Authentification invalide.", 401);
  return identity;
}

function assertSameOriginJson(request: Request) {
  const appBaseUrl = process.env.APP_BASE_URL;
  let configuredOrigin: string;
  try {
    if (!appBaseUrl) throw new Error();
    configuredOrigin = new URL(appBaseUrl).origin;
  } catch {
    throw new AccessConfigurationError("Application origin is not configured.");
  }
  if (request.headers.get("origin") !== configuredOrigin) {
    throw new RequestAuthorizationError("Origine de requête non autorisée.", 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new SetupInputError("Le contenu de la requête doit être en JSON.", 400);
  }
}

function isConfiguredOwner(email: string) {
  const configuredEmail = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  if (!configuredEmail || !configuredEmail.includes("@")) {
    throw new AccessConfigurationError("Initial owner email is not configured.");
  }
  return email === configuredEmail;
}

async function readJson(request: Request) {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new SetupInputError("Corps JSON invalide.", 400);
  }
}

class SetupInputError extends Error {
  constructor(message: string, readonly status: 400 | 422 = 422) { super(message); }
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof SetupInputError) return json({ error: error.message }, error.status);
  if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
  console.error("Initial owner setup request failed.");
  return json({ error: "La configuration initiale est indisponible." }, 503);
}
