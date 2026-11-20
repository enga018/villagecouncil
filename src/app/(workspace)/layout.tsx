import AppShell from "@/components/app/AppShell";
import AuthGate from "@/components/app/AuthGate";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate><AppShell>{children}</AppShell></AuthGate>;
}
