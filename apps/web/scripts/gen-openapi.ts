import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Builds the API contract inventory from the Route Handlers themselves (path, method, operation id, auth,
 * rate limit, required permission/role, idempotency). Request/response body schemas live in the handlers' zod
 * schemas and in docs/05; this file is the machine-checkable index that CI keeps in sync.
 */
const root = path.resolve(import.meta.dirname, "..");
const routesDir = path.join(root, "src/app/api");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
  });
}

interface Meta {
  name: string;
  auth?: boolean | "optional";
  rateLimit?: { rule: { limit: number; windowSeconds: number }; by: string };
  maxBodyBytes?: number;
}

export async function buildContract() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const file of walk(routesDir).sort()) {
    const src = readFileSync(file, "utf8");
    const m = /export \{([^}]+)\} from "@\/server\/api\/handlers\/([^"]+)";/.exec(src);
    if (!m) throw new Error(`unrecognised route file ${file}`);
    const handlerFile = path.join(root, "src/server/api/handlers", `${m[2]}.ts`);
    const mod = (await import(pathToFileURL(handlerFile).href)) as Record<string, { meta?: Meta }>;
    const handlerSrc = readFileSync(handlerFile, "utf8");
    const rel = path.relative(routesDir, path.dirname(file)).split(path.sep).join("/");
    const apiPath = "/api/" + rel.replace(/\[([^\]]+)\]/g, "{$1}");
    for (const part of m[1]!.split(",")) {
      const [handler, method] = part.trim().split(/\s+as\s+/) as [string, string];
      const meta = mod[handler]?.meta;
      if (!meta) throw new Error(`${handler} has no route metadata`);
      // Inspect only this handler's source block for guards.
      const start = handlerSrc.indexOf(`export const ${handler} =`);
      const next = handlerSrc.indexOf("\nexport const ", start + 1);
      const block = handlerSrc.slice(start, next === -1 ? undefined : next);
      const permission = /requirePermission\(ctx\.actor, "([^"]+)"\)/.exec(block)?.[1];
      const roles = /requireRole\(ctx\.actor, ([^)]+)\)/.exec(block)?.[1]?.replace(/["\s]/g, "").split(",");
      const vendor = /requireVendor\(ctx\.actor\)|vendorOf\(ctx\)|vendorScope\(ctx\)/.test(block);
      const idempotent = /requireIdempotencyKey/.test(block);
      const params = [...apiPath.matchAll(/\{([^}]+)\}/g)].map((x) => ({ name: x[1], in: "path", required: true, schema: { type: "string" } }));
      (paths[apiPath] ??= {})[method.toLowerCase()] = {
        operationId: meta.name,
        // [{}] = anonymous allowed; "optional" additionally accepts credentials.
        security: meta.auth === false ? [] : meta.auth === "optional" ? [{}, { bearerAuth: [] }, { cookieAuth: [] }] : [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [...params, ...(idempotent ? [{ $ref: "#/components/parameters/IdempotencyKey" }] : [])],
        ...(permission ? { "x-required-permission": permission } : {}),
        ...(roles ? { "x-required-role": roles } : vendor ? { "x-required-role": ["vendor"] } : {}),
        ...(meta.rateLimit ? { "x-rate-limit": { limit: meta.rateLimit.rule.limit, windowSeconds: meta.rateLimit.rule.windowSeconds, by: meta.rateLimit.by } } : {}),
        responses: {
          "2XX": { description: "Success", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
          default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: { title: "BazarFlow API", version: "1.0.0", description: "Versioned REST API consumed by the web app and the Flutter apps. Private responses are Cache-Control: no-store." },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "bf_at" },
      },
      parameters: { IdempotencyKey: { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 128 } } },
      schemas: {
        Envelope: { type: "object", properties: { data: {}, meta: { type: "object", properties: { requestId: { type: "string" }, nextCursor: { type: ["string", "null"] }, hasMore: { type: "boolean" } } } } },
        ErrorEnvelope: {
          type: "object",
          properties: {
            error: {
              type: "object", required: ["code", "message", "requestId"],
              properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" }, details: { type: "array", items: { type: "object", properties: { field: { type: "string" }, code: { type: "string" } } } } },
            },
          },
        },
      },
    },
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const out = path.resolve(root, "../../packages/contracts/openapi.json");
  writeFileSync(out, JSON.stringify(await buildContract(), null, 2) + "\n");
  console.log(`wrote ${out}`);
}
