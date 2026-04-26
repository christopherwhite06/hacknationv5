# Spark City Wallet Demo Runbook

Use this checklist before showing the hackathon demo.

## Validate First

Run:

```bash
npm run smoke:full
```

The smoke test must confirm:

- Demo Payone demand and demo merchant campaigns are labelled as degraded/demo connectors.
- Hermes/Gemini and Local Gemma show adapter-ready/degraded status unless a live runtime is actually probed.
- Stuttgart does not reuse Royal Holloway event data before a Stuttgart event adapter is configured.
- QR issue, redemption validation, daily cap rejection, and aggregate analytics all work.
- Raw private graph export is rejected by the API because export is device-only.

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
- Checkout: accept creates a one-time token, redeem validates it, analytics update in aggregate.
- Merchant side: rule source, discount cap, daily cap, event intelligence, and measured checkout conversion.
- Privacy: raw graph, routine, preferences, and precise movement stay local; cloud receives only abstract intent and public context.

## Do Not Hide Blockers

If credentials or infrastructure are missing, leave the visible `not configured`, `degraded`, or setup error state on screen. Do not narrate missing data as live.
