// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { commentTimestamps } from "../src/core/comment-timestamps";
import { commentTimestampMarkup, refreshCommentTimestamps } from "../src/ui/comment-timestamps";

const publishedDate = "2026-10-16T12:00:00Z";
const lastContentUpdatedDate = "2026-10-16T12:18:00Z";
const now = Date.parse("2026-10-16T12:20:00Z");

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("comment timestamps", () => {
  it("shows creation and content edit ages independently with exact local times", () => {
    const timestamps = commentTimestamps({ publishedDate, lastContentUpdatedDate }, now);
    expect(timestamps.map(({ label, relative }) => [label, relative])).toEqual([
      ["Created", "20 min ago"], ["Edited", "2 min ago"]
    ]);
    expect(timestamps[0]!.dateTime).toBe("2026-10-16T12:00:00.000Z");
    expect(timestamps[0]!.exact).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(Date.parse(publishedDate)));
  });

  it.each([undefined, "bad date", publishedDate, "2026-10-16T08:00:00-04:00", "2026-10-16T11:59:59Z"])(
    "does not infer an edit from absent, invalid, equal, or older content dates: %s",
    (edited) => {
      expect(commentTimestamps({ publishedDate, ...(edited ? { lastContentUpdatedDate: edited } : {}) }, now)).toHaveLength(1);
    }
  );

  it.each([undefined, "", "bad date"])("requires a valid creation date: %s", (created) => {
    expect(commentTimestamps({ ...(created ? { publishedDate: created } : {}), lastContentUpdatedDate }, now)).toEqual([]);
  });

  it("handles old comments, recent comments and future clock skew", () => {
    expect(commentTimestamps({ publishedDate }, Date.parse(publishedDate))[0]!.relative).toBe("0 sec ago");
    expect(commentTimestamps({ publishedDate }, Date.parse(publishedDate) - 120000)[0]!.relative).toBe("in 2 min");
    expect(commentTimestamps({ publishedDate }, now + 86400000)[0]!.relative).toBe("1 day ago");
    expect(commentTimestamps({ publishedDate }, Date.parse(publishedDate) + 3600000)[0]!.relative).toBe("1 hr ago");
    expect(commentTimestamps({ publishedDate }, Date.parse(publishedDate) - 7200000)[0]!.relative).toBe("in 2 hr");
  });

  it.each([
    [1, "sec"],
    [60, "min"],
    [3600, "hr"],
    [86400, "day"],
    [2592000, "mo"],
    [31536000, "yr"]
  ] as const)("omits abbreviation periods for %s seconds in either direction", (seconds, unit) => {
    const created = Date.parse(publishedDate);
    expect(commentTimestamps({ publishedDate }, created + seconds * 1000)[0]!.relative).toBe(`1 ${unit} ago`);
    expect(commentTimestamps({ publishedDate }, created - seconds * 1000)[0]!.relative).toBe(`in 1 ${unit}`);
  });

  it("updates relative labels without replacing time nodes or hover text", () => {
    document.body.innerHTML = commentTimestampMarkup({ publishedDate, lastContentUpdatedDate }, now);
    const times = [...document.querySelectorAll("time")];
    const title = times[1]!.title;
    expect(times[0]!.getAttribute("aria-label")).toBe(`Created ${times[0]!.title}`);
    expect(times[1]!.getAttribute("aria-label")).toBe(`Edited ${title}`);
    expect(times[0]!.textContent).toBe("20 min ago");
    refreshCommentTimestamps(document, now + 60000);
    expect(document.querySelector("time")).toBe(times[0]);
    expect(times[0]!.textContent).toBe("21 min ago");
    expect(times[1]!.textContent).toBe("Edited 3 min ago");
    expect(times[1]!.title).toBe(title);
  });
});
