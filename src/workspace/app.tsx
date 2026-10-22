import React, { useEffect, useRef, useState } from "react";
import type { WorkspaceClient, WorkspaceQueries } from "./client";
import type { WorkspaceService } from "./service";
import { workspaceRouteSchema, type Person, type Preferences, type WorkspaceRoute, type WorkspaceSession, type WorkspaceView } from "./protocol";
import { Action, Errors, PersonLink, WorkspaceIcon } from "./components";
import { Projects, People } from "./discovery";
import { ActivityView } from "./views";
import { ProfileView } from "./profile-view";
import { applyWorkspaceTheme } from "./theme";

export interface WorkspaceDependencies { client: WorkspaceClient; queries: WorkspaceQueries; service: WorkspaceService }

export function WorkspaceApp(dependencies: WorkspaceDependencies) {
  const { client } = dependencies;
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const route = useRef<WorkspaceRoute | null>(null);
  const acceptSession = (value: WorkspaceSession) => {
    route.current ??= { view: value.view, subject: value.subject };
    applyWorkspaceTheme(value.theme);
    setSession({ ...value, ...route.current });
  };
  useEffect(() => {
    let active = true;
    let checkingSession = true;
    const initialize = async () => {
      try {
        const value = await client.request<WorkspaceSession>({ type: "preferences" });
        if (!active) return;
        acceptSession(value);
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not load your Azure DevOps session.");
        try { await client.request({ type: "ping" }); }
        catch (themeError) { if (active) setError(themeError instanceof Error ? themeError.message : "Could not load the Azure DevOps theme."); }
      }
      if (active) await client.request({ type: "ready" });
    };
    void initialize().catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not initialize the workspace."); })
      .finally(() => { checkingSession = false; });
    const disconnected = (event: Event) => { setSession(null); setError((event as CustomEvent<string>).detail); };
    const routed = (event: Event) => {
      const parsed = workspaceRouteSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (parsed.success) {
        route.current = parsed.data;
        setSession((current) => current ? { ...current, ...parsed.data } : null);
      }
    };
    const revalidate = () => {
      if (document.visibilityState !== "visible" || checkingSession) return;
      checkingSession = true;
      void client.request<WorkspaceSession>({ type: "preferences" }).then((value) => {
        if (active) acceptSession(value);
      }).catch((reason: unknown) => {
        if (active) { setSession(null); setError(reason instanceof Error ? reason.message : "Could not verify your Azure DevOps session."); }
      }).finally(() => { checkingSession = false; });
    };
    document.addEventListener("workspace-disconnected", disconnected);
    document.addEventListener("workspace-route", routed);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      active = false;
      document.removeEventListener("workspace-disconnected", disconnected);
      document.removeEventListener("workspace-route", routed);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [client]);

  const run = (operation: Promise<unknown>) => { void operation.catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Workspace operation failed")); };
  const navigate = (view: WorkspaceView, person?: Person) => run(client.request({ type: "navigate", view, ...(person ? { person } : {}) }));
  const save = async (preferences: Preferences) => {
    setSaving(true);
    try { acceptSession(await client.request<WorkspaceSession>({ type: "preferences", value: preferences })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Preferences could not be saved"); }
    finally { setSaving(false); }
  };
  if (!session) return <main className="startup"><h1>ADO Boost</h1>{error ? <Errors errors={[error]} /> : <p role="status">Connecting to your Azure DevOps session...</p>}</main>;
  const openPerson = (person: Person) => navigate("profile", person);
  const subject = session.view === "profile" ? session.subject ?? session.viewer : session.viewer;
  const view = !session.preferences.projects.length ? "projects" : session.view;
  return <div className="workspace">
    <header className="workspace-header"><div className="workspace-identity"><img className="brand-icon" src="./icons/ado-boost.svg" alt="" width="32" height="32" />
      <div><span className="brand">PR Hub</span><span className="brand-caption">ADO Boost<span className="organization">{session.context.organization}</span></span></div></div>
      <div className="header-actions"><PersonLink person={session.viewer} context={session.context} open={openPerson} />
        <Action onClick={() => run(client.request({ type: "close" }))}>Back to Azure DevOps</Action></div></header>
    <nav className="workspace-tabs" aria-label="ADO Boost"><div>{([
      ["dashboard", "My PRs"], ["feed", "Activity feed"], ["profile", "Profile"], ["projects", "Projects"], ["people", "People"]
    ] as [WorkspaceView, string][]).map(([key, label]) => <button key={key} aria-current={view === key ? "page" : undefined}
      onClick={() => navigate(key, key === "profile" ? session.viewer : undefined)}><WorkspaceIcon name={key} />{label}</button>)}</div>
      <details className="workspace-options"><summary aria-label="Workspace options">Options</summary><div className="options-menu"><button className="cache-clear" onClick={() => {
        if (confirm("Clear cached workspace data for this account and organization? Follows, preferences and review drafts will remain.")) {
          run(client.request({ type: "clear-cache" }).then(() => { setNotice("Workspace cache cleared. Refresh the current view to fetch data again."); }));
        }
      }}>Clear workspace cache</button><p>Projects, follows, and review drafts are kept.</p></div></details></nav>
    <main><Errors errors={error ? [error] : []} />
      {notice && <p role="status">{notice}</p>}
      {saving && <p role="status">Saving local preferences...</p>}
      {view === "projects" ? <Projects {...dependencies} session={session} save={save} saving={saving} /> :
        view === "people" ? <People {...dependencies} session={session} save={save} saving={saving} openPerson={openPerson} /> :
            view === "profile" ? <ProfileView key={subject.id} {...dependencies} session={{ ...session, view, subject }} save={save} openPerson={openPerson} /> :
              <ActivityView key={`${view}:${subject.id}`} {...dependencies} session={{ ...session, view, subject }} save={save} openPerson={openPerson} />}
    </main>
    <footer>Stored locally in this browser profile. Only selected projects are queried. PR activity is not an audit log.</footer>
  </div>;
}
