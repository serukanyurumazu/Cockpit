import { invoke } from "@tauri-apps/api/core";

export interface Repo {
  name: string;
  nameWithOwner: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  description: string;
  updatedAt: string;
  url: string;
  repositoryTopics: { name: string }[] | null;
}

const OTHER = "Diğer";

/** GitHub repos per owner (the user, then their orgs) and local clones under the clone folder. */
export const repos = $state({
  owners: [] as { owner: string; repos: Repo[] }[],
  /** "owner/name" lowercase -> local folder */
  clones: {} as Record<string, string>,
  root: localStorage.getItem("reposRoot") ?? "",
  /** user-chosen area per repo ("owner/name"); overrides the GitHub topic grouping */
  areas: JSON.parse(localStorage.getItem("repoAreas") ?? "{}") as Record<string, string>,
  loading: false,
  error: "",
});

const gh = <T>(cmd: string, args: Record<string, unknown> = {}) => invoke<T>(`plugin:github|${cmd}`, args);

export const cloneOf = (repo: string) => repos.clones[repo.toLowerCase()];

/** Custom area if set, else the repo's first GitHub topic, else "Diğer". */
export const areaOf = (r: Repo) => repos.areas[r.nameWithOwner] || r.repositoryTopics?.[0]?.name || OTHER;

export function setArea(repo: string, area: string) {
  if (area.trim()) repos.areas[repo] = area.trim();
  else delete repos.areas[repo];
  localStorage.setItem("repoAreas", JSON.stringify(repos.areas));
}

/** Repos grouped by area, groups sorted by name with "Diğer" last. */
export function groupByArea(list: Repo[]): [string, Repo[]][] {
  const groups = new Map<string, Repo[]>();
  for (const r of list) groups.set(areaOf(r), [...(groups.get(areaOf(r)) ?? []), r]);
  return [...groups].sort(([a], [b]) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b, "tr")));
}

export async function loadClones() {
  repos.clones = repos.root ? await gh<Record<string, string>>("local_clones", { root: repos.root }).catch(() => ({})) : {};
}

export function setCloneRoot(root: string) {
  repos.root = root;
  localStorage.setItem("reposRoot", root);
  return loadClones();
}

export async function loadRepos() {
  repos.loading = true;
  repos.error = "";
  try {
    const owners = await gh<string[]>("owners");
    const lists = await Promise.all(owners.map((owner) => gh<Repo[]>("repo_list", { owner }).catch(() => [] as Repo[])));
    repos.owners = owners.map((owner, i) => ({ owner, repos: lists[i].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }));
    await loadClones();
  } catch (e) {
    repos.error = String(e);
  } finally {
    repos.loading = false;
  }
}
