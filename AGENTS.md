# Canvas LMS for Agents

- Goal: Korea University read-only Canvas/LearningX plugin for Codex and Claude Code, in Korean. Keep it independent of Syllo's hosted service/UI.
- Read README.md, docs/design.md and docs/verification.md before changing behavior. Run `git status --short`; preserve existing changes.
- Runtime: Node 24+, ESM. `src/` is shared runtime, `plugin/` is the small installable package. Do not put node_modules or credentials in the plugin.
- Run `npm test` and `npm run check`. Test network behavior with synthetic injected fetch, not student fixtures. `scripts/verify-live.mjs` is explicit opt-in and downloads a real PDF using local credentials.
- After runtime edits run `npm run build` and commit `plugin/dist/server.mjs`; installed copies execute this bundle. PDF engine dependencies use `plugin/pdf-runtime/package-lock.json` for first-use installation. Keep first-use setup free of manual clone/npm steps.
- Never log or commit tokens, cookies, signed URLs, student records or course files. Do not send school PAT to storage/LearningX. Maintain URL allowlists, access checks on cache hits, account isolation and atomic writes.
- Every school write, external email or publication must follow the user's scope. The product itself has no LMS mutation tools; LTI authentication POST is permitted for reads.
- Use the actual Git common directory's agent-context.md for local handoff. Keep verification evidence truthful; docs from Syllo are references, not proof of this plugin's behavior.
