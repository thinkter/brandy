import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";

export const metadata: Metadata = { meta: { section: "dashboard" } };

export default function DashboardLayout({ children }: { children: JSX.Element }) {
  return (
    <main class="mx-auto max-w-4xl px-5 py-10">
      <nav class="mb-8 flex gap-4 border-b border-zinc-800 pb-4 text-sm">
        <a href="/dashboard">Overview</a>
        <a href="/dashboard/settings">Settings</a>
        <a href="/dashboard/users/42">User 42</a>
      </nav>
      {children}
    </main>
  );
}
