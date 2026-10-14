# pi-rename2

Specific session titles for [Pi](https://pi.dev). Name a new session automatically, or run `/rename` when the conversation has become clearer.

- Uses your current session model and existing sign-in.
- Describes the whole-session theme, including investigations and exploration.
- Aims for concrete titles you can recognize later, not labels like "Fixing issue".
- Adds no tools, chat messages, or agent turns.

## Commands

| Command | What it does |
| --- | --- |
| `/rename` | Generate and save a title immediately. |
| `/rename <title>` | Save your exact title without calling a model. |

Titles use the session's main language, fit on one line, and are at most 80 characters. A project prefix appears only when the conversation supports it.

Run `/rename` again to ask for a meaningfully different title. Each call makes one model request and includes the current title and up to five recent generated titles as examples to avoid. A model can still return the same title. There are no automatic retries and no cross-session uniqueness check.

## Automatic naming

In Pi's interactive terminal UI, a fresh unnamed session gets a title after its first completed user-triggered agent run. Naming runs in the background, so it does not hold up the main reply or add another agent turn.

Automatic naming does not replace an existing title, rename a resumed conversation, run again after reload, or run in RPC, print, or JSON mode. Forked and cloned conversations are not treated as fresh sessions. Ordinary noninteractive subagents are excluded too.

The extension makes one automatic attempt. If that attempt fails, the title stays unchanged; run `/rename` to try again.

## Try it without installing

Requires Node.js 22.19 or later and Pi 1.2.0 or later. Tested with Pi 1.2.0; older package namespaces are not supported.

From a local checkout:

```bash
pi --extension ./src/extension.ts
```

This loads the extension for that Pi process only. It does not add it to global settings. Existing extensions with a `/rename` command may conflict; do not load both.

## Install

Install from npm:

```bash
pi install npm:pi-rename2
```

Or install from GitHub:

```bash
pi install git:github.com/vadim-kovalyov/pi-rename2
```

For a personal installation from a reviewed local checkout:

```bash
pi install .
```

Use `/reload` if Pi is already running. Loading the extension into an existing conversation does not automatically rename that conversation; use `/rename`.

Remove an npm installation with:

```bash
pi remove npm:pi-rename2
```

For Git or local installations, pass the same source used for installation to `pi remove`. Run `/reload` afterward.

## Privacy and model cost

Naming sends Pi's current context to the selected model and provider using your existing credentials. This can include system instructions, tool output, images, and retained reasoning. Existing compaction and context edits are respected; discarded history is not restored.

The temporary title instruction and reply are not saved in the conversation. Only the title and small naming metadata are saved. No tools are executed, and there is no telemetry.

Naming consumes model quota and is not included in Pi's main token totals. Main-request-only redaction or filter hooks are not replayed; do not rely on them to sanitize naming requests.

### Prompt-cache reuse

The extension preserves the structured message prefix and session cache identity, appending a title instruction. It uses the provider's normal cache policy and a separate SSE request where supported.

Cache hits are not guaranteed. Provider support, expiry, routing, reasoning settings, and request-time changes can prevent reuse. A cold cache processes the full context.

## Failure handling

The naming request has a 180-second deadline. Timeouts, unavailable credentials, insufficient context space, provider errors, tool requests, and incomplete or unusable titles leave the old title intact. Errors are brief and do not expose raw provider responses. The transient status is cleared when work finishes or is cancelled.

If naming fails:

1. Check that a model is selected and works in the main session.
2. Resolve sign-in or provider access through Pi's normal controls.
3. Run `/rename`, or use `/rename <title>` without a model call.

An empty conversation cannot be named from context. Literal titles still work without a model request or available context space.

## Development

```bash
npm ci --ignore-scripts
npm run check
```

`npm run check` runs strict TypeScript checks, Biome, and offline tests. `npm run format` applies formatting and safe lint fixes.

Tests use synthetic conversations and mocked model responses, including Pi session and cache-prefix checks. They do not read your personal settings or contact providers.

The implementation has two small parts:

- `src/naming.ts`: title instructions and validation.
- `src/extension.ts`: context snapshots, Pi commands, lifecycle hooks, and persistence.

CI runs the same checks on Node.js 22 and 24. It does not publish packages or need provider secrets.

## Release checklist

1. Run `npm ci --ignore-scripts` and `npm run check`.
2. Update the version and lockfile, and review the source and documentation.
3. Run `npm pack --dry-run --ignore-scripts` and inspect the package contents.
4. Publish with `npm publish --access public --ignore-scripts` and create the matching release tag.

## License

MIT. See [LICENSE](LICENSE).
