import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Os nomes precisam diferir dos tokens do Tailwind (--font-display / --font-mono):
// a variavel injetada aqui vive no mesmo elemento, e uma referencia a si mesma
// invalida a declaracao — as fontes silenciosamente nao aplicam.
const display = Chakra_Petch({
  variable: "--font-display-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  // O template deixa cada pagina nomear so a propria secao: "Painel · ORBIT".
  title: {
    default: "ORBIT — seus projetos da Vercel em um so lugar",
    template: "%s · ORBIT",
  },
  description:
    "Veja seus projetos hospedados na Vercel com status de deploy, higiene da conta e exclusao com dupla confirmacao.",
  applicationName: "ORBIT",
  // Painel de conta: nao deve aparecer em buscador nenhum. Isto nao impede o
  // preview ao compartilhar o link — robos de preview leem o Open Graph.
  robots: { index: false, follow: false },
  // Necessario para o Open Graph montar URLs absolutas da imagem.
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "ORBIT",
    title: "ORBIT — seus projetos da Vercel em um so lugar",
    description:
      "Radar de higiene, tendencias de deploy e exclusao com dupla confirmacao. Seu token e cifrado e expira sozinho em 7 dias.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ORBIT — seus projetos da Vercel em um so lugar",
    description: "Radar de higiene, tendencias de deploy e exclusao com dupla confirmacao.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
