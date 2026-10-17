// OpenCode V2 adapter for pstack.
//
// This file is port-owned. It never edits the shared, upstream-synced skills
// tree under `../skills/`; it reads that tree at load time and registers it with
// OpenCode's plugin API. That keeps the port's OpenCode support in one place, so
// `git pull` from upstream cannot conflict with it.
//
// What it does on `setup`:
//   1. Registers every `../skills/<id>/SKILL.md` as an OpenCode skill, live, so a
//      pull that changes a skill is reflected without copying or re-generating.
//      `principle-*` leaves get autoinvoke off, so they stay internal instead of
//      cluttering the model's skill list (the tradeoff the `~/.agents/skills`
//      install documents).
//   2. Injects the poteto-mode routing mandate on every model request through the
//      session `context` hook, which is the OpenCode equivalent of the Claude
//      Code / Codex / Copilot SessionStart hook. Unlike a one-shot instruction it
//      survives compaction.
//   3. Injects the per-role model sheet (`~/.config/opencode/pstack-models.md`)
//      role lines and a short OpenCode tool/agent mapping, and honors the sheet's
//      `session hook: off` line.
//   4. Registers a `/pstack/<skill>` command per public skill.
//
// OpenCode's plugin API cannot add agents (`AgentEditor` has no `add`), so pstack
// subagent names resolve to OpenCode's built-in agents through the injected
// mapping instead of shipped agent files. See README.md.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")

// OpenCode reads its global config from `$XDG_CONFIG_HOME/opencode`, falling back
// to `~/.config/opencode`. The sheet lives beside that config, so resolve the same
// directory instead of hardcoding `~/.config`.
export function configHome(env: Record<string, string | undefined> = process.env): string {
  const xdg = env.XDG_CONFIG_HOME
  return xdg && xdg.trim() ? xdg : join(env.HOME ?? "", ".config")
}

export const defaultPaths = {
  skills: join(repoRoot, "plugins/pstack/skills"),
  mandate: join(repoRoot, "plugins/pstack/hooks/session-start-context.md"),
  roles: join(repoRoot, "plugins/pstack/models.json"),
  sheet: join(configHome(), "opencode", "pstack-models.md"),
}

// The Claude tool and agent names the shared skills are written in, mapped to
// OpenCode's. Kept short: the full vocabulary lives in the skills' own Models
// sections. `subagent_type` is the load-bearing part, because that is where a
// bare OpenCode id and a Claude plugin id diverge.
export const opencodeMapping = [
  "OpenCode adaptation (pstack):",
  "- Claude tool names map to OpenCode tools: `Skill` -> `skill`, `Agent` -> `subagent`, `AskUserQuestion` -> the session's question tool, `TaskCreate`/`TaskUpdate`/`TodoWrite` -> the session's todo tools, `Bash` -> `bash`, `Read`/`Edit`/`Write` -> `read`/`edit`/`write`.",
  "- Agent names map to OpenCode agent ids: `subagent_type: \"pstack:poteto-agent\"` and `general-purpose` -> `general`; a read-only reviewer or explorer -> `explore`.",
  "- Reasoning effort: OpenCode subagents do not take a per-call effort. Ignore an `@<level>` suffix and run at the session's effort.",
  "- Role model values in the pstack sheet above are OpenCode `provider/model` ids. Pass one as the `subagent` model when the runtime accepts it; otherwise inherit the parent.",
].join("\n")

interface Frontmatter {
  data: Record<string, string | boolean>
  body: string
}

// Minimal YAML frontmatter reader. pstack skills use only `name`, `description`,
// `user-invocable`, and `paths`, all single-line, so a full YAML parser is not
// needed and pulling one in would add a dependency to the port.
export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---")) return { data: {}, body: text }
  const lines = text.split("\n")
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i
      break
    }
  }
  if (end === -1) return { data: {}, body: text }
  const data: Record<string, string | boolean> = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (value === "true") data[key] = true
    else if (value === "false") data[key] = false
    else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      data[key] = value.slice(1, -1)
    } else {
      data[key] = value
    }
  }
  return { data, body: lines.slice(end + 1).join("\n").trim() }
}

export interface PstackSkill {
  id: string
  name: string
  description: string
  autoinvoke: boolean
  path: string
  content: string
}

