// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderAdoComment } from "../src/ui/comment-content";

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
});

