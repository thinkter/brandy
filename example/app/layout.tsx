import { Html } from "@elysiajs/html";

export default function RootLayout({ children }: { children: JSX.Element }) {
  return <html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>Brandy example</title></head><body><header><strong>Brandy</strong> <nav><a href="/">Home</a> <a href="/dashboard">Dashboard</a> <a href="/about">About</a></nav></header>{children}<script type="module" src="/_brandy/runtime.js"></script></body></html>;
}
