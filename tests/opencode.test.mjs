// The OpenCode adapter's mapping covers every Claude tool or agent name the
// skill instructions use, the way tests/copilot.test.mjs covers the Copilot
// mapping. Mappings under references/ are not skill instructions, so they are
// excluded from the using side.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { opencodeMapping } from "../plugins/pstack/opencode/index.ts";

const skillsDir = fileURLToPath(new URL("../plugins/pstack/skills", import.meta.url));

function instructionFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "references") found.push(...instructionFiles(full));
    } else if (entry.name.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

const skillText = instructionFiles(skillsDir).map((full) => [relative(skillsDir, full), readFileSync(full, "utf8")]);

// [term used by skill instructions, text the mapping must contain]
const TERMS = [
  ["the `Agent` tool", "`subagent`"],
  ["the `Skill` tool", "`skill`"],
  ["AskUserQuestion", "question"],
  ["TaskCreate", "todo"],
  ["TodoWrite", "todo"],
  ["subagent_type", "subagent_type"],
  ["run_in_background", "run_in_background"],
  ["general-purpose", "`general`"],
  ["pstack:poteto-agent", "pstack:poteto-agent"],
  ["pstack:comment-sicko", "`comment-sicko`"],
  ["pstack:thermo-nuclear-review-subagent", "thermo-nuclear-review-subagent"],
  ["pstack:thermo-nuclear-code-quality-review-subagent", "thermo-nuclear-code-quality-review-subagent"],
  ["`loop`", "`loop`"],
  ["@<level>", "`@<level>`"],
  ["reasoning_effort", "effort"],
  ["MCP", "MCP"],
];

describe("opencodeMapping coverage", () => {
  for (const [term, row] of TERMS) {
    const users = skillText.filter(([, text]) => text.includes(term)).map(([rel]) => rel);
    test(`${term} (${users.length} files) has an OpenCode mapping`, () => {
      if (users.length) expect(opencodeMapping).toContain(row);
    });
  }
});
