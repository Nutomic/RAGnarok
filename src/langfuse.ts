import { Langfuse } from "langfuse";
import { Pool } from "pg";

// Mistral API pricing, EUR per 1M tokens (docs.mistral.ai/inference/pricing,
// checked 2026-10). Stored per token below because Langfuse multiplies price x
// tokens directly.
const MISTRAL_PRICES_PER_M: Record<string, { input: number; output: number }> = {
  "ministral-14b-latest": { input: 0.18, output: 0.18 },
  "mistral-small-latest": { input: 0.12, output: 0.5 },
};

export function costFor(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = model ? MISTRAL_PRICES_PER_M[model] : undefined;
  return p ? (p.input * inputTokens + p.output * outputTokens) / 1e6 : null;
}

interface LangfuseKeys {
  publicKey: string;
  secretKey: string;
}

async function bootstrap(): Promise<LangfuseKeys> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const langfuseDbUrl = process.env.LANGFUSE_DATABASE_URL;
  if (!publicKey || !secretKey || !langfuseDbUrl) {
    throw new Error("LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY or LANGFUSE_DATABASE_URL not set");
  }

  const pool = new Pool({ connectionString: langfuseDbUrl, max: 2 });
  try {
    // Wait for langfuse init
    let projectId: string | null = null;
    for (let i = 0; ; i++) {
      const found = await pool.query<{ project_id: string }>(
        "SELECT project_id FROM api_keys WHERE public_key = $1",
        [publicKey],
      );
      if (found.rows.length > 0) {
        projectId = found.rows[0].project_id;
        break;
      }
      if (i >= 45) throw new Error("Langfuse init key not provisioned after 90s");
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Then write pricing data to langfuse db
    for (const name of Object.keys(MISTRAL_PRICES_PER_M)) {
      const p = MISTRAL_PRICES_PER_M[name];
      await pool.query(
        `INSERT INTO models (id, project_id, model_name, match_pattern, input_price, output_price, unit)
         VALUES ($1, $2, $3, $4, $5, $6, 'TOKENS')
         ON CONFLICT (id) DO UPDATE SET input_price = EXCLUDED.input_price, output_price = EXCLUDED.output_price`,
        [`m-${name}`, projectId, name, `(?i)^(${name})$`, p.input / 1e6, p.output / 1e6],
      );
    }
    return { publicKey, secretKey };
  } finally {
    await pool.end();
  }
}

let bootstrapPromise: Promise<LangfuseKeys> | null = null;
let keys: LangfuseKeys | null = null;

async function isReady(): Promise<boolean> {
  bootstrapPromise ??= bootstrap();
  try {
    keys = await bootstrapPromise;
    console.log("[langfuse] ready");
  } catch (err) {
    console.error("[langfuse] setup failed, tracing disabled:", err);
  }
  return keys !== null;
}

// compose-internal service
export const LANGFUSE_HOST = "http://langfuse:3000";

export async function getLangfuse(): Promise<Langfuse | null> {
  if (!(await isReady()) || !keys) return null;
  return new Langfuse({
    publicKey: keys.publicKey,
    secretKey: keys.secretKey,
    baseUrl: LANGFUSE_HOST,
  });
}

// Auth headers for API
export async function getLangfuseCredentials(): Promise<Record<string, string> | null> {
  if (!(await isReady()) || !keys) return null;
  const auth = Buffer.from(`${keys.publicKey}:${keys.secretKey}`).toString("base64");
  return { Authorization: `Basic ${auth}` };
}
