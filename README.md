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

Requires Node.js 22.19 or later and Pi 1.5.0 or later. Tested with Pi 1.5.0; older package namespaces are not supported.

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

Naming reuses the session's message prefix and cache identity, so providers with prompt caching can often reuse cached input. Cache hits are not guaranteed.

## Failure handling

Naming has a 180-second deadline. On any failure the old title stays, and a warning ends with a short diagnostic line. For example:

```text
Rename diagnostics: stage=provider-response; hint=reasoning-option; http=400; maxTokens=256; stop=error; textBlocks=0; thinkingBlocks=0.
```

`stage` shows where it failed (`preflight`, `request`, `provider-response`, or `validation`). `hint` is a pattern-based guess such as `authentication`, `rate-limit`, `context-limit`, `connection`, or `reasoning-option`; `unknown` means check the server log. Diagnostics never include raw errors, credentials, URLs, model names, or conversation text, and nothing extra is written to disk.

If naming fails:

1. Check that a model is selected and works in the main session.
2. Resolve sign-in or provider access through Pi's normal controls.
3. Run `/rename`, or use `/rename <title>` without a model call.

## Development

```bash
npm ci --ignore-scripts
npm run check
```

`npm run check` runs strict TypeScript checks, Biome, and offline tests. `npm run format` applies formatting and safe lint fixes.

Tests use synthetic conversations and mocked model responses, including Pi session and cache-prefix checks. They do not read your personal settings or contact providers.

See [SPEC.md](SPEC.md) for the full behavior contract and module layout.

CI runs the same checks on Node.js 22 and 24. It does not publish packages or need provider secrets.

Maintainers: see [RELEASING.md](RELEASING.md).

## License

MIT. See [LICENSE](LICENSE).
