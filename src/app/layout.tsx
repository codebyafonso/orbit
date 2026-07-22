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
  title: "ORBIT // controle de deploys",
  description: "Painel de controle dos seus projetos hospedados na Vercel.",
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
