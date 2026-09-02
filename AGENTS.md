# Repository workflow

Every user-requested change must be delivered as a release unless the user explicitly asks for local-only work.

Before reporting the change complete:

1. Increment the plugin version in `manifest.json`, `package.json`, and `package-lock.json`.
2. Add the version to the release log in `README.md`.
3. Run the full test suite and production build.
4. Commit all files that belong to the change with a Conventional Commit message.
5. Push the commit to `origin/master`.
6. Create and push the matching `vX.Y.Z` tag so `.github/workflows/release.yml` publishes the GitHub release.
7. Verify the remote branch, tag, release workflow, and downloadable release assets before claiming completion.

Do not leave completed work only in a local worktree. Do not say a change is released when it has only been built, committed, or pushed without the version tag and successful GitHub release.
