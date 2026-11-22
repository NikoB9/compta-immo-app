import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import {
  RequestAuthorizationError,
  withAuthenticatedActor,
} from "@/server/auth/authenticated-actor";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await withAuthenticatedActor(request, async (client, identity) => {
      const workspaces = await client.query<{
        workspace_id: string;
        workspace_name: string;
        role: "owner" | "administrator";
      }>(
        `SELECT w.id AS workspace_id, w.name AS workspace_name, m.role
         FROM app.workspace_membership m
         JOIN app.workspace w ON w.id = m.workspace_id
         WHERE m.user_id = app_private.actor_user_id()
           AND m.role IN ('owner', 'administrator')
         ORDER BY w.created_at, w.id`,
      );

      const projects = await client.query<{
        project_id: string;
        project_name: string;
        status: "active" | "closed" | "archived";
      }>(
        `SELECT p.id AS project_id, p.name AS project_name, p.status
         FROM app.construction_project p
         WHERE app_private.owns_workspace(p.workspace_id)
            OR app_private.is_project_member(p.id)
         ORDER BY p.created_at, p.id`,
      );

      const buildingRows = await client.query<{
        workspace_id: string;
        building_id: string;
        building_label: string;
        address_line1: string;
        postal_code: string;
        locality: string;
        unit_id: string | null;
        unit_ref: string | null;
        unit_description: string | null;
      }>(
        `SELECT b.workspace_id, b.id AS building_id, b.label AS building_label,
                b.address_line1, b.postal_code, b.locality,
                u.id AS unit_id, u.unit_ref, u.description AS unit_description
         FROM app.building_address b
         LEFT JOIN app.unit u ON u.workspace_id = b.workspace_id AND u.building_id = b.id
         WHERE app_private.owns_workspace(b.workspace_id)
         ORDER BY b.workspace_id, b.label, u.unit_ref`,
      );

      const buildingsById = new Map<string, {
        workspace_id: string;
        building_id: string;
        building_label: string;
        address_line1: string;
        postal_code: string;
        locality: string;
        units: Array<{ id: string; reference: string; description: string | null }>;
      }>();
      for (const row of buildingRows.rows) {
        let building = buildingsById.get(row.building_id);
        if (!building) {
          building = {
            workspace_id: row.workspace_id,
            building_id: row.building_id,
            building_label: row.building_label,
            address_line1: row.address_line1,
            postal_code: row.postal_code,
            locality: row.locality,
            units: [],
          };
          buildingsById.set(row.building_id, building);
        }
        if (row.unit_id && row.unit_ref) {
          building.units.push({
            id: row.unit_id,
            reference: row.unit_ref,
            description: row.unit_description,
          });
        }
      }

      return {
        email: identity.email,
        workspaces: workspaces.rows,
        projects: projects.rows,
        buildings: [...buildingsById.values()],
      };
    });

    return Response.json(session, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof RequestAuthorizationError) {
      return Response.json({ error: error.message }, {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (error instanceof AccessConfigurationError) {
      return Response.json({ error: "Authentication is not configured." }, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    console.error("Authenticated session lookup failed.");
    return Response.json({ error: "The account service is unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
