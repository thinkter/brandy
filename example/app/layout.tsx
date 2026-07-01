import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";

export const metadata: Metadata = {
  title: "Brandy",
  meta: { description: "Brandy P1 example" },
};

export default function RootLayout({ children }: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
      </head>
      <body>
        <header class="border-b border-zinc-800">
          <div class="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
            <a class="font-semibold no-underline" href="/">
              Brandy
            </a>
            <nav class="flex gap-5 text-sm">
              <a href="/">Home</a>
              <a href="/dashboard">Dashboard</a>
              <a href="/server">Server</a>
              <a href="/components">Components</a>
              <a href="/interactive">Interactive</a>
              <a href="/about">About</a>
            </nav>
          </div>
        </header>
        {children}
        <footer class="mx-auto mt-16 max-w-4xl border-t border-zinc-800 px-5 py-6 text-sm text-zinc-500">
          Built with Brandy.
        </footer>
      </body>
    </html>
  );
}
