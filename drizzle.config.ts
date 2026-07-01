import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./example/app/_lib/schema.ts",
  out: "./example/drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
