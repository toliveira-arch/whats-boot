"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Sprint 1: recarrega os dados do servidor a cada 5s para vermos as
// mensagens aparecerem "ao vivo" durante o teste do fluxo.
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
