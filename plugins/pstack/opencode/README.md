# pstack for OpenCode

An [OpenCode V2 plugin](https://opencode.ai/v2/docs/build/plugins) that runs the shared pstack skills. It reads `../skills/` at load time instead of copying it into `~/.agents/skills`, so a `git pull` from upstream is reflected on the next OpenCode session with nothing to regenerate.

This directory is port-owned. Upstream has no `opencode/` folder, so a sync never touches it — the same arrangement as [`../pi/`](../pi/).

## What it registers

| OpenCode surface | Source |
| --- | --- |
| Skills | every `../skills/<id>/SKILL.md`, live. `principle-*` leaves register with `autoinvoke: false`, so they stay internal instead of appearing in the model's skill list (the tradeoff the `~/.agents/skills` install documents). |
| Commands | one `/pstack/<id>` per public skill (present in the session's command list). |
| Routing | the [`../hooks/session-start-context.md`](../hooks/session-start-context.md) mandate, pushed on every model request through the session `context` hook. This is OpenCode's equivalent of the Claude Code / Codex / Copilot SessionStart hook, and it survives compaction. |
| Model sheet | the role lines of `$XDG_CONFIG_HOME/opencode/pstack-models.md` (default `~/.config/opencode/pstack-models.md`), plus a short Claude-to-OpenCode tool/agent mapping. The sheet's `session hook: off` line turns the injection off. |

The plugin has **no dependencies**. V2 reads `id` and `setup` off the default export, so it loads from a bare checkout with no `node_modules` to install.

## Install

Add the plugin to `opencode.json` (global `~/.config/opencode/opencode.json`, or a project config):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/pstack-claude/plugins/pstack/opencode"
  ]
}
```

Restart the service after the first install: `opencode service restart`. OpenCode watches the plugin file afterwards, so later edits reload on their own.

With no options the plugin resolves the skills tree and the mandate from its own location (`../skills`, `../hooks`). Override any path with the object form:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/pstack-claude/plugins/pstack/opencode",
      "options": {
        "skillsDir": "/absolute/path/to/pstack-claude/plugins/pstack/skills",
        "mandateFile": "/absolute/path/to/pstack-claude/plugins/pstack/hooks/session-start-context.md",
        "rolesFile": "/absolute/path/to/pstack-claude/plugins/pstack/models.json",
        "sheetFile": "/home/me/.config/opencode/pstack-models.md",
        "commands": true,
        "route": true
      }
    }
  ]
}
```

Because the plugin already loads the model sheet, you do **not** need the `instructions` entry for `pstack-models.md`. Remove it if you added one, so the sheet is not injected twice.

## Model sheet

Run the `setup-pstack` skill to write `$XDG_CONFIG_HOME/opencode/pstack-models.md` (default `~/.config/opencode/pstack-models.md`). To list models, use the session's `models` command. Role values are OpenCode `provider/model` ids.

## Agents

OpenCode's plugin API cannot add agents — its `AgentEditor` has no `add`, only `update` and `remove`. So the plugin does not ship the pstack agents (`poteto-agent`, `comment-sicko`, the effort agents). Instead it injects a mapping: where a skill names `subagent_type: "pstack:poteto-agent"` or `general-purpose`, use OpenCode's `general` subagent; a read-only reviewer or explorer uses `explore`.

To get closer fidelity, drop OpenCode-format agent files into `~/.config/opencode/agents/`. That directory is OpenCode's own global agent location, not `~/.agents/skills`. Each file needs `mode: subagent` and a `description`; the body becomes its system prompt.

## Verify

```shell
bun selftest.mjs
```

checks the frontmatter reader, the live skill/sheet parsing against the real tree, and a mocked `setup` run. It needs no install.

## Not verified

Delegation-heavy workflows (`arena`, `architect`, `interrogate`, `swarm`, `how`, `why`) have not been run through on OpenCode, and the effort levels map to nothing there because OpenCode subagents do not take a per-call reasoning effort.
