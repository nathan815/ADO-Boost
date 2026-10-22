import React, { useState } from "react";
import { Button } from "azure-devops-ui/Button";
import { prKey, prUrl, type Person, type WorkspaceContext, type WorkspacePr } from "./protocol";
import type { ActivityEvent } from "./activity";

export type WorkspaceIconName = "dashboard" | "people" | "profile" | "feed" | "projects" | "completed";
export function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  const paths: Record<WorkspaceIconName, React.ReactNode> = {
    dashboard: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M12 5h2a4 4 0 0 1 4 4v8m-3-3 3 3 3-3" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></>,
    feed: <><path d="M8 4h13M8 12h13M8 20h13" /><circle cx="3" cy="4" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="20" r="1" /></>,
    projects: <><path d="M3 7V4h7l2 3h9v14H3V7Z" /><path d="M3 10h18" /></>,
    completed: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>
  };
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Action(props: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <Button {...(typeof props.children === "string" ? { text: props.children } : {})} onClick={props.onClick}
    disabled={props.disabled ?? false} primary={props.primary ?? false}>{typeof props.children !== "string" ? props.children : null}</Button>;
}

export function Errors({ errors }: { errors: string[] }) {
  return errors.length ? <section role="alert" className="errors"><strong>Some data could not be loaded</strong>
    <ul>{[...new Set(errors)].map((error) => <li key={error}>{error}</li>)}</ul></section> : null;
}

export function Avatar({ person, context, size = 24 }: { person: Person; context: WorkspaceContext; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * .36 }} aria-hidden="true">
    <span>{person.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span>
    <img alt="" width={size} height={size} src={`${context.base}/_api/_common/identityImage?id=${encodeURIComponent(person.id)}`}
      onError={(event) => { event.currentTarget.hidden = true; }} onLoad={(event) => { event.currentTarget.hidden = false; }} />
  </span>;
}

export function PersonLink({ person, context, open, size = 24 }: { person: Person; context: WorkspaceContext; open: (person: Person) => void; size?: number }) {
  return <button className="person-link" onClick={() => open(person)}>
    <Avatar person={person} context={context} size={size} /><span>{person.displayName}</span>
  </button>;
}

export function LoadingCards({ label }: { label: string }) {
  return <div className="loading-cards" role="status"><span className="sr-only">{label}</span>
    {[0, 1, 2].map((item) => <div className="skeleton-card" key={item} aria-hidden="true"><span /><span /><span /></div>)}
  </div>;
}

export function SampleStats({ items, loading }: { items: { label: string; value: number | string; icon: WorkspaceIconName }[]; loading: boolean }) {
  return <dl className="sample-stats">{items.map((item) => <div key={item.label}>
    <WorkspaceIcon name={item.icon} /><dt>{item.label}</dt><dd>{loading ? <span className="stat-placeholder" aria-label="Loading" /> : item.value.toLocaleString()}</dd>
  </div>)}</dl>;
}

export function PrList({ title, prs, context, openPerson, favorites, toggleFavorite, subject, pageSize }: {
  title: string; prs: WorkspacePr[]; context: WorkspaceContext; openPerson: (person: Person) => void;
  favorites: string[]; toggleFavorite: (repository: string) => void; subject: string; pageSize?: number;
}) {
  const [visible, setVisible] = useState(pageSize ?? Infinity);
  return <section className="pr-section"><h2><WorkspaceIcon name="dashboard" />{title} <span className="count">{prs.length}</span></h2>
    {!prs.length && <div className="empty-state"><WorkspaceIcon name="dashboard" /><strong>No matching pull requests</strong>
      <p>Try another status or repository, or load more history.</p></div>}
    <ul className="pr-list">{prs.slice(0, visible).map((pr) => <li key={prKey(pr)}>
      <div className="pr-content"><a className="pr-title" href={prUrl(context, pr)} target="_top">{pr.title}</a>
        <div className="pr-card-top"><span className="pr-state" data-state={pr.isDraft ? "draft" : pr.status}>{pr.isDraft ? "Draft" : pr.status}</span>
          <span className="repo-path">{pr.repository.project.name} / <strong>{pr.repository.name}</strong></span>
          <span className="pr-number">#{pr.pullRequestId}</span></div>
        <div className="pr-card-footer"><PersonLink person={pr.createdBy} context={context} open={openPerson} />
          <div className="metadata">{pr.createdBy.id !== subject && pr.reviewers.some((reviewer) => reviewer.id === subject) && <span title="Current reviewer vote, not a dated review event">{
            voteLabel(pr.reviewers.find((reviewer) => reviewer.id === subject)?.vote ?? 0)
          }</span>}<time dateTime={pr.creationDate} title={`Created ${new Date(pr.creationDate).toLocaleString()}`}>{new Date(pr.creationDate).toLocaleDateString()}</time></div>
        </div>
      </div>
      <button aria-label={`${favorites.includes(pr.repository.id) ? "Unfavorite" : "Favorite"} ${pr.repository.name}`}
        aria-pressed={favorites.includes(pr.repository.id)} title={`${favorites.includes(pr.repository.id) ? "Unfavorite" : "Favorite"} repository`}
        className="favorite" onClick={() => toggleFavorite(pr.repository.id)}>{favorites.includes(pr.repository.id) ? "\u2605" : "\u2606"}</button>
    </li>)}</ul>
    {visible < prs.length && <Action onClick={() => setVisible((value) => value + (pageSize ?? prs.length))}>Show more PRs</Action>}
  </section>;
}

function voteLabel(vote: number): string {
  return ({ "10": "Approved", "5": "Approved with suggestions", "0": "No vote recorded", "-5": "Waiting for author", "-10": "Rejected" })[String(vote)] ?? `Current vote: ${vote}`;
}

export function EventList({ events, context, openPerson }: {
  events: ActivityEvent[]; context: WorkspaceContext; openPerson: (person: Person) => void;
}) {
  return <ol className="event-list">{events.map((event) => <li key={event.id}>
    <div className={`event-mark ${event.kind}`} aria-hidden="true" />
    <div><div><PersonLink person={event.actor} context={context} open={openPerson} /> <span>{
      event.kind === "completed" || event.kind === "abandoned" ? `authored a PR that ${event.kind}` :
        event.kind === "commented" ? "commented on" : event.kind === "voted" ? "voted on" : "created"
    }</span>{" "}
      <a href={prUrl(context, event.pr)} target="_top">{event.pr.title}</a></div>
      <p className="metadata">{event.pr.repository.name} <time dateTime={event.date} title={new Date(event.date).toLocaleString()}>{new Date(event.date).toLocaleString()}</time></p>
      {event.detail && <p className="event-detail">{event.detail}</p>}</div>
  </li>)}</ol>;
}
