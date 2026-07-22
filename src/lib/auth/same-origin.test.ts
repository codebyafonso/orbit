import { describe, it, expect } from "vitest";
import { requireSameOrigin } from "./same-origin";

function req(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/auth/login", { method: "POST", headers });
}

describe("requireSameOrigin", () => {
  it("aceita mesma origem", () => {
    expect(
      requireSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000" })),
    ).toBeNull();
  });

  it("recusa origem diferente", () => {
    const res = requireSameOrigin(req({ host: "localhost:3000", origin: "https://malicioso.com" }));
    expect(res?.status).toBe(403);
  });

  it("recusa quando Origin esta ausente", () => {
    // Estas rotas emitem cookie: um form cross-site sem Origin poderia plantar
    // a sessao do atacante no navegador da vitima.
    expect(requireSameOrigin(req({ host: "localhost:3000" }))?.status).toBe(403);
  });

  it("recusa mesmo com Sec-Fetch-Site, se Origin nao veio", () => {
    // Navegadores sempre mandam Origin em POST; aceitar o header reservado so
    // beneficiaria clientes que nao sao navegador.
    expect(
      requireSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "same-origin" }))?.status,
    ).toBe(403);
  });

  it("distingue http de https na mesma maquina", () => {
    expect(
      requireSameOrigin(req({ host: "localhost:3000", origin: "https://localhost:3000" }))?.status,
    ).toBe(403);
  });

  it("recusa Origin malformado", () => {
    expect(requireSameOrigin(req({ host: "localhost:3000", origin: "nao-e-url" }))?.status).toBe(
      403,
    );
  });
});
