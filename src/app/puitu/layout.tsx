import PuituShell from "@/components/puitu/PuituShell";

export default function PuituLayout({ children }: { children: React.ReactNode }) {
  return <PuituShell>{children}</PuituShell>;
}
