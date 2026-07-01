import { vercel } from "brandy/adapters";
import { defineConfig } from "brandy/config";
import { auth } from "./example/app/_lib/auth.ts";

export default defineConfig({
  appDir: "example/app",
  publicDir: "example/public",
  styles: "example/styles.css",
  adapter: vercel({ runtime: "node" }),
  setup(app) {
    // Better Auth's own endpoints (session refresh, etc.). The demo's sign-in/up/out
    // flows go through Brandy server actions in example/app/notes/actions.ts instead.
    app.get("/api/auth/*", ({ request }) => auth.handler(request));
    app.post("/api/auth/*", ({ request }) => auth.handler(request));
  },
});
