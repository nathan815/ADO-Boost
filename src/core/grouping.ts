import type { FileStat, ReviewGroup, SemanticGroupProposal } from "./types";

const TYPE_LABELS: Array<[RegExp, string, string]> = [
  [/(^|\/)(test|tests|__tests__|spec)\//i, "Verification", "Tests and validation changes"],
  [/(^|\/)(docs?|documentation)\//i, "Documentation", "Documentation and guidance"],
  [/(^|\/)(infra|deploy|deployment|pipelines?|\.github|\.azuredevops)\//i, "Delivery", "Build and deployment configuration"],
  [/\.(json|ya?ml|toml|ini|config|props|targets)$/i, "Configuration", "Configuration and project metadata"],
  [/\.(css|scss|less|svg|png|jpe?g|webp)$/i, "Interface", "User interface assets and styles"]
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function classify(file: FileStat): { title: string; rationale: string } {
  if (file.lockfile) return { title: "Dependency resolution", rationale: "Generated dependency lock state" };
  if (file.generated) return { title: "Generated output", rationale: "Generated or built artifacts" };
  for (const [pattern, title, rationale] of TYPE_LABELS) {
    if (pattern.test(file.path)) return { title, rationale };
  }
  const segments = file.path.replace(/^\//, "").split("/");
  const area = segments.length > 1 ? segments[0]! : "Root changes";
  return { title: area === "Root changes" ? area : area.replace(/[-_]/g, " "), rationale: `Files in ${area}` };
}

export function buildLocalGroups(files: FileStat[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const file of files) {
    const category = classify(file);
    const id = `local-${slug(category.title) || "root"}`;
    const existing = groups.get(id);
    if (existing) existing.files.push(file);
    else groups.set(id, { id, ...category, source: "local", files: [file] });
  }

  return [...groups.values()].sort((a, b) => b.files.length - a.files.length || a.title.localeCompare(b.title));
}

export function buildFolderGroups(files: FileStat[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const file of files) {
    const folder = file.path.replace(/^\//, "").split("/").slice(0, -1).join("/") || "Repository root";
    const id = `folder-${slug(folder) || "root"}`;
    const existing = groups.get(id);
    if (existing) existing.files.push(file);
    else groups.set(id, { id, title: folder, rationale: "Grouped by containing folder", source: "local", files: [file] });
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function buildFlatGroup(files: FileStat[]): ReviewGroup[] {
  return [{ id: "flat-all", title: "All changed files", rationale: "Flat review order", source: "local", files }];
}

export function validateSemanticGroups(files: FileStat[], proposals: SemanticGroupProposal[]): ReviewGroup[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const groups: ReviewGroup[] = [];

  for (const [index, proposal] of proposals.entries()) {
    if (!proposal.title.trim() || !proposal.rationale.trim() || proposal.paths.length === 0) {
      throw new Error(`Copilot group ${index + 1} is incomplete`);
    }
    const groupFiles = proposal.paths.map((path) => {
      const file = byPath.get(path);
      if (!file) throw new Error(`Copilot returned an unknown path: ${path}`);
      if (seen.has(path)) throw new Error(`Copilot returned a duplicate path: ${path}`);
      seen.add(path);
      return file;
    });
    groups.push({
      id: `copilot-${index}-${slug(proposal.title) || "group"}`,
      title: proposal.title,
      rationale: proposal.rationale,
      source: "copilot",
      files: groupFiles
    });
  }

  const missing = files.filter((file) => !seen.has(file.path));
  if (missing.length > 0) {
    groups.push({
      id: "copilot-unassigned",
      title: "Not assigned by Copilot",
      rationale: `${missing.length} changed file${missing.length === 1 ? " was" : "s were"} not covered by the semantic grouping response`,
      source: "copilot",
      files: missing
    });
  }
  return groups;
}
