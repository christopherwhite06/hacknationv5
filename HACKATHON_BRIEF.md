# Generative City-Wallet Hackathon Brief

In collaboration with MIT Club of Northern California and MIT Club of Germany.

## Challenge
Generative City-Wallet: hyperpersonalized offers for anyone, anywhere.

Powered by DSV-Gruppe, Deutscher Sparkassenverlag, a company of the German Savings Banks Financial Group.

## Goals and Motivation
The challenge asks us to close the gap between a person and a perfectly relevant local offer that already exists nearby. Static coupon apps miss the moment. The product must connect live signals, infer intent, let merchants set simple goals, dynamically generate an offer, and make it redeemable.

The example user is Mia, 28, walking through Stuttgart old town on a Tuesday lunch break with twelve minutes to spare. The system should understand the weather, nearby quiet merchants, fresh inventory, movement pattern, previous warm-drink response, and time pressure. Instead of a generic month-long coupon, it should produce this cafe, this drink, right now, because the moment is right.

## Current Challenges
- Static offers: traditional loyalty programmes and coupon books are generic and weak at driving spontaneous visits.
- No algorithmic power: small local retailers lack the dynamic pricing and recommendation infrastructure of global e-commerce.
- Context blindness: even when offers and users are in the same street at the same time, no real-time layer connects the merchant need with user intent.

## Product Challenge
Build CITY WALLET, a working end-to-end MVP for an AI-powered city wallet that detects the most relevant local offer for a user in real time, generates it dynamically, and makes it redeemable through simulated checkout.

The user experience must surface locally relevant offers in everyday situations, not static coupons. Offers must be grounded in real-time weather, time of day, location, local events, and demand patterns. Merchants participate with minimal effort by setting simple rules or goals while the AI generates the actual offer within those parameters.

The solution must be a living wallet, not a coupon app. Offers should not exist until the moment they are needed. The merchant sets rules and goals; the AI creates the offer. Country-specific or city-specific parameters must be configurable inputs, not hardcoded assumptions.

## Required Module 01: Context Sensing Layer
Aggregate real-time context signals:
- Weather data.
- Local event calendars, such as city festivals, sports events, and concerts.
- User location via geofencing.
- Payone transaction density at nearby merchants as a key DSV asset.

The system must recognise composite context states such as `raining + Tuesday afternoon + partner cafe transaction volume unusually low` and trigger the generative pipeline.

Context signals must be configurable without changing the codebase. A different city or data source should slot in as configuration, not a rewrite.

Required: incorporate at least two real context signal categories visible to the user, such as weather, location, time, local events, or demand proxies.

## Required Module 02: Generative Offer Engine
Based on context state, the system autonomously generates a targeted campaign:
- Content.
- Discount parameters.
- Visual design.
- Timing.

This is not template filling. Use GenUI techniques to create a fitting interface element, including imagery, tone, and emotional framing. The merchant specifies rules or goals such as `max 20% discount to fill quiet hours`; the AI handles creative execution.

On-device SLMs are encouraged for GDPR compliance. Local preference and movement data should not reach the cloud. Only an abstract intent signal should be sent upstream.

Required: offers must be generated dynamically, not retrieved from a static database. Show the merchant-side rule interface, even as a mockup.

## Required Module 03: Seamless Checkout and Redemption
When a user accepts an offer, the system generates a dynamic QR code or token that is validated via API. The redemption experience should be seamless to the point of simulated checkout.

Acceptable mechanics:
- QR scan.
- Token.
- Cashback after successful transaction.

Build both consumer and merchant views. The merchant should see aggregate offer performance and accept/decline rates.

Required: demonstrate the end-to-end flow from offer generation to simulated redemption. Merchant dashboard or summary view is required, even as a static mockup.

## UX Requirement
Design is not decoration; it is the mechanism of acceptance or rejection. The prototype must explicitly address:
- Where the interaction happens: push notification, in-app card, lock-screen widget, homescreen banner, or another channel.
- How the offer addresses the user: factual-informative or emotional-situational.
- What happens in the first 3 seconds: the offer must be understood instantly without scrolling or deliberation.
- How the offer ends: expiry, acceptance, or dismissal should feel intentional and leave the user experience intact.

The demo should clearly highlight how these four points are addressed.

## Data Sources and Hints
The tool should be grounded in real or realistic data, not only synthetic proxies.

Context and location:
- OpenWeatherMap or DWD for real-time and forecast weather.
- Eventbrite or local event APIs for local event calendars and demand spike detection.
- Google Maps Platform or OSM for POI data, footfall signals, route density, proximity, and relevance scoring.

Merchant and transaction data:
- Simulated Payone transaction feed per merchant as a core DSV asset for identifying quiet periods and triggering dynamic offers.

AI and Generative UI:
- On-device SLMs such as Phi-3 or Gemma for GDPR-compliant local personalisation.
- React Native or Flutter GenUI for dynamically generated offer widgets.

## Strong Submission Criteria
Strong submissions:
- Show real context in action, such as rain plus low transaction volume producing a specific plausible offer.
- Design for 3-second comprehension with clear layout, language, and hierarchy.
- Close the loop from context detection to offer generation to display to accept/decline to simulated checkout.
- Address GDPR honestly with on-device inference, anonymisation, or consent flows.

Weak submissions:
- Build a beautiful UI showing static dummy offers with no generative logic.
- Treat merchant and customer sides as afterthoughts.
- Over-engineer the AI stack and under-engineer the experience.
- Ignore the merchant perspective.

## Why This Matters
The decline of inner-city retail is a structural threat to local economies and to the regional business model of savings banks embedded in those communities. Traditional loyalty and static coupon books have failed. Global e-commerce has dynamic pricing, real-time demand signals, and algorithmic personalisation that local merchants cannot match.

DSV Gruppe sits at the intersection of payments infrastructure, merchant portals, and regional banking relationships. This is a unique position to build an AI layer that knows local context, respects privacy by design, and makes local merchants as responsive to demand as marketplace algorithms.
