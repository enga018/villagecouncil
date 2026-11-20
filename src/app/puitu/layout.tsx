import AppShell from "@/components/puitu/AppShell";
import AuthGate from "@/components/puitu/AuthGate";

export default function PuituLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate><AppShell>{children}</AppShell></AuthGate>;
}
