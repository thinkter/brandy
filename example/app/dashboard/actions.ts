import { defineAction, revalidate } from "brandy";
import { incrementCount } from "./state.ts";

export const increment = defineAction(async function increment() {
  incrementCount();
  return revalidate("/dashboard");
});
