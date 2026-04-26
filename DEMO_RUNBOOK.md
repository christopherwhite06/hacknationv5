# Spark City Wallet Demo Runbook

Use this checklist before showing the hackathon demo.

## Validate First

Run:

```bash
npm run smoke:full
```

The smoke test must confirm:

- Demo Payone demand and demo merchant campaigns are labelled as degraded/demo connectors.
- Open-Meteo, Royal Holloway events, and OpenStreetMap show adapter-ready/degraded status until live context loading exercises them.
- Hermes/Gemini and Local Gemma show adapter-ready/degraded status unless a live runtime is actually probed.
- QR proof secret health is visible; local dev fallback is labelled degraded until `CITY_WALLET_QR_PROOF_SECRET` is configured.
- Stuttgart and current-GPS event evidence show config-needed source labels instead of reusing Royal Holloway event data.
- Payone density returns labelled `payone_demo` signals only when the demo connector is enabled, and no demand signal otherwise.
- Duplicate account emails/usernames, including case-only and whitespace-only username duplicates, wrong passwords, zero-value or inverted event rates, and invalid merchant rule schemas are rejected before the demo flow starts.
- QR issue, generated-offer expiry checks, expired accept/redeem UI blocking, coupon-code and cashback-amount match validation, full scanned-token payload proof validation, tampered/incomplete QR rejection, replay rejection, no-user-id QR payload, daily cap rejection, idempotent decline counting, and aggregate analytics all work.
- Raw private graph export/delete is rejected by the API because graph controls are device-only.

## Emulator Path

On Windows:

```bash
npm run api
npm run emulator
npm run android:phone
```

Use `Map` -> `Simulate` to test:

- `Royal Holloway / Egham`: live weather, OSM merchants, Egham-scoped events, labelled demo Payone demand if enabled.
- `Stuttgart old town`: live weather and OSM merchants; event signal should stay config-needed until a Stuttgart adapter is connected.
- `Current GPS`: device GPS source labels and no fake location fallback.

## Judge Story

Start on the `Demo` tab and show `Brief Coverage Evidence`. It should connect:

- Context sensing: weather, device/map location, time, events when configured, and Payone/demo demand labels.
- Generative offer: merchant guardrails plus generated copy, theme, CTA, timing, and source evidence.
- Checkout: accept creates a one-time token only while the generated offer is still valid; QR proof has no user ID, redeem checks the scanned proof, analytics update in aggregate.
- Merchant side: rule source, discount cap, daily cap, event intelligence, and measured checkout conversion.
- Privacy: raw graph, routine, preferences, and precise movement stay local; cloud receives only abstract intent and public context; graph pause visibly stops reuse for deal discovery and labels checkout outcomes as not written to local memory.

## Do Not Hide Blockers

If credentials or infrastructure are missing, leave the visible `not configured`, `degraded`, or setup error state on screen. Do not narrate missing data as live.
