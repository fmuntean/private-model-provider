# Private Model Provider – CLI Status

## Current Status

The current package does **not** ship a command-line interface.

Evidence in the current implementation:

- `package.json` has no `bin` entry.
- `package.json` has no `cli` script.
- No `src/cli.ts` or equivalent executable entry point exists.
- The VSIX `files` list includes `out`, `PromptTemplates`, `assets`, `src/ui/assets`, and top-level metadata, but no CLI entry.

The previous CLI manual described planned behavior that is not implemented in this repository version.

## Available Ways to Use the Extension

Use one of the implemented surfaces instead:

1. **VS Code language model provider** through vendor ID `private-model-provider`.
2. **Private Model sidebar chat** through the **Private Model** activity container and `LMP` view.
3. **Command palette actions** such as model selection, server switching, stats, refresh, and connection testing.

## Future CLI Requirements

If a CLI is added later, it should include:

- A `bin` entry in `package.json`.
- A TypeScript source entry such as `src/cli.ts`.
- Build/package updates so the executable is included in VSIX/npm output.
- Configuration loading that does not depend on live VS Code APIs.
- API key support through environment variables or a documented keychain strategy.
- Tests or at least compile coverage for the CLI path.

Until then, do not document `private-model-cli`, `npx private-model-cli`, or `npm run cli` as available commands.
