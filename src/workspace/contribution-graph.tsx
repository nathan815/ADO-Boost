import React, { useEffect, useMemo, useRef, useState } from "react";
import { contributionCalendar, type ProfileContribution, type ProfilePeriod } from "./profile";

export function ContributionGraph({ period, contributions, selected, select }: {
  period: ProfilePeriod; contributions: ProfileContribution[]; selected: string; select: (day: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const calendar = useMemo(() => contributionCalendar(period, width), [period.since, period.until, width]);
  const counts = new Map(contributions.map((day) => [day.day, day]));
  const totals = contributions.reduce((total, day) => ({ created: total.created + day.created, reviewed: total.reviewed + day.reviewed }), { created: 0, reviewed: 0 });
  const months = calendar.days.filter((_, index) => index % 7 === 0).map((day, week, weeks) => {
    if (week && day.slice(0, 7) === weeks[week - 1]!.slice(0, 7)) return null;
    return <text key={week} x={30 + week * (calendar.cell + 2)} y={10} fontSize={10}>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</text>;
  });
  return <div ref={container} className="profile-calendar">
    <div className="graph-caption"><span><strong>{totals.created}</strong> PRs created <span className="status-divider">/</span> <strong>{totals.reviewed}</strong> PRs reviewed</span>
      <span>{new Date(period.since).toLocaleDateString()} - {new Date(period.until).toLocaleDateString()}</span></div>
    <div className="profile-graph-scroll"><svg width={calendar.width} height={calendar.height} role="group" aria-label="PR activity by creation date">
      {months}
      {["", "Mon", "", "Wed", "", "Fri", ""].map((label, index) => <text key={index} x={0} y={18 + index * (calendar.cell + 2) + calendar.cell / 2} fontSize={9} dominantBaseline="middle">{label}</text>)}
      {calendar.days.map((day, index) => {
        const count = counts.get(day);
        const created = count?.created ?? 0;
        const reviewed = count?.reviewed ?? 0;
        const total = created + reviewed;
        const label = `${day}: ${created} created, ${reviewed} reviewed`;
        const activate = () => select(day === selected ? "" : day);
        return <rect key={day} role="button" tabIndex={0} aria-label={label} aria-pressed={day === selected}
          data-active={total > 0} data-level={total === 0 ? 0 : total <= 1 ? 1 : total <= 3 ? 2 : total <= 5 ? 3 : 4}
          x={30 + Math.floor(index / 7) * (calendar.cell + 2)} y={16 + (index % 7) * (calendar.cell + 2)}
          width={calendar.cell} height={calendar.cell} rx={2} onClick={activate} onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
          }}><title>{label}</title></rect>;
      })}
    </svg></div>
    <div className="graph-caption"><span>PRScope counts reviews with a non-zero vote on non-self PRs, on the PR's creation date.</span>
      <span className="graph-legend">Less <i /><i /><i /><i /><i /> More</span></div>
  </div>;
}
