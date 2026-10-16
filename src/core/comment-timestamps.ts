export interface CommentDates {
  publishedDate?: string;
  lastContentUpdatedDate?: string;
}

export interface CommentTimestamp {
  label: "Created" | "Edited";
  dateTime: string;
  relative: string;
  exact: string;
}

export function commentTimestamps(dates: CommentDates, now = Date.now()): CommentTimestamp[] {
  const created = Date.parse(dates.publishedDate ?? "");
  if (!Number.isFinite(created)) return [];
  const edited = Date.parse(dates.lastContentUpdatedDate ?? "");
  const values: Array<[CommentTimestamp["label"], number]> = [["Created", created]];
  if (Number.isFinite(edited) && edited > created) values.push(["Edited", edited]);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "always", style: "short" });
  const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" });
  return values.map(([label, instant]) => {
    const seconds = (instant - now) / 1000;
    const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] = Math.abs(seconds) < 60 ? [1, "second"]
      : Math.abs(seconds) < 3600 ? [60, "minute"]
        : Math.abs(seconds) < 86400 ? [3600, "hour"]
          : Math.abs(seconds) < 2592000 ? [86400, "day"]
            : Math.abs(seconds) < 31536000 ? [2592000, "month"] : [31536000, "year"];
    return {
      label,
      dateTime: new Date(instant).toISOString(),
      relative: relative.format(seconds <= 0 ? -Math.floor(Math.abs(seconds) / divisor) : Math.floor(seconds / divisor), unit).replaceAll(".", ""),
      exact: exact.format(instant)
    };
  });
}
