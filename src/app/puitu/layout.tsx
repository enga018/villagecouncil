import PuituShell from "@/components/puitu/PuituShell";
import PuituAuthGate from "@/components/puitu/PuituAuthGate";

export default function PuituLayout({ children }: { children: React.ReactNode }) {
  return <PuituAuthGate><PuituShell>{children}</PuituShell></PuituAuthGate>;
}