// Reads every immediate `<skillsDir>/<id>/SKILL.md`. The id is the directory
// name, matching OpenCode's path-derived skill ids and the pstack skill name.
export function readSkills(skillsDir: string): PstackSkill[] {
  if (!existsSync(skillsDir)) return []
  const skills: PstackSkill[] = []
  for (const entry of readdirSync(skillsDir).sort()) {
    const dir = join(skillsDir, entry)
    if (!statSync(dir).isDirectory()) continue
    const file = join(dir, "SKILL.md")
    if (!existsSync(file)) continue
    const { data, body } = parseFrontmatter(readFileSync(file, "utf8"))
    skills.push({
      id: entry,
      name: typeof data.name === "string" && data.name ? data.name : entry,
      description: typeof data.description === "string" ? data.description : "",
      autoinvoke: data["user-invocable"] !== false,
      path: file,
      content: body,
    })
  }
  return skills
}

export interface Sheet {
  rows: string[]
  hookOff: boolean
  present: boolean
}

// Extracts the role lines the skills read, using models.json as the role
// allowlist so free text in the sheet never reaches the model context. Mirrors
// the Copilot hook's rebuild-from-checked-values behavior.
export function readSheet(sheetPath: string, rolesPath: string): Sheet {
  const empty: Sheet = { rows: [], hookOff: false, present: false }
  if (!existsSync(sheetPath)) return empty
  let roles: string[] = []
  try {
    const parsed = JSON.parse(readFileSync(rolesPath, "utf8")) as { roles?: { role: string }[] }
    roles = (parsed.roles ?? []).map((r) => r.role)
  } catch {
    return empty
  }
  const known = new Set([...roles, "default effort"])
  const rows: string[] = []
  let hookOff = false
  for (const raw of readFileSync(sheetPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "session hook: off") hookOff = true
    const index = line.indexOf(":")
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    if (known.has(key)) rows.push(line)
  }
  return { rows, hookOff, present: true }
}

export function readMandate(mandatePath: string): string {
  if (!existsSync(mandatePath)) return ""
  // On OpenCode skills load by bare id, so drop the Claude plugin namespace.
  return readFileSync(mandatePath, "utf8").replaceAll("pstack:", "").trim()
}

// No `@opencode/plugin` import: V2 reads `id` and `setup` off the default
// export, and `Plugin.define` is only a typed identity helper. Dropping it keeps
// the adapter dependency-free, so OpenCode can load this file straight from a
// checkout with no `node_modules` to install.
export interface OpenCodeContext {
  readonly options: unknown
  readonly skill: {
    transform(callback: (editor: { add(skill: PstackSkill): void }) => void): Promise<unknown>
  }
  readonly command: {
    transform(
      callback: (editor: { add(command: OpenCodeCommand): void }) => void,
    ): Promise<unknown>
  }
  readonly session: {
    prompt(input: { sessionID: string; text: string; delivery: "steer" | "queue" }): Promise<unknown>
    hook(
      name: "context",
      callback: (event: { system: { push(part: { type: "text"; text: string }): void } }) => void,
    ): Promise<unknown>
  }
}

export interface OpenCodeCommand {
  name: string
  description?: string
  execute(input: {
    sessionID: string
    prompt: { text?: string }
    delivery: "steer" | "queue"
  }): Promise<void>
}

export default {
  id: "pstack",
  async setup(ctx: OpenCodeContext) {
    const options = (ctx.options ?? {}) as {
      skillsDir?: string
      mandateFile?: string
      rolesFile?: string
      sheetFile?: string
      commands?: boolean
      route?: boolean
    }

    const skills = readSkills(options.skillsDir ?? defaultPaths.skills)
    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })

    if (options.commands !== false) {
      const runnable = skills.filter((skill) => skill.autoinvoke)
      await ctx.command.transform((editor) => {
        for (const skill of runnable) {
          editor.add({
            name: `pstack/${skill.id}`,
            description: skill.description,
            execute: async ({ sessionID, prompt, delivery }) => {
              const args = (prompt?.text ?? "").trim()
              const text = args
                ? `Load the \`${skill.id}\` skill and follow it.\n\n${args}`
                : `Load the \`${skill.id}\` skill and follow it.`
              await ctx.session.prompt({ sessionID, text, delivery })
            },
          })
        }
      })
    }

    const sheetPath = options.sheetFile ?? defaultPaths.sheet
    const sheet = readSheet(sheetPath, options.rolesFile ?? defaultPaths.roles)
    const mandate = readMandate(options.mandateFile ?? defaultPaths.mandate)

    if (options.route !== false && !sheet.hookOff && mandate) {
      const injected = [mandate, opencodeMapping]
      injected.push(
        sheet.rows.length
          ? ["pstack model configuration (from pstack-models.md):", ...sheet.rows].join("\n")
          : "pstack: no pstack-models.md sheet yet. Run the setup-pstack skill to choose role models.",
      )
      await ctx.session.hook("context", (event) => {
        for (const text of injected) event.system.push({ type: "text", text })
      })
    }

    return () => {}
  },
}
