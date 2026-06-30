# TODO

## Should fix soon

- [ ] Avoid mutating shared action-handler function objects in `loadActions` ([`src/core/walker.ts`](/home/ashman/Documents/opensource/brandy/src/core/walker.ts)).
  Today `loadActions` patches `handler.toString` directly on the live function object returned from the module cache. With concurrent manifest builds, that means shared global state is being mutated across imports. At minimum, document the fragility. Prefer a non-mutating identity mechanism such as a `WeakMap<Function, string>` from handler to action path.

- [ ] Replace HTML shell injection string replacement with a structural approach in [`src/core/render.ts`](/home/ashman/Documents/opensource/brandy/src/core/render.ts) and [`src/server.ts`](/home/ashman/Documents/opensource/brandy/src/server.ts).
  `injectMetadata`, `injectClientRuntime`, `injectStylesheet`, and `injectDevRuntime` currently inject by replacing literal `</head>` or `</body>`. If the root layout contains those substrings inside inline scripts, JSON, or attributes, injection can silently land in the wrong place.

- [ ] Keep `REFRESH_BOUNDARY_HEADER` internal-only and document the constraint in [`src/server.ts`](/home/ashman/Documents/opensource/brandy/src/server.ts).
  This is currently a dev-HMR escape hatch that bypasses the diff engine's computed refresh boundary. That is acceptable as an internal mechanism, but it should not drift into a public or semi-public targeting API, especially for future features like intercepting routes.

- [ ] Add a production-quality dev safeguard for repeated full rebuilds and cache-busted dynamic imports in [`src/dev.ts`](/home/ashman/Documents/opensource/brandy/src/dev.ts).
  Every save rebuilds the route manifest from scratch and re-imports modules with a fresh cache-busting query string. Over a long Bun dev session, old module generations can accumulate in memory. Not urgent for short sessions, but worth guarding before long-lived development workflows rely on it.
