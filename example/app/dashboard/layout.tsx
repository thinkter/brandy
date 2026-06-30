import { Html } from "@elysiajs/html";

export default function DashboardLayout({ children }: { children: JSX.Element }) {
  return <main><aside><a href="/dashboard">Overview</a> <a href="/dashboard/settings">Settings</a></aside>{children}</main>;
}
