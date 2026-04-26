# Tech Video Script

Max length: 60 seconds

Goal: explain the architecture, stack, and implementation. Show diagrams first, then quickly show the relevant code files.

## Recommended Visuals

- `submission/diagrams/architecture.mmd`
- `submission/diagrams/context-to-redemption-flow.mmd`
- `submission/diagrams/privacy-ai-data-flow.mmd`
- `submission/diagrams/merchant-event-intelligence.mmd`

If you export the Mermaid diagrams as images, show them in the same order.

## Shot Plan

### 0-8s: Architecture Diagram

Show `submission/diagrams/architecture.mmd`.

Voiceover:

"Spark City Wallet is built in React Native and Expo with TypeScript. The mobile app talks to a City Wallet API, a local Gemma runtime, and a Hermes gateway for Gemini."

### 8-18s: Context Engine

Show `src/services/contextEngine.ts`.

Point to the context aggregation functions and source evidence handling.

Voiceover:

"The context engine combines location, time, weather, Google Places metadata, local events, merchant state, and transaction-density adapters into a composite state visible to the user."

### 18-28s: AI Stack

Show `src/services/aiStack.ts`.

Point to the Gemma branch and Hermes/Gemini branch.

Voiceover:

"Private intent can run through local Gemma. Public deal discovery runs through Hermes using Gemini 3.1 Pro Preview, Gemini 3.0 Flash Preview, or Gemini 3.1 Flash Lite Preview with only abstract intent and non-personal context."

### 28-38s: Knowledge Graph

Show `src/services/localKnowledgeGraph.ts`, then briefly show the app's advanced graph view.

Voiceover:

"The local knowledge graph stores routines, places, preferences, prompts, and offer outcomes on device. The advanced canvas lets users inspect clusters, nodes, and Spark's route through graph memory."

### 38-48s: Backend And Redemption

Show `server/dev-api.js`.

Point to offer generation, redemption issue/validate, event intelligence, and Hermes route sections.

Voiceover:

"The API handles accounts, merchants, event intelligence, generated offers, QR token issue, proof validation, replay protection, wallet ledger updates, and aggregate analytics."

### 48-56s: Merchant Intelligence

Show `submission/diagrams/merchant-event-intelligence.mmd`, then the business screen in the app.

Voiceover:

"Business mode gives merchants a radius map, live stats, local event refresh, Spark recommendations, campaign guardrails, active campaign status, and performance metrics."

### 56-60s: Close

Show the app map or final architecture diagram.

Voiceover:

"The result is a full context-to-checkout loop: live data, private AI intent, generated offer, QR redemption, and merchant feedback."

## Code References To Show

- `App.tsx`: app shell, screens, profile mode switching, map, graph, offer, QR, and merchant UI.
- `src/services/contextEngine.ts`: context sensing and source evidence.
- `src/services/aiStack.ts`: Gemini/Hermes and Gemma model paths.
- `src/services/localKnowledgeGraph.ts`: local graph updates and persistence.
- `src/services/cityWalletApi.ts`: mobile API client.
- `server/dev-api.js`: local API, live adapters, offers, redemptions, event intelligence, analytics, and Hermes gateway.

## Timing Tip

Do not read file names slowly. Show each file for about four seconds and describe what it proves.
