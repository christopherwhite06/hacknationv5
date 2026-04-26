# Spark City Wallet Submission

## Upload Checklist

- Demo Video: record from `submission/demo-video-script.md` and export as MP4, max 60 seconds.
- Tech Video: record from `submission/tech-video-script.md` and export as MP4, max 60 seconds.
- Other Visuals: upload the diagrams in `submission/diagrams/` or export them as PNG/PDF.

## Event Details

Project Title: Spark City Wallet: An Agentic Living Wallet for Local Commerce

Event: 5th-hack-nation

Challenge: Generative City-Wallet (Agentic AI & Data Engineering)

Track: Agentic AI & Data Engineering

Program Type: VC Big Bets

## Short Description

Spark City Wallet is an AI-assisted city wallet that senses live local context, privately infers user intent, and generates time-limited merchant offers only when they are relevant. It combines Google Maps, live context signals, local graph memory, Gemini/Gemma AI, QR redemption, and merchant analytics into one end-to-end wallet flow.

## 1. Problem & Challenge

Local merchants struggle to react to the same live demand signals that large digital platforms use every minute: weather, location, opening status, local events, nearby demand, and user intent. Traditional coupons and loyalty offers are usually static, poorly timed, and disconnected from checkout, so they do not reliably help merchants fill quiet periods or give customers a useful reason to visit local businesses.

The challenge is to turn the city wallet into a real-time context layer, not a static offer catalogue. Spark City Wallet addresses this by generating offers at the moment they are needed, grounded in current local context and constrained by merchant rules.

## 2. Target Audience

The primary users are city wallet customers who want relevant local benefits without giving away raw behavioural data. The merchant users are local cafes, restaurants, retailers, and cultural venues that need simple tools to influence demand without manually designing campaigns.

The broader target group includes regional banks, payment providers, and city-commerce platforms that want to support high-street merchants while preserving user trust and privacy.

## 3. Solution & Core Features

Spark City Wallet provides a complete customer and merchant loop:

- Customer map experience with Google Maps, current location, nearby merchant context, and Spark as an in-app assistant.
- Live context sensing from location, time, weather, Google Places metadata, local events, opening status, and transaction-density adapters.
- Private local knowledge graph for routines, places, preferences, prompts, and offer outcomes.
- Agentic offer generation using local Gemma for private intent and Gemini through a Hermes endpoint for public deal intelligence.
- Generated offer cards with product, discount, expiry, rationale, channel, visual style, and redemption metadata.
- QR/token redemption flow with proof validation, replay protection, cashback ledger updates, and merchant analytics.
- Business mode with merchant radius controls, local reach map, live stats, event refresh, Spark recommendations, campaign guardrails, active campaign view, and performance metrics.
- Advanced graph explorer with clusters, fullscreen, pan, zoom, draggable nodes, and node inspection.

## 4. Unique Selling Proposition

Spark City Wallet is different because it treats offers as live decisions rather than stored coupons. The merchant sets rules and goals; Spark combines the current moment, public context, local graph memory, and AI-generated deal intelligence to create the right offer.

The privacy model is also core to the product. Raw graph memory stays on device, local Gemma handles private intent, and cloud AI receives only abstract intent and non-personal context. This gives the system personal relevance without exposing raw movement history or behavioural data.

## 5. Implementation & Technology

The app is implemented with React Native and Expo using TypeScript.

Main technologies:

- React Native / Expo for the mobile app.
- Google Maps through `react-native-maps`.
- Expo Location for device location and reverse geocoding.
- Expo Speech for Spark spoken recommendations.
- AsyncStorage for local account, ledger, settings, browser skills, and graph persistence.
- React Native SVG for the knowledge graph preview and advanced graph canvas visuals.
- Local Gemma through Ollama for private model calls.
- Gemini 2.5 Pro, Gemini 2.5 Flash, and Gemini 2.0 Flash through the Hermes task endpoint.
- Node.js local development API in `server/dev-api.js`.
- Google Places, Open-Meteo, OpenStreetMap/Nominatim/Overpass, and Royal Holloway events as live grounding sources.
- QR/token redemption with backend validation and aggregate merchant analytics.

Important implementation references:

- `App.tsx`: main app shell, map, graph, wallet, profile, offer, QR, and merchant screens.
- `src/services/contextEngine.ts`: live context aggregation and composite context state.
- `src/services/aiStack.ts`: Gemma and Gemini/Hermes agent paths.
- `src/services/localKnowledgeGraph.ts`: local graph persistence and graph event recording.
- `src/services/cityWalletApi.ts`: API client methods.
- `server/dev-api.js`: accounts, merchants, events, offers, redemptions, analytics, and Hermes gateway.

## 6. Results & Impact

The result is a working end-to-end Living Wallet prototype:

- The customer can move around the map, refresh context, receive a generated offer, accept it, and redeem it through a QR token.
- The merchant can switch into business mode, inspect local context, refresh events, receive Spark recommendations, edit campaign rules, and review aggregate performance.
- The graph view shows how local memory connects context, places, preferences, routines, and offer outcomes.
- The AI stack has been tested with four model paths: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash, and local Gemma.
- The live event refresh path has been tested against local event evidence and source links.

The value is a more responsive local-commerce system: customers see fewer irrelevant offers, merchants get AI-assisted demand tools, and the city wallet becomes a trusted real-time layer between local context, payment, and redemption.

## Additional Information

Spark City Wallet is designed for privacy-conscious local commerce. The current implementation uses a local development API for backend services, but the app architecture separates runtime adapters clearly so production services can replace local connectors without rewriting the mobile experience.

The most important product principle is that Spark should explain why an offer exists: location, time, weather, busyness, opening status, event context, user preference, or merchant guardrail. This keeps the AI interaction understandable in the first few seconds.

## Live Project URL

Not deployed.

## GitHub Repository URL

Add the public repository URL before submission.

## Technologies / Tags

React Native, Expo, TypeScript, Agentic AI, Gemini, Gemma, Ollama, Google Maps, Google Places, Context Engineering, Knowledge Graph, QR Redemption, Local Commerce, Data Engineering, Privacy by Design, Merchant Analytics

## Suggested Additional Tags

Living Wallet, Generative Offers, City Commerce, Local AI, Real-Time Context, Checkout, Cashback, High Street Retail
