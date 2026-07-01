import { vercel } from "brandy/adapters";
import { defineConfig } from "brandy/config";

export default defineConfig({
  appDir: "example/app",
  publicDir: "example/public",
  styles: "example/styles.css",
  adapter: vercel({ runtime: "node" }),
});
