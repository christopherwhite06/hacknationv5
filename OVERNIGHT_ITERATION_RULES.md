# Overnight Iteration Ground Rules

Use these rules before starting any long-running autonomous iteration for the Generative City-Wallet project.

## Primary Goal
Keep the current working MVP as the foundation and improve it for a hard 6-hour wall-clock loop. Do not restart the project, replace the architecture, or chase speculative rewrites. Build from the current app, server, data model, and UX.

## Hard Six-Hour Loop Contract
- The loop must run until the physical wall-clock end time has passed.
- At startup, calculate `loopStartedAt` and `loopEndsAt = loopStartedAt + 6 hours`.
- Do not stop early because the initial roadmap is complete.
- If a planned task finishes early, immediately research the brief, inspect the repo, identify the next highest-impact improvement, create fresh todos, and continue.
- Continue research -> todo creation -> implementation -> validation -> commit -> push cycles until `loopEndsAt` has passed.
- After `loopEndsAt` has passed, finish the current in-progress task cleanly, validate it, commit/push if appropriate, then stop. Do not start a new cycle after the end time.
- Each cycle should include some discovery, not just coding from the previous plan. Use the brief, current code, UI gaps, validation failures, and smoke-test results to generate the next todos.
- If blocked by credentials or external services, document the blocker in the app/docs/tests and continue with another real, non-fake improvement.

## Source of Truth
- Read `HACKATHON_BRIEF.md` first.
- Treat the brief as the judging target.
- Every iteration should improve one or more brief requirements: context sensing, dynamic offer generation, checkout/redemption, merchant-side controls, UX clarity, privacy, or demo readiness.

## Reality Rules
- Keep features real as much as possible.
- Do not add fake static offers, fake locations, fake weather, fake events, fake AI decisions, or fake merchant data.
- If a feature cannot be real without credentials or infrastructure, show a clear unavailable/config-needed state.
- Demo/simulated data is allowed only where the brief explicitly permits it, especially simulated Payone transaction density and simulated checkout/payment rails.
- Any simulated/demo connector must be visibly labelled in the UI and API output.
- Do not silently fall back to invented data.

## Preserve The Current MVP
- Preserve the working base MVP and improve it incrementally.
- Keep Google Maps/location behavior, local graph persistence, authentication gating, merchant mode, event intelligence, redemption, and offer generation working.
- Prefer small validated improvements over large rewrites.
- Do not remove working features unless replacing them with a clearly better, tested implementation.

## Iteration Quality Bar
Each major iteration should:
- Start by creating or updating todos based on fresh research/inspection.
- Improve user-visible value or judge-visible completeness.
- Keep customer and merchant flows connected.
- Preserve end-to-end flow: context detection -> offer generation -> accept/decline -> QR/token -> redemption -> merchant analytics.
- Improve evidence, privacy clarity, or UX comprehension where possible.
- Run validation before committing.

## Research Expectations
During the 6-hour loop, repeatedly research and inspect:
- The hackathon brief and judging criteria.
- Current app gaps versus the required modules.
- Relevant implementation files and smoke-test coverage.
- Live-data honesty and fake-fallback risks.
- UX clarity for the first 3 seconds of an offer.
- Merchant-side usefulness and supply-side completeness.
- Privacy/GDPR messaging and local-only boundaries.

## Validation Before Each Commit
Before each major commit:
- Check `git status`.
- Inspect the diff.
- Run `npm run typecheck`.
- Run server syntax checks when `server/dev-api.js` changes.
- Run endpoint smoke tests when API behavior changes.
- Confirm no obvious fake/unlabelled fallback paths were introduced.

## Git Rules
- Commit and push after each major validated iteration if the user explicitly starts the overnight agent with commit/push permission.
- Do not update git config.
- Do not use destructive git commands.
- Do not force push.
- Do not skip hooks.
- Do not add `Co-authored-by` trailers.
- If an automatic environment trailer appears, never add a coauthor trailer manually.

## Privacy Rules
- Raw user graph, precise movement history, preferences, and routine data stay local.
- Cloud calls may receive abstract intent and non-personal public context only.
- Be honest in the UI about what stays local, what leaves the device, and what is simulated.

## Six-Hour Focus
Prioritize:
- Demo/readiness polish for the hackathon story.
- Real context visibility and source evidence.
- Merchant dashboard depth.
- Offer card clarity and 3-second comprehension.
- Robust checkout/redemption.
- Clustered knowledge graph clarity.
- Repeatable smoke tests and scenario scripts.
