import "server-only";

import type { PoolClient } from "pg";
import { verifyCloudflareAccessToken, type AccessIdentity } from "./cloudflare-access";
import { getDatabasePool } from "@/server/db/pool";

export class RequestAuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "RequestAuthorizationError";
  }
}

export async function withAuthenticatedActor<T>(
  request: Request,
  operation: (client: PoolClient, identity: AccessIdentity, actorId: string) => Promise<T>,
): Promise<T> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new RequestAuthorizationError("Authentication required.", 401);

  const identity = await verifyCloudflareAccessToken(token);
  if (!identity) throw new RequestAuthorizationError("Invalid authentication.", 401);

  const client = await getDatabasePool().connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const userResult = await client.query<{ user_id: string | null }>(
      "SELECT app_private.resolve_user_id_for_email($1) AS user_id",
      [identity.email],
    );
    const actorId = userResult.rows[0]?.user_id;
    if (!actorId) throw new RequestAuthorizationError("This account has not been provisioned.", 403);

    await client.query("SELECT set_config('app.actor_user_id', $1, true)", [actorId]);
    const result = await operation(client, identity, actorId);
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original request error; release the connection below.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
