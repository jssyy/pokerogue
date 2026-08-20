import type { IncomingMessage, ServerResponse } from "node:http";

/** Everything a handler needs about one request, already parsed. */
export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  /** Path without the query string. */
  path: string;
  query: URLSearchParams;
  /** The value of the `Authorization` header, which is where the game client puts its token. */
  token: string | undefined;
  /** Raw request body; `body()` and `form()` read from this. */
  raw: string;
}

export type Handler = (ctx: Ctx) => void | Promise<void>;

/** Body as JSON, or `null` when it is absent or malformed. */
export function body<T>(ctx: Ctx): T | null {
  try {
    return ctx.raw ? (JSON.parse(ctx.raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Body as form fields.
 *
 * The account endpoints are posted as `application/x-www-form-urlencoded` by the game client, so
 * this shape has to be supported even though everything else is JSON.
 */
export function form(ctx: Ctx): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(ctx.raw));
}

export function json(ctx: Ctx, data: unknown, status = 200): void {
  const payload = JSON.stringify(data);
  ctx.res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  ctx.res.end(payload);
}

export function text(ctx: Ctx, message: string, status = 200): void {
  ctx.res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  ctx.res.end(message);
}

/**
 * An error the client will show.
 *
 * The game client renders the response body verbatim for a failed login, so these strings are
 * user-facing and written accordingly.
 */
export function fail(ctx: Ctx, message: string, status = 400): void {
  text(ctx, message, status);
}

/**
 * Reads the whole body.
 *
 * @param limit - Bytes after which the request is refused; a save is large but not unbounded, and
 *   without a cap one bad client could exhaust the memory of a small home machine
 */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Allows the browser to call this service from wherever the game is served.
 *
 * The game and this service are different origins - the game is static files on some port, this is
 * an API on another - so without these headers every request fails before it is sent. The origin is
 * echoed back rather than fixed, because on a home network the game gets opened by IP, by hostname
 * and by `localhost`, and all three have to work.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, PKR-Client-Version");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/** A tiny exact-match router; this service has fourteen routes and needs nothing cleverer. */
export class Router {
  private readonly routes = new Map<string, Handler>();

  add(method: string, path: string, handler: Handler): this {
    this.routes.set(`${method} ${path}`, handler);
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: Handler): this {
    return this.add("POST", path, handler);
  }

  find(method: string, path: string): Handler | undefined {
    return this.routes.get(`${method} ${path}`);
  }
}
