import type { Metadata } from "next";

// O painel e um client component e nao pode exportar metadata; este layout
// existe so para dar titulo proprio a rota.
export const metadata: Metadata = {
  title: "Painel",
};

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
