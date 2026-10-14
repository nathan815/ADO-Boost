// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderAdoComment } from "../src/ui/comment-content";
import { announcementBody } from "../src/core/announcement-content";
import type { PullRequestContext } from "../src/core/types";

describe("ADO comment rendering", () => {
  it("renders Markdown and safe rich HTML", () => {
    const rendered = renderAdoComment("**Review**\n\n<table><tr><td>Covered</td></tr></table>");
    expect(rendered).toContain("<strong>Review</strong>");
    expect(rendered).toContain("<table>");
    expect(rendered).toContain("<td>Covered</td>");
  });

  it("removes executable and panel-mutating content", () => {
    const rendered = renderAdoComment('<img src="x" onerror="alert(1)"><style>body{display:none}</style><script>alert(1)</script><span style="position:fixed">Text</span>');
    expect(rendered).not.toContain("onerror");
    expect(rendered).not.toContain("<style");
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("position:fixed");
    expect(rendered).toContain("Text");
  });

  it("formats announcements and hides metadata in rendered previews", () => {
    const context: PullRequestContext = {
      origin: "https://dev.azure.com", organization: "org", project: "project",
      repository: "repo", repositoryId: "repo-id", pullRequestId: 7, title: "PR",
      sourceCommit: "source", targetCommit: "target", mergeBaseCommit: "base",
      iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Current Reviewer" }
    };
    const rendered = renderAdoComment(announcementBody(context));
    expect(rendered).not.toMatch(/<h[1-6]>/);
    expect(rendered).toContain("<strong>Current Reviewer</strong>");
    expect(rendered).toContain('<a href="https://github.com/nathan815/ADO-Boost">ADO Boost</a> browser extension');
    expect(rendered).not.toContain("ado-boost:");
    expect(rendered).not.toContain("reviewerId");

    const name = '**[Reviewer](https://example.com)** <img src=x onerror=alert(1)>\n# Header';
    const container = document.createElement("div");
    container.innerHTML = renderAdoComment(announcementBody({ ...context, reviewer: { id: "me", displayName: name } }));
    expect(container.querySelector("img, script, h1")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://github.com/nathan815/ADO-Boost");
    expect(container.querySelector("p strong")?.textContent).toBe(name.replace("\n", " "));
  });
});
