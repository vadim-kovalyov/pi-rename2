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
| `/name` | Pi's built-in command; unchanged by this extension. |

Examples of generated titles:

```text
Device controller: investigate duplicate discovery
Session naming: design automatic title generation
Compare cancellation patterns for background workers
```

Titles are English, single-line ASCII, usually 5-10 words, and at most 80 characters. A project prefix appears only when the conversation supports it. Investigations should not be labeled as completed fixes.

Run `/rename` again to ask for a meaningfully different title. Each call makes one model request and includes the current title and up to five recent generated titles as examples to avoid. A model can still return the same title. There are no automatic retries and no cross-session uniqueness check.

Literal titles keep your wording and are not subject to the AI length limit. Surrounding whitespace is trimmed. Control characters and line breaks are rejected. Whitespace alone invokes AI naming.

## Automatic naming

In Pi's interactive terminal UI, a fresh unnamed session gets a title after its first completed user-triggered agent run. Naming runs in the background, so it does not hold up the main reply or add another agent turn.

Automatic naming does not replace an existing title, rename a resumed conversation, run again after reload, or run in RPC, print, or JSON mode. Forked and cloned conversations are not treated as fresh sessions. Ordinary noninteractive subagents are therefore excluded too.

The extension makes one automatic attempt. If that attempt fails, the title stays unchanged; run `/rename` to try again. Aborted or failed main replies do not trigger naming until a completed reply is available.

A manual title change cancels pending naming work. A newer `/rename` supersedes an older one. Session changes, tree navigation, reload, and shutdown also cancel pending work. An explicit AI rename submitted while the agent is busy waits for that run to finish before selecting conversation context.

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

Naming sends a separate request to the same selected model and configured provider as the session. It uses Pi's authentication and provider routing. It does not ask another provider, repair credentials, or fall back to another model.

Input contains:

- User and assistant text from the active conversation projection.
- Compaction summaries, honoring context edits and omissions.
- The working-directory basename as an optional hint, not the full path.
- The current title and up to five recent generated titles.

It excludes system instructions, hidden reasoning, raw tool calls and results, images, custom extension messages, and separate abandoned branches. A retained compaction summary may still describe earlier work. Chat text and summaries may contain sensitive information even when tool output is excluded.

Conversation excerpts are capped at 24,000 characters. Long inputs retain opening context, selected middle text or compaction summaries, and recent text in chronological order, with omissions marked. Selecting excerpts can miss details; a title is not a complete session summary.

There is no telemetry, external title service, repository scan, or search through other sessions. Project names from your own conversation can appear in its runtime title. The published code and tests use only synthetic examples.

Titles and small extension metadata are saved through Pi's session APIs. Metadata includes whether automatic naming was attempted and the last five generated titles. It is not injected into the main model context. Naming requests consume model quota and may cost money. Their usage is not added to Pi's main session token totals by this extension.

## Failure handling

The naming request has a 30-second deadline. Timeouts, unavailable credentials, provider errors, and unusable titles leave the old title intact. Errors are brief and do not expose raw provider responses. The transient status is cleared when work finishes or is cancelled.

If naming fails:

1. Check that a model is selected and works in the main session.
2. Resolve sign-in or provider access through Pi's normal controls.
3. Run `/rename`, or use `/rename <title>` without a model call.

An empty or image-only conversation may not contain enough text to name. Literal titles still work.

## Development

```bash
npm ci --ignore-scripts
npm run check
```

`npm run check` runs strict TypeScript checks, Biome, and offline tests. `npm run format` applies formatting and safe lint fixes.

Tests use synthetic conversations and mocked model responses. They also exercise Pi's real session projection and load the extension through Pi's actual resource loader with isolated settings. They do not load your personal agent settings or make provider requests.

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
