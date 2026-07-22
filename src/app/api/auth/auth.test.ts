import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/users", () => ({
  createUser: vi.fn(),
  verifyUser: vi.fn(),
  deleteUser: vi.fn(),
  activateUser: vi.fn(),
}));
vi.mock("@/lib/db/tokens", () => ({ saveToken: vi.fn() }));
vi.mock("@/lib/vercel/client", async () => {
  const real = await vi.importActual<typeof import("@/lib/vercel/client")>("@/lib/vercel/client");
  return { whoami: vi.fn(), VercelError: real.VercelError };
});
vi.mock("@/lib/auth/session", () => ({
  startSession: vi.fn(),
  readSession: vi.fn(),
  destroySession: vi.fn(),
  SESSION_COOKIE: "orbit_session",
}));
// respostaDoLimite fica real: e ela que define 429 vs 503, e o teste verifica isso.
vi.mock("@/lib/auth/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/rate-limit")>()),
  rateLimit: vi.fn(),
  resetLimit: vi.fn(),
  clientIp: () => "1.2.3.4",
}));

import { createUser, verifyUser, deleteUser, activateUser } from "@/lib/auth/users";
import { saveToken } from "@/lib/db/tokens";
import { whoami, VercelError } from "@/lib/vercel/client";
import { startSession } from "@/lib/auth/session";
import { rateLimit, resetLimit } from "@/lib/auth/rate-limit";
import { POST as register } from "./register/route";
import { POST as login } from "./login/route";

const USER = { id: "665f1f77bcf86cd799439011", email: "a@b.com" };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(rateLimit).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(createUser).mockReset();
  vi.mocked(verifyUser).mockReset();
  vi.mocked(deleteUser).mockReset().mockResolvedValue(undefined);
  vi.mocked(activateUser).mockReset().mockResolvedValue(undefined);
  vi.mocked(resetLimit).mockReset().mockResolvedValue(undefined);
  vi.mocked(saveToken).mockReset().mockResolvedValue(new Date());
  vi.mocked(whoami).mockReset();
  vi.mocked(startSession).mockReset().mockResolvedValue(undefined);
});

describe("POST /api/auth/register", () => {
  const corpo = { email: "a@b.com", senha: "senha-bem-longa", token: "vcp_abcdefghijklmnop1234" };

  it("bloqueia requisicao cross-site antes de qualquer trabalho", async () => {
    const res = await register(
      post("http://localhost:3000/api/auth/register", corpo, { origin: "https://malicioso.com" }),
    );
    expect(res.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("responde 429 quando o limite estoura, sem chamar a vercel", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ok: false, motivo: "limite", retryAfterSeconds: 60 });
    const res = await register(post("http://localhost:3000/api/auth/register", corpo));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(whoami).not.toHaveBeenCalled();
  });

  it("recusa campo de tipo errado com 400, sem estourar", async () => {
    const res = await register(
      post("http://localhost:3000/api/auth/register", { ...corpo, email: { $ne: null } }),
    );
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("responde 503, nao 429, quando o limitador esta sem banco", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ok: false, motivo: "indisponivel" });
    const res = await register(post("http://localhost:3000/api/auth/register", corpo));
    expect(res.status).toBe(503);
  });

  it("valida email e senha antes de falar com a vercel", async () => {
    // Ordem importa: o contrario transformaria a rota em oraculo de tokens.
    vi.mocked(createUser).mockResolvedValue({ erro: "Email invalido." });
    const res = await register(
      post("http://localhost:3000/api/auth/register", { ...corpo, email: "invalido" }),
    );
    expect(res.status).toBe(400);
    expect(whoami).not.toHaveBeenCalled();
  });

  it("apaga a conta recem-criada quando o token e recusado", async () => {
    vi.mocked(createUser).mockResolvedValue({ user: USER });
    vi.mocked(whoami).mockRejectedValue(new VercelError("Not authorized", 403));

    const res = await register(post("http://localhost:3000/api/auth/register", corpo));

    expect(res.status).toBe(400);
    expect(deleteUser).toHaveBeenCalledWith(USER.id);
    expect(activateUser).not.toHaveBeenCalled(); // conta continua pendente, nao loga
    expect(startSession).not.toHaveBeenCalled(); // nada de sessao sem token
  });

  it("cria a sessao no caminho feliz", async () => {
    vi.mocked(createUser).mockResolvedValue({ user: USER });
    vi.mocked(whoami).mockResolvedValue({
      id: "usr_1",
      name: null,
      username: "afonso",
      avatar: null,
    });

    const res = await register(post("http://localhost:3000/api/auth/register", corpo));

    expect(res.status).toBe(200);
    expect(saveToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, vercelUsername: "afonso" }),
    );
    expect(startSession).toHaveBeenCalledWith(expect.anything(), USER);
    expect(activateUser).toHaveBeenCalledWith(USER.id); // conta deixa de ser pendente
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  const corpo = { email: "a@b.com", senha: "senha-bem-longa" };

  it("responde 401 com a mesma mensagem para senha errada", async () => {
    vi.mocked(verifyUser).mockResolvedValue(null);
    const res = await login(post("http://localhost:3000/api/auth/login", corpo));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Email ou senha invalidos." });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("limita por ip e por conta", async () => {
    vi.mocked(verifyUser).mockResolvedValue(USER);
    await login(post("http://localhost:3000/api/auth/login", corpo));
    const chaves = vi.mocked(rateLimit).mock.calls.map((c) => c[0]);
    expect(chaves).toEqual(["login-ip:1.2.3.4", "login-conta:a@b.com"]);
    expect(resetLimit).toHaveBeenCalledWith("login-conta:a@b.com"); // acerto zera
  });

  it("nao chama verifyUser quando o limite estoura", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ok: false, motivo: "limite", retryAfterSeconds: 30 });
    const res = await login(post("http://localhost:3000/api/auth/login", corpo));
    expect(res.status).toBe(429);
    expect(verifyUser).not.toHaveBeenCalled();
  });

  it("inicia sessao com a senha correta", async () => {
    vi.mocked(verifyUser).mockResolvedValue(USER);
    const res = await login(post("http://localhost:3000/api/auth/login", corpo));
    expect(res.status).toBe(200);
    expect(startSession).toHaveBeenCalledWith(expect.anything(), USER);
  });
});
