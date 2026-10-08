# Agent team: boss, developer, reviewer, qa

Four Claude Code subagents that work as a small dev team:

| Agent | Role | Edits code? |
|---|---|---|
| `boss` | Plans, delegates, loops until review and QA pass, reports status | No |
| `developer` | Implements tasks and their tests | Yes |
| `reviewer` | Reviews the diff for bugs, security, and maintainability; gives APPROVE / REQUEST CHANGES | No (read-only) |
| `qa` | Writes a test plan, runs tests and the app, files bug reports; gives READY / NOT READY | Test files only |

Flow: **boss → developer → reviewer → (fix loop) → qa → (fix loop) → boss reports**.

## Usage

```bash
# Run the boss as the main session; it delegates to the others
claude --agent boss

# Or call one directly from a normal session
> Use the reviewer agent to review my current changes
> Use the qa agent to verify the signup flow
```

`Agent(developer, reviewer, qa)` in `boss.md` limits who the boss can delegate to. That limit only applies when the boss runs as the main thread (`claude --agent boss`). To make the boss the default for this repo, add `{"agent": "boss"}` to `.claude/settings.json`.

## Sources

These agents were adapted from the following public work. They were rewritten to be shorter and to hand work to each other:

- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) (MIT): `fullstack-developer`, `code-reviewer`, `qa-expert`, `multi-agent-coordinator`, `project-manager`
- [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents): file format, `Agent(...)` allowlist, `--agent`
- [ChatDev](https://github.com/OpenBMB/ChatDev): a "virtual software company" with CEO, CTO, programmer, reviewer, and tester roles
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT): product manager, architect, engineer, and QA roles that hand off documents in a fixed order (`Code = SOP(Team)`)

Other collections worth browsing: [wshobson/agents](https://github.com/wshobson/agents), [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code).
