import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// neon() speaks HTTP per query, so there is no connection pool to manage in a serverless function.
export const db = drizzle(neon(url), { schema });
