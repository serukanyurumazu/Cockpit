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
}

/** GitHub repos per owner (the user, then their orgs) and local clones under the clone folder. */
export const repos = $state({
  owners: [] as { owner: string; repos: Repo[] }[],
  /** "owner/name" lowercase -> local folder */
  clones: {} as Record<string, string>,
  root: localStorage.getItem("reposRoot") ?? "",
  loading: false,
  error: "",
});

const gh = <T>(cmd: string, args: Record<string, unknown> = {}) => invoke<T>(`plugin:github|${cmd}`, args);

export const cloneOf = (repo: string) => repos.clones[repo.toLowerCase()];

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
