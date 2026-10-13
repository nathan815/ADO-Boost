import type { FileStat, ReviewGroup, SemanticGroupProposal } from "./types";

export function validateSemanticGroups(files: FileStat[], proposals: SemanticGroupProposal[]): ReviewGroup[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const groups: ReviewGroup[] = proposals.map((proposal, index) => {
    const grouped = proposal.paths.map((path) => {
      const file = byPath.get(path);
      if (!file) throw new Error(`Copilot returned an unknown changed path: ${path}`);
      if (seen.has(path)) throw new Error(`Copilot returned a duplicate changed path: ${path}`);
      seen.add(path);
      return file;
    });
    if (!grouped.length) throw new Error(`Copilot group ${index + 1} contains no changed files`);
    return {
      id: `copilot:${index}:${proposal.title}`,
      title: proposal.title,
      rationale: proposal.rationale,
      source: "copilot",
      files: grouped
    };
  });
  const omitted = files.filter((file) => !seen.has(file.path));
  if (omitted.length) {
    groups.push({
      id: "copilot:omitted",
      title: "Unassigned changes",
      rationale: "Copilot omitted these changed files, so ADO Boost kept them visible.",
      source: "local",
      files: omitted
    });
  }
  return groups;
}
