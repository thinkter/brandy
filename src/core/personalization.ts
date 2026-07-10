/**
 * Guards a cache-eligible route's request against accidental personalization: a `prerender`
 * or `revalidate` route's rendered output (including ancestor layouts) is shared across every
 * visitor, so a loader that reads per-user data (cookies, auth headers) would leak the first
 * visitor's response to everyone else. This module wraps the incoming `Request` so any attempt
 * to read that data throws loudly instead of silently caching a personalized response.
 */

/** Header names that carry per-user identity/auth state and must never influence a cached render. */
const SENSITIVE_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

/**
 * Thrown when a loader (or layout loader) for a cache-eligible route reads a sensitive header
 * (cookie/authorization/proxy-authorization) or iterates all headers, either of which would let
 * per-user data leak into a response cached for every visitor.
 */
export class PersonalizedRequestError extends Error {
  constructor(routePattern: string, detail: string) {
    super(
      `[brandy] Route "${routePattern}" reads ${detail}, but it is cached via \`prerender\`/\`revalidate\`. ` +
      `A cached route's output is served to every visitor, so per-user data must never influence it. ` +
      `Fix: remove \`prerender\`/\`revalidate\` from this route, or move the per-user read out of its ` +
      `loader (and its ancestor layouts' loaders) into a client-side or non-cached code path.`,
    );
    this.name = "PersonalizedRequestError";
  }
}

function isSensitive(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

function blocked(routePattern: string, name: string): never {
  throw new PersonalizedRequestError(routePattern, `the "${name}" header`);
}

function blockedIteration(routePattern: string, via: string): never {
  throw new PersonalizedRequestError(routePattern, `all request headers (via \`${via}\`), which would expose sensitive headers`);
}

function guardHeaders(headers: Headers, routePattern: string): Headers {
  return new Proxy(headers, {
    // Native Headers/Request methods and getters require `this` to be the real, un-proxied
    // instance — binding to `receiver` (the Proxy) throws "can only be used on instances of
    // Headers/Request". So every passthrough below binds to `target`, never `receiver`.
    get(target, prop) {
      if (prop === "get" || prop === "has") {
        return (name: string) => {
          if (isSensitive(name)) blocked(routePattern, name.toLowerCase());
          return (target[prop] as (name: string) => unknown).call(target, name);
        };
      }
      if (prop === "getSetCookie") {
        return () => blockedIteration(routePattern, "getSetCookie");
      }
      if (prop === "entries" || prop === "keys" || prop === "values" || prop === "forEach" || prop === Symbol.iterator) {
        return () => blockedIteration(routePattern, typeof prop === "symbol" ? "Symbol.iterator" : prop);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Wraps `request` so per-user data (cookies, auth headers) cannot be read while rendering a
 * cache-eligible route (`route.page.cache` set) — including its ancestor layouts, since their
 * output is baked into the same cached entry. Applies regardless of whether the cache is
 * currently active (dev mode, a forced-fresh render, or the build-time warm-up all still route
 * through this guard) — the goal is to catch the mistake before it can ever reach production
 * traffic, not merely to protect the cache once it is populated.
 *
 * Non-sensitive header access (e.g. `accept-language`) and everything else on `Request`
 * (method, url, body, etc.) pass through unchanged.
 */
export function guardPersonalizedRequest(request: Request, routePattern: string): Request {
  return new Proxy(request, {
    // See guardHeaders: native getters (method, url, ...) require `this` to be the real
    // Request instance, so passthrough binds to `target`, never `receiver` (the Proxy).
    get(target, prop) {
      if (prop === "headers") return guardHeaders(target.headers, routePattern);
      // A clone must stay guarded — helper libraries routinely clone a request before reading
      // it, and an unguarded clone would be a silent bypass.
      if (prop === "clone") return () => guardPersonalizedRequest(target.clone(), routePattern);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
