import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "whats-boot — Sprint 1",
  description: "Painel de validação: mensagens recebidas via Evolution -> n8n -> Supabase",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
