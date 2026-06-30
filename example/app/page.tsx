import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";
import {
  HomeClientState,
  HomeFeatureLinks,
  HomeHero,
  HomePrimaryLinks,
  HomeServerData,
  type HomeData,
} from "./_components/home";

export const metadata: Metadata = { title: "Home · Brandy" };

export function load() {
  return {
    renderedAt: new Date().toLocaleTimeString("en-US"),
    requestId: crypto.randomUUID().slice(0, 8),
  };
}

export default function Home({ data }: { data: HomeData }) {
  return (
    <main class="mx-auto max-w-4xl px-5 py-12">
      <HomeHero />
      <HomePrimaryLinks />
      <HomeFeatureLinks />

      <div class="mt-12 grid gap-6 md:grid-cols-2">
        <HomeServerData data={data} />
        <HomeClientState />
      </div>
    </main>
  );
}
