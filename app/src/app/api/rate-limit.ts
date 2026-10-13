import { RateLimiterMemory } from "rate-limiter-flexible";

// Demo app without auth: the IP is the only rate limiting key available.
// Fail loudly instead of falling back to a shared key that would rate limit
// everyone as one client (or none at all).
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) throw new Error("rate-limit: missing x-forwarded-for header");
  const entries = forwarded.split(",");
  // nginx appends the real ip to a possibly  user-supplied header, so the
  // last value is the only trusted one. The reverse proxy must append, not
  // replace: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`.
  const ip = entries[0]?.trim();
  if (!ip) throw new Error("rate-limit: empty x-forwarded-for header");
  return ip;
}

// Chat: every hit costs an LLM call. Reads (search/documents/stats): cheap
// DB or Langfuse work, higher budget.
const chatLimiter = new RateLimiterMemory({ points: 10, duration: 60 });
const readLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

export async function limitChat(req: Request): Promise<Response | null> {
  return limit(chatLimiter, req);
}

export async function limitReads(req: Request): Promise<Response | null> {
  return limit(readLimiter, req);
}

async function limit(limiter: RateLimiterMemory, req: Request): Promise<Response | null> {
  let ip: string;
  try {
    ip = clientIp(req);
  } catch (err) {
    // Missing/empty header is a proxy misconfiguration
    console.error(err);
    return Response.json({ error: err }, { status: 500 });
  }
  try {
    await limiter.consume(ip);
    return null;
  } catch (rejection) {
    const retryAfter = Math.ceil((rejection as { msBeforeNext: number }).msBeforeNext / 1000);
    return Response.json(
      { error: "Zu viele Anfragen. Bitte später erneut versuchen." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
}
