# Releasing

1. Run `npm ci --ignore-scripts` and `npm run check`.
2. Update the version in `package.json`, `package-lock.json`, and `SPEC.md`. Review the source and documentation.
3. Run `npm pack --dry-run --ignore-scripts` and inspect the package contents.
4. Publish with `npm publish --access public --ignore-scripts` and create the matching release tag.
