# Spark City Wallet MVP

An end-to-end mobile MVP for the Generative City Wallet challenge.

The app demonstrates:

- A configurable context sensing layer using live weather, device location, time, local event, and Payone transaction-density signals.
- A private on-device knowledge graph that is sent only to a local Gemma runtime.
- A real Hermes Agent endpoint for Gemini-powered deal discovery using only non-personal intent and context.
- Dynamically generated wallet offers with copy, discount, timing, channel, and visual metadata.
- QR/token redemption with backend checkout validation and aggregate merchant analytics.
- Persistent account/session onboarding, a wallet ledger, merchant campaign rules, and privacy controls for the local graph.
- A simple financial-services-inspired interface using red primary actions, white wallet cards, and compact three-second offer facts.
- A Google Maps interface where Spark hovers around the map, displays generated deals through a speech bubble, and speaks them aloud through local device text-to-speech.
- A Google Calendar routine sync that cold-starts the local knowledge graph with schedule and location habits.
- Time/location routine prompts where Spark asks for consent before Gemma searches the local graph and Hermes/Gemini finds a task-specific deal.
- Light and dark UI modes.
- A private knowledge graph tab where users can watch Spark traverse their graph live.
- A profile area with avatar, account details, settings, and login/create-account forms.
- A branded in-app splash screen using the Spark brain-wallet lightning logo mark.

The app intentionally has no fake data path and no fallback cache. Missing runtime configuration is shown as a setup error.

## Required Environment

Set these before running the app:

```bash
EXPO_PUBLIC_CITY_WALLET_API_URL=https://your-city-wallet-api.example
EXPO_PUBLIC_OPENWEATHER_API_KEY=your-openweathermap-key
EXPO_PUBLIC_HERMES_AGENT_URL=https://your-hermes-agent-gateway.example
EXPO_PUBLIC_GEMINI_API_KEY=your-gemini-api-key
EXPO_PUBLIC_LOCAL_GEMMA_URL=http://127.0.0.1:11434
EXPO_PUBLIC_LOCAL_GEMMA_MODEL=gemma4:e4b
EXPO_PUBLIC_CITY_WALLET_USER_ID=real-user-id
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your-google-android-oauth-client-id
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-google-web-oauth-client-id
```

Required live endpoints:

- `GET /users/:userId`
- `POST /accounts`
- `POST /sessions`
- `POST /integrations/google-calendar/sync`
- `GET /users/:userId/ledger`
- `GET /merchants/nearby?lat=&lon=`
- `POST /merchants/:merchantId/rules`
- `GET /events/nearby?lat=&lon=`
- `GET /payone/transaction-density?merchantIds=`
- `POST /offers/generate`
- `POST /redemptions/issue`
- `POST /redemptions/:tokenId/validate`
- `GET /merchants/:merchantId/analytics`
- `GET /connectors/health`
- `DELETE /privacy/graph`

Required local Gemma endpoint through Ollama:

- `POST /api/chat`

Required Hermes endpoint:

- `POST /tasks`

## Run

```bash
npm install
npm run typecheck
npm run smoke:api
npm run web
```

For native testing, use:

```bash
npm run android
npm run ios
```

On Windows, an Android emulator named `CityWalletPixel` is configured. To reopen the phone simulator later:

```bash
npm run api
npm run emulator
npm run android:phone
```

## Repeatable Smoke Checks

Run the local API smoke test before demo-critical changes:

```bash
npm run smoke:api
```

The smoke test starts `server/dev-api.js` on an isolated local port with clearly labelled demo Payone demand and demo merchant supply enabled. It validates connector health, merchant manual rate influence on generated offers, context-responsive offer theming, QR/token issue and validation, and aggregate merchant analytics.

For emulator inspection, use the `Demo` tab as the judge-facing checklist, then test Egham/Stuttgart/current GPS from `Map` -> `Simulate`.

For the full judge-day checklist, see `DEMO_RUNBOOK.md`.

## Demo Flow

1. Open the `Map` tab to see Google Maps and Spark's generated deal popup.
2. Open the `Graph` tab to see the private knowledge graph and Spark's live traversal.
3. Open the `Routine` tab to sync Google Calendar and let Spark create consent-based time/location prompts.
4. Say yes to a Spark routine question to run local Gemma against the graph and Gemini/Hermes against the web.
5. Open the `Offer` tab to view the dynamically generated offer card.
6. Accept the offer to create a one-time QR token.
7. Validate merchant checkout on the `Redeem` tab.
8. Open the `Wallet` tab to see offer history, cashback, and connector health.
9. Open the `Profile` tab to create an account or adjust settings.
10. Open the `Merchant` tab to edit rules, preview campaign limits, and review aggregate metrics.

## UX Requirements

- **Interaction location**: the generated offer appears as a popup over Google Maps and can also be opened as a full wallet card.
- **Addressing style**: the offer uses generated situational framing based on the live context.
- **First 3 seconds**: merchant, distance, product, cashback, and expiry are visible in compact facts.
- **Ending state**: accept creates a QR token, redemption confirms cashback, and dismiss updates analytics without breaking the wallet flow.
- **Closed loop**: the demo must show context detection, offer generation, display, accept or decline, simulated checkout, ledger update, and merchant analytics.

## Hackathon Submission Guidance

Strong submissions should demonstrate real context in action. Use a concrete scenario such as rain, nearby location, a quiet merchant, and low transaction volume, then show Spark generating a specific plausible offer rather than a static coupon.

The experience should be understood in three seconds. The offer card and map popup should make the merchant, product, benefit, expiry, and reason visible through clear hierarchy and compact language.

The flow must stay connected from end to end: context detection, local intent, Hermes/Gemini deal discovery, generated offer, accept or decline, QR checkout, wallet ledger, and merchant analytics. A partial but connected flow is stronger than a polished isolated mockup.

Do not over-index on model architecture at the expense of the interaction. The challenge is won through the customer and merchant experience, with AI supporting timing, relevance, and supply-side responsiveness.

The merchant side is required, not optional. City Wallet needs supply, so merchant rule creation, discount caps, quiet-hour goals, campaign preview, and aggregate analytics are part of the core product.

Weak submissions tend to show beautiful static dummy offers, ignore the merchant perspective, skip checkout/redemption, or treat privacy as an afterthought.

## Why This Matters

The decline of inner-city retail is a structural threat to local economies and to the regional model of savings banks embedded in those communities. Traditional loyalty programmes and static coupon books have not solved it, while global e-commerce platforms already use dynamic pricing, demand signals, and algorithmic personalization.

DSV Gruppe, as part of the German Savings Banks Financial Group, sits at the intersection of Payone payments infrastructure, merchant portals such as S-Markt & Mehrwert, and regional banking relationships. That position makes it possible to build something global e-commerce cannot easily copy: an AI layer that understands local context, respects privacy by design, and helps local merchants respond to demand as quickly as a marketplace algorithm.

## Privacy Boundary

The local graph represents raw habits, offer history, movement, and preferences. The cloud-agent path receives only abstract intent, coarse city context, merchant category, and non-personal context signals.

For GDPR, the intended posture is explicit consent, on-device inference for raw behavior, data minimization before cloud calls, user-visible graph controls, device-only export/delete actions, and aggregate-only merchant analytics.
