const API = "https://api.vercel.com";

export class VercelError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function credentials() {
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, teamId } = credentials();
  const res = await fetch(API + withTeam(path, teamId), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

type RawProject = {
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

type RawLink = {
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

function repoFrom(link?: RawLink): Project["repo"] {
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
      url: link.projectUrl ?? `https://gitlab.com/${link.projectNamespace}/${link.projectName}`,
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

function normalize(p: RawProject): Project {
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

export async function listProjects(): Promise<Project[]> {
  const projects: Project[] = [];
  let next: number | null = null;

  // A API pagina em 100; buscamos tudo para a busca no cliente funcionar de verdade.
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (next) qs.set("until", String(next));
    const page: { projects: RawProject[]; pagination?: { next: number | null } } = await call(
      `/v10/projects?${qs}`,
    );
    projects.push(...page.projects.map(normalize));
    next = page.pagination?.next ?? null;
  } while (next && projects.length < 1000);

  return projects;
}

export async function getProject(idOrName: string): Promise<Project> {
  return normalize(await call<RawProject>(`/v9/projects/${encodeURIComponent(idOrName)}`));
}

export async function deleteProject(idOrName: string): Promise<void> {
  await call(`/v9/projects/${encodeURIComponent(idOrName)}`, { method: "DELETE" });
}

export async function whoami(): Promise<{ name: string | null; username: string | null }> {
  const data = await call<{ user: { name?: string; username?: string } }>("/v2/user");
  return { name: data.user?.name ?? null, username: data.user?.username ?? null };
}
