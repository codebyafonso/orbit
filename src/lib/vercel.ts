const API = "https://api.vercel.com";

export class VercelError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type VercelAuth = { token: string; teamId?: string };

/**
 * Credenciais vindas do ambiente. Some quando o login OAuth entrar (Task 5);
 * ate la preserva a mensagem que a interface usa para orientar quem nao
 * configurou o token.
 */
export function authFromEnv(): VercelAuth {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new VercelError(
      "VERCEL_TOKEN nao configurado. Crie um token em vercel.com/account/tokens e adicione em .env.local",
      401,
    );
  }
  return { token, teamId: process.env.VERCEL_TEAM_ID };
}

function withTeam(path: string, teamId?: string) {
  if (!teamId) return path;
  return path + (path.includes("?") ? "&" : "?") + `teamId=${encodeURIComponent(teamId)}`;
}

async function call<T>(auth: VercelAuth, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + withTeam(path, auth.teamId), {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Vercel API respondeu ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new VercelError(message, res.status);
  }

  // O DELETE responde ora 204, ora 200 com corpo vazio: tratar so o 204 fazia
  // uma exclusao bem-sucedida aparecer como falha na interface.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export type Project = {
  id: string;
  name: string;
  framework: string | null;
  createdAt: number;
  updatedAt: number | null;
  productionUrl: string | null;
  repo: { url: string; label: string; provider: "github" | "gitlab" | "bitbucket" } | null;
  latestDeployment: {
    id: string;
    url: string | null;
    state: string | null;
    createdAt: number | null;
    target: string | null;
  } | null;
};

export type RawProject = {
  id: string;
  name: string;
  framework: string | null;
  createdAt: number;
  updatedAt?: number;
  alias?: { domain: string; target?: string }[];
  targets?: { production?: RawDeployment | null };
  latestDeployments?: RawDeployment[];
  link?: RawLink;
};

export type RawLink = {
  type?: string;
  // github
  org?: string;
  repo?: string;
  // gitlab
  projectNamespace?: string;
  projectName?: string;
  projectUrl?: string;
  // bitbucket
  owner?: string;
  slug?: string;
};

// A URL vem da API externa: so aceitamos https, para um href nunca virar javascript:
function safeHttpsUrl(value?: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function repoFrom(link?: RawLink): Project["repo"] {
  if (!link?.type) return null;

  if (link.type === "github" && link.org && link.repo) {
    return {
      provider: "github",
      label: `${link.org}/${link.repo}`,
      url: `https://github.com/${link.org}/${link.repo}`,
    };
  }
  if (link.type === "gitlab" && link.projectNamespace && link.projectName) {
    return {
      provider: "gitlab",
      label: `${link.projectNamespace}/${link.projectName}`,
      url:
        safeHttpsUrl(link.projectUrl) ??
        `https://gitlab.com/${link.projectNamespace}/${link.projectName}`,
    };
  }
  if (link.type === "bitbucket" && link.owner && link.slug) {
    return {
      provider: "bitbucket",
      label: `${link.owner}/${link.slug}`,
      url: `https://bitbucket.org/${link.owner}/${link.slug}`,
    };
  }
  return null;
}

type RawDeployment = {
  id?: string;
  uid?: string;
  url?: string;
  alias?: string[];
  readyState?: string;
  createdAt?: number;
  target?: string | null;
};

export function normalize(p: RawProject): Project {
  const prod = p.targets?.production ?? null;
  const latest = prod ?? p.latestDeployments?.[0] ?? null;
  const alias = p.alias?.find((a) => a.target === "PRODUCTION") ?? p.alias?.[0];
  const productionUrl = alias?.domain ?? prod?.alias?.[0] ?? prod?.url ?? null;

  return {
    id: p.id,
    name: p.name,
    framework: p.framework ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? null,
    productionUrl: productionUrl ? `https://${productionUrl.replace(/^https?:\/\//, "")}` : null,
    repo: repoFrom(p.link),
    latestDeployment: latest
      ? {
          id: latest.id ?? latest.uid ?? "",
          url: latest.url ? `https://${latest.url.replace(/^https?:\/\//, "")}` : null,
          state: latest.readyState ?? null,
          createdAt: latest.createdAt ?? null,
          target: latest.target ?? null,
        }
      : null,
  };
}

const MAX_PROJECTS = 1000;

export async function listProjects(
  auth: VercelAuth,
  { max = MAX_PROJECTS }: { max?: number } = {},
): Promise<{ projects: Project[]; truncated: boolean }> {
  const projects: Project[] = [];
  let next: number | null = null;
  let truncated = false;

  // A API pagina em 100; buscamos tudo para a busca no cliente funcionar de verdade.
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (next) qs.set("until", String(next));
    const page: { projects: RawProject[]; pagination?: { next: number | null } } = await call(
      auth,
      `/v10/projects?${qs}`,
    );
    projects.push(...page.projects.map(normalize));
    next = page.pagination?.next ?? null;
    if (next !== null && projects.length >= max) {
      truncated = true; // o painel avisa em vez de esconder (consumido na Task 8)
      break;
    }
  } while (next !== null);

  return { projects, truncated };
}

