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

Titles are English, single-line ASCII, usually 5-10 words, and at most 80 characters. A project prefix appears only when the conversation supports it.

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

After the package is published to npm:

```bash
pi install npm:pi-rename2
```

Alternatively, after the source has been pushed to this repository:

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

Naming sends a separate request to the same selected model and configured provider as the session. It uses Pi's authentication and provider routing.

Naming is an isolated continuation of Pi's current projected context, not a new chat containing a flattened summary. The request preserves the structured transcript and appends a temporary instruction to output only a title. The instruction also includes the working-directory basename, current title, and up to five recent generated titles.

The snapshot includes the system instructions and tool declarations stored in the transcript, user/assistant messages, tool calls and results, images, model-visible extension messages, and provider reasoning/signature blocks already present in the projected context. Pi's normal message conversion preserves compaction and branch summaries. Context edits and omissions are honored; separate abandoned branches and history replaced by compaction are not restored.

This is broader input than a chat-text-only summary. Tool output, images, system instructions, and retained summaries may contain sensitive information. The snapshot is Pi's session projection. Request-only transformations from other extensions or settings are not replayed by this direct request. Do not rely on a main-request-only redaction/filter hook to sanitize naming requests.

### Prompt-cache reuse

The request keeps the original message order, system checkpoints, tool schemas, and session cache identifier. Only the final naming instruction is new. For older imported sessions without a stored system checkpoint, it prepends Pi's current system prompt as a fallback. The extension no longer requests `cacheRetention: "none"`; Pi's provider default and environment cache settings apply.

Keeping that prefix and cache identity gives providers an opportunity to reuse an existing prompt/KV cache. It does not guarantee a cache hit: support, cache lifetime, routing, reasoning settings, and request-time transformations can affect reuse. The newest assistant reply may not yet be cached as input. Cached input can still cost money, and a cold cache requires processing the full request. The title call uses minimal reasoning to keep generation small, which may reduce reuse on providers whose caches depend on reasoning settings.

For providers that support transport selection, the title request uses SSE so it does not branch a stateful WebSocket connection used by the main conversation. Tool schemas remain available for prefix compatibility, but the extension never executes tools or starts an agent loop. A tool-call response is rejected, even if it also contains text.

The snapshot is deep-copied in memory. The temporary instruction and generated reply are never appended to the conversation, and no session clone is written to disk. Only the accepted title and small naming metadata are persisted.

There is no telemetry, external title service, repository scan, or search through other sessions. Project names from your own conversation can appear in its runtime title. The published code and tests use only synthetic examples.

Titles and small extension metadata are saved through Pi's session APIs. Metadata includes whether automatic naming was attempted and the last five generated titles. It is not injected into the main model context. Naming requests consume model quota and may cost money. Their usage is not added to Pi's main session token totals by this extension.

## Failure handling

The naming request has a 30-second deadline. Timeouts, unavailable credentials, insufficient context space, provider errors, tool requests, and incomplete or unusable titles leave the old title intact. Errors are brief and do not expose raw provider responses. The transient status is cleared when work finishes or is cancelled.

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

Tests use synthetic conversations and mocked model responses. They exercise Pi's real session projection, load the extension through Pi's resource loader, and run an isolated SDK session with an intercepted model runtime. The SDK test verifies that ordinary and naming requests share the same structured prefix and cache identity without changing the live conversation. Tests do not load your personal agent settings or contact providers. Actual cache-hit rates and latency require separate, explicitly approved live testing.

The implementation has two small parts:

- `src/naming.ts`: context selection, prompt construction, and title validation.
- `src/extension.ts`: Pi commands, lifecycle hooks, persistence, cancellation, and notifications.

CI runs the same checks on Node.js 22 and 24. It does not publish packages or need provider secrets.

## Release checklist

1. Review the source, README, license, and package contents. Confirm no private material is included.
2. Run `npm ci --ignore-scripts` and `npm run check`.
3. Test temporarily in Pi using a synthetic conversation. Live model tests consume quota.
4. Check npm name availability again, select the release version, and update the lockfile if the version changes.
5. Commit and push only after review and explicit approval.
6. Run `npm pack --dry-run --ignore-scripts` and inspect the file list.
7. Publish with `npm publish --access public --ignore-scripts` only after separate approval, then create the matching release tag.

The repository contains no automated publishing workflow. Installation, source publication, and npm publication are separate actions.

## License

MIT. See [LICENSE](LICENSE).
