# Overnight Iteration Ground Rules

Use these rules before starting any long-running autonomous iteration for the Generative City-Wallet project.

## Primary Goal
Keep the current working MVP as the foundation and improve it over roughly 6 hours of focused iterations. Do not restart the project, replace the architecture, or chase speculative rewrites. Build from the current app, server, data model, and UX.

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
- Improve user-visible value or judge-visible completeness.
- Keep customer and merchant flows connected.
- Preserve end-to-end flow: context detection -> offer generation -> accept/decline -> QR/token -> redemption -> merchant analytics.
- Improve evidence, privacy clarity, or UX comprehension where possible.
- Run validation before committing.

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
