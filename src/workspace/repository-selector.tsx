import React, { useEffect, useRef, useState } from "react";
import type { WorkspaceQueries } from "./client";
import type { Project, Repository } from "./protocol";
import { Action, Errors } from "./components";

interface Props {
  projects: readonly Project[];
  currentProject?: Project | null;
  queries: WorkspaceQueries;
  suggestions: Repository[];
  suggestionsLoading: boolean;
  favorites: string[];
  saving: boolean;
  toggle: (id: string) => void;
}

export function RepositorySelector({ projects, currentProject, queries, suggestions, suggestionsLoading, favorites, saving, toggle }: Props) {
  const defaultProject = projects.find((project) => project.id === currentProject?.id) ?? projects[0];
  const [selection, setSelection] = useState(defaultProject?.id ?? "");
  const project = projects.find((item) => item.id === selection) ?? defaultProject;
  const loaded = useRef(new Map<string, Repository[]>());
  const [result, setResult] = useState<{ project: string; repos: Repository[]; loading: boolean; error: string }>({
    project: "", repos: [], loading: true, error: ""
  });
  useEffect(() => {
    if (!project) return;
    let active = true;
    setSelection(project.id);
    const cached = loaded.current.get(project.id);
    if (cached) {
      setResult({ project: project.id, repos: cached, loading: false, error: "" });
      return;
    }
    setResult({ project: project.id, repos: [], loading: true, error: "" });
    void queries.read<Repository[]>({ kind: "repositories", project: project.name }).then((repos) => {
      if (active) {
        loaded.current.set(project.id, repos);
        setResult({ project: project.id, repos, loading: false, error: "" });
      }
    }).catch((reason: unknown) => {
      if (active) setResult({ project: project.id, repos: [], loading: false, error: reason instanceof Error ? reason.message : "Repositories unavailable" });
    });
    return () => { active = false; };
  }, [queries, project?.id, project?.name]);
  const current = result.project === project?.id;
  const loading = !current || result.loading;
  return <div className="repository-selector">
    <RepositoryList key={project?.id} repos={current ? result.repos : []} suggestions={suggestions}
      loading={loading} failed={current && !!result.error} suggestionsLoading={suggestionsLoading} favorites={favorites} saving={saving} toggle={toggle}
      projectPicker={<label className="field">Project<select value={project?.id ?? ""} disabled={saving}
        onChange={(event) => setSelection(event.target.value)}>
        {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>} />
    <Errors errors={current && result.error ? [result.error] : []} />
  </div>;
}

function RepositoryList({ repos, suggestions, loading, failed, suggestionsLoading, favorites, saving, toggle, projectPicker }: {
  repos: Repository[]; suggestions: Repository[]; loading: boolean; failed: boolean; suggestionsLoading: boolean; favorites: string[];
  saving: boolean; toggle: (id: string) => void; projectPicker: React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const favoriteIds = new Set(favorites);
  const suggestedIds = new Set(suggestions.map((repo) => repo.id));
  const repositories = [...new Map([...suggestions, ...repos].map((repo) => [repo.id, repo])).values()];
  const filtered = repositories.filter((repo) => `${repo.project.name} / ${repo.name}`.toLowerCase().includes(search.toLowerCase()));
  const compare = (a: Repository, b: Repository) => a.project.name.localeCompare(b.project.name) || a.name.localeCompare(b.name);
  const suggested = filtered.filter((repo) => suggestedIds.has(repo.id)).sort(compare);
  const others = filtered.filter((repo) => !suggestedIds.has(repo.id))
    .sort((a, b) => Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)) || compare(a, b));
  const visible = [...suggested, ...others.slice(0, limit)];
  return <>
    <div className="controls">{projectPicker}
      <label className="field">Filter repositories<input type="search" value={search}
        onChange={(event) => { setSearch(event.target.value); setLimit(100); }} /></label>
      <span className="muted repository-count" role="status">{loading ? "Loading repositories..." :
        `${suggested.length} suggested · ${Math.min(limit, others.length)} of ${others.length.toLocaleString()} other repositories`}</span>
    </div>
    <div className="project-list repository-list" aria-busy={loading || suggestionsLoading}>{visible.map((repo) => <label key={repo.id}
      data-selected={favoriteIds.has(repo.id)} data-suggested={suggestedIds.has(repo.id)}>
      <input type="checkbox" disabled={saving} checked={favoriteIds.has(repo.id)} onChange={() => toggle(repo.id)} />
      <span>{repo.project.name} / {repo.name}{suggestedIds.has(repo.id) && <small className="muted"> · Your PR activity</small>}</span>
    </label>)}</div>
    <span className="sr-only" role="status">{suggestionsLoading ? "Loading repository suggestions..." : ""}</span>
    {!loading && !failed && !suggestionsLoading && !repositories.length && <p className="muted">No repositories found in this project. Choose another project.</p>}
    {!!repositories.length && !filtered.length && <p className="muted">No matching repositories.</p>}
    {others.length > limit && <Action onClick={() => setLimit((value) => value + 100)}>Load more repositories</Action>}
  </>;
}