export type Deployment = {
  id: string;
  projectId: string;
  projectName: string;
  state: string | null;
  target: string | null;
  source: string | null;
  createdAt: number;
  /** Duracao do build em ms, quando a API informou inicio e fim. */
  buildMs: number | null;
  inspectorUrl: string | null;
};

type RawTimelineDeployment = {
  uid?: string;
  projectId?: string;
  name?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  source?: string;
  created?: number;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  inspectorUrl?: string;
};

/**
 * Deploys de todos os projetos, do mais recente para o mais antigo.
 *
 * A interface da Vercel so mostra o historico projeto a projeto; e daqui que
 * saem a linha do tempo unificada e as tendencias.
 */
const MAX_PAGINAS = 30;

export async function listDeployments(
  auth: VercelAuth,
  { max = 200, desde }: { max?: number; desde?: number } = {},
): Promise<{ deployments: Deployment[]; truncated: boolean }> {
  const saida: Deployment[] = [];
  const vistos = new Set<string>();
  let until: number | null = null;
  let truncated = false;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (saida.length >= max) {
      truncated = true; // a janela pedida nao coube: quem chama precisa avisar
      break;
    }

    const qs = new URLSearchParams({ limit: String(Math.min(100, max - saida.length)) });
    if (until) qs.set("until", String(until));
    if (desde) qs.set("since", String(desde));

    const page: {
      deployments: RawTimelineDeployment[];
      pagination?: { next: number | null };
    } = await call(auth, `/v6/deployments?${qs}`);

    if (page.deployments.length === 0) break;

    for (const d of page.deployments) {
      const id = d.uid;
      const createdAt = d.createdAt ?? d.created ?? null;
      // Sem id ou sem data o registro nao serve: viraria key duplicada na lista
      // e 01/01/1970 na linha do tempo.
      if (!id || !createdAt) continue;
      // O cursor `until` e inclusivo na fronteira: sem isto, deploys com o mesmo
      // createdAt aparecem duas vezes e inflam as estatisticas.
      if (vistos.has(id)) continue;
      vistos.add(id);

      saida.push({
        id,
        projectId: d.projectId ?? "",
        projectName: d.name ?? "",
        state: d.readyState ?? d.state ?? null,
        target: d.target ?? null,
        source: d.source ?? null,
        createdAt,
        buildMs: d.ready && d.buildingAt ? d.ready - d.buildingAt : null,
        inspectorUrl: d.inspectorUrl ?? null,
      });
    }

    until = page.pagination?.next ?? null;
    if (until === null) break;
    if (pagina === MAX_PAGINAS - 1) truncated = true;
  }

  return { deployments: saida, truncated };
}

export async function getProject(auth: VercelAuth, idOrName: string): Promise<Project> {
  return normalize(await call<RawProject>(auth, `/v9/projects/${encodeURIComponent(idOrName)}`));
}

export async function deleteProject(auth: VercelAuth, idOrName: string): Promise<void> {
  await call(auth, `/v9/projects/${encodeURIComponent(idOrName)}`, { method: "DELETE" });
}

export async function whoami(auth: VercelAuth) {
  const data = await call<{
    user: { id: string; name?: string; username?: string; avatar?: string };
  }>(auth, "/v2/user");
  if (!data?.user?.id) {
    throw new VercelError("Resposta inesperada de /v2/user", 502);
  }
  return {
    id: data.user.id,
    name: data.user?.name ?? null,
    username: data.user?.username ?? null,
    avatar: data.user?.avatar ? `https://vercel.com/api/www/avatar/${data.user.avatar}` : null,
  };
}
