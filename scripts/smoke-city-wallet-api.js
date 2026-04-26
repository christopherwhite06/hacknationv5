const { spawn } = require("child_process");

const port = Number(process.env.CITY_WALLET_SMOKE_PORT || 3105);
const baseUrl = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestJson = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${path} failed ${response.status}: ${await response.text()}`);
  }

  return response.json();
};

const waitForApi = async () => {
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await requestJson("/connectors/health");
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  throw lastError || new Error("City Wallet API did not start.");
};

const main = async () => {
  const server = spawn(process.execPath, ["server/dev-api.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CITY_WALLET_API_PORT: String(port),
      CITY_WALLET_DEMO_DEMAND: "enabled",
      CITY_WALLET_DEMO_SUPPLY: "enabled"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = [];
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    const health = await waitForApi();
    const merchantId = `smoke-merchant-${Date.now()}`;
    const userId = `smoke-user-${Date.now()}`;
    const weatherHealth = health.find((connector) => connector.name === "Open-Meteo weather");
    const eventHealth = health.find((connector) => connector.name === "Royal Holloway events");
    const osmHealth = health.find((connector) => connector.name === "OpenStreetMap places");
    const hermesHealth = health.find((connector) => connector.name === "Hermes/Gemini agent");
    const gemmaHealth = health.find((connector) => connector.name === "Local Gemma");

    if (weatherHealth?.status !== "degraded" || eventHealth?.status !== "degraded" || osmHealth?.status !== "degraded") {
      throw new Error(`Expected unprobed public adapters to be adapter-ready/degraded, got ${JSON.stringify({ weatherHealth, eventHealth, osmHealth })}.`);
    }
    if (hermesHealth?.status !== "degraded" || gemmaHealth?.status !== "degraded") {
      throw new Error(`Expected AI runtime health to be adapter/degraded until probed live, got ${JSON.stringify({ hermesHealth, gemmaHealth })}.`);
    }
    const stuttgartEvents = await requestJson("/events/nearby?lat=48.7758&lon=9.1829");
    if (stuttgartEvents.length !== 0) {
      throw new Error(`Expected no Royal Holloway events for Stuttgart until a Stuttgart adapter is configured, got ${JSON.stringify(stuttgartEvents)}.`);
    }
    const accountEmail = `smoke-${Date.now()}@example.test`;
    const accountUsername = `smoke-account-${Date.now()}`;
    await requestJson("/accounts", {
      method: "POST",
      body: JSON.stringify({
        username: accountUsername,
        email: accountEmail,
        password: "correct-horse",
        accountType: "user"
      })
    });
    const duplicateAccount = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: `smoke-account-duplicate-${Date.now()}`,
        email: accountEmail,
        password: "correct-horse",
        accountType: "user"
      })
    });

    if (duplicateAccount.status !== 409) {
      throw new Error(`Expected duplicate account email to be rejected, got ${duplicateAccount.status}: ${await duplicateAccount.text()}`);
    }
    const caseDuplicateAccount = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: `smoke-account-case-duplicate-${Date.now()}`,
        email: accountEmail.toUpperCase(),
        password: "correct-horse",
        accountType: "user"
      })
    });

    if (caseDuplicateAccount.status !== 409) {
      throw new Error(`Expected case-insensitive duplicate account email to be rejected, got ${caseDuplicateAccount.status}: ${await caseDuplicateAccount.text()}`);
    }
    const duplicateUsernameAccount = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: accountUsername,
        email: `smoke-duplicate-username-${Date.now()}@example.test`,
        password: "correct-horse",
        accountType: "user"
      })
    });

    if (duplicateUsernameAccount.status !== 409) {
      throw new Error(`Expected duplicate account username to be rejected, got ${duplicateUsernameAccount.status}: ${await duplicateUsernameAccount.text()}`);
    }
    const rejectedSession = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: accountEmail,
        password: "wrong-horse",
        accountType: "user"
      })
    });

    if (rejectedSession.status !== 401) {
      throw new Error(`Expected wrong password to be rejected, got ${rejectedSession.status}: ${await rejectedSession.text()}`);
    }
    const acceptedSession = await requestJson("/sessions", {
      method: "POST",
      body: JSON.stringify({
        email: accountEmail.toUpperCase(),
        password: "correct-horse",
        accountType: "user"
      })
    });
    if (!acceptedSession.sessionToken || acceptedSession.passwordHash || acceptedSession.passwordSalt) {
      throw new Error(`Expected successful login without password fields, got ${JSON.stringify(acceptedSession)}.`);
    }
    const encodedUsername = `smoke user/${Date.now()}`;
    const encodedAccountEmail = `encoded-${Date.now()}@example.test`;
    await requestJson("/accounts", {
      method: "POST",
      body: JSON.stringify({
        username: encodedUsername,
        email: encodedAccountEmail,
        password: "correct-horse",
        accountType: "user"
      })
    });
    const encodedUser = await requestJson(`/users/${encodeURIComponent(encodedUsername)}`);
    const encodedLedger = await requestJson(`/users/${encodeURIComponent(encodedUsername)}/ledger`);
    if (encodedUser.id !== encodedUsername || !Array.isArray(encodedLedger)) {
      throw new Error(`Expected encoded user routes to round-trip decoded, got ${JSON.stringify({ encodedUser, encodedLedger })}.`);
    }

    await requestJson(`/merchants/${merchantId}/event-intelligence`, {
      method: "POST",
      body: JSON.stringify({ manualDiscountPercent: 18 })
    });
    const invalidEventRate = await fetch(`${baseUrl}/merchants/${merchantId}/event-intelligence`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ manualDiscountPercent: 0 })
    });

    if (invalidEventRate.status !== 400) {
      throw new Error(`Expected zero manual event rate to be rejected, got ${invalidEventRate.status}: ${await invalidEventRate.text()}`);
    }
    const invalidRule = await fetch(`${baseUrl}/merchants/${merchantId}/rules`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "rule-invalid-smoke",
        merchantId,
        goal: "fill_quiet_hours",
        maxDiscountPercent: 0,
        eligibleProducts: ["coffee"],
        validWindows: ["lunch"],
        dailyRedemptionCap: 0,
        brandTone: "cozy",
        forbiddenClaims: ["free"],
        autoApproveWithinRules: true,
        source: "merchant"
      })
    });

    if (invalidRule.status !== 400) {
      throw new Error(`Expected non-actionable merchant rule to be rejected, got ${invalidRule.status}: ${await invalidRule.text()}`);
    }
    const invalidRuleWindow = await fetch(`${baseUrl}/merchants/${merchantId}/rules`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "rule-invalid-window-smoke",
        merchantId,
        goal: "fill_quiet_hours",
        maxDiscountPercent: 20,
        eligibleProducts: ["coffee"],
        validWindows: ["midnight"],
        dailyRedemptionCap: 1,
        brandTone: "cozy",
        forbiddenClaims: ["free"],
        autoApproveWithinRules: true,
        source: "merchant"
      })
    });

    if (invalidRuleWindow.status !== 400) {
      throw new Error(`Expected invalid merchant rule window to be rejected, got ${invalidRuleWindow.status}: ${await invalidRuleWindow.text()}`);
    }
    const encodedMerchantId = `smoke merchant/${Date.now()}`;
    const encodedRule = await requestJson(`/merchants/${encodeURIComponent(encodedMerchantId)}/rules`, {
      method: "POST",
      body: JSON.stringify({
        id: "rule-encoded-merchant-smoke",
        merchantId: encodedMerchantId,
        goal: "fill_quiet_hours",
        maxDiscountPercent: 12,
        eligibleProducts: ["tea"],
        validWindows: ["afternoon"],
        dailyRedemptionCap: 2,
        brandTone: "cozy",
        forbiddenClaims: ["free"],
        autoApproveWithinRules: true,
        source: "merchant"
      })
    });
    const encodedAnalytics = await requestJson(`/merchants/${encodeURIComponent(encodedMerchantId)}/analytics`);
    if (encodedRule.merchantId !== encodedMerchantId || encodedAnalytics.merchantId !== encodedMerchantId) {
      throw new Error(`Expected encoded merchant route IDs to round-trip decoded, got ${JSON.stringify({ encodedRule, encodedAnalytics })}.`);
    }

    const offer = await requestJson("/offers/generate", {
      method: "POST",
      body: JSON.stringify({
        context: {
          userId,
          compositeState: "rain + browsing + nearby merchant quiet + top merchant open",
          visibleReasons: ["9C and rain in Egham", "Smoke Cafe appears open from OSM opening_hours"]
        },
        merchant: {
          id: merchantId,
          name: "Smoke Cafe",
          rules: [
            {
              id: "rule-smoke",
              merchantId,
              goal: "fill_quiet_hours",
              maxDiscountPercent: 20,
              eligibleProducts: ["coffee"],
              validWindows: ["lunch"],
              dailyRedemptionCap: 1,
              brandTone: "cozy",
              forbiddenClaims: ["free"],
              autoApproveWithinRules: true,
              source: "merchant"
            }
          ]
        },
        dealInsight: {
          source: "gemma_local",
          summary: "Smoke test deal insight from local-only fixture.",
          suggestedProduct: "coffee",
          marketAnchorPriceEur: 5,
          confidence: 0.9,
          sourceUrl: "local://smoke-test",
          openStatusSignal: "Smoke Cafe appears open from OSM opening_hours"
        }
      })
    });

    if (offer.discountPercent !== 18) {
      throw new Error(`Expected manual merchant rate 18%, got ${offer.discountPercent}%.`);
    }
    if (offer.visualTheme.icon !== "rain") {
      throw new Error(`Expected rain-themed offer icon, got ${offer.visualTheme.icon}.`);
    }
    if (!offer.visualTheme.themeRationale?.toLowerCase().includes("rain")) {
      throw new Error(`Expected rain-themed offer rationale, got ${JSON.stringify(offer.visualTheme)}.`);
    }
    if (!offer.generationEvidence.merchantRule.includes("1 daily redemption")) {
      throw new Error(`Expected generated offer evidence to include daily cap, got ${offer.generationEvidence.merchantRule}.`);
    }
    if (!offer.firstThreeSecondFacts.includes("Claim offer")) {
      throw new Error(`Expected first-three-second facts to include the CTA, got ${JSON.stringify(offer.firstThreeSecondFacts)}.`);
    }
    const closedOfferResponse = await fetch(`${baseUrl}/offers/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        context: {
          userId,
          compositeState: "rain + browsing + top merchant closed",
          visibleReasons: ["Smoke Cafe appears closed from OSM opening_hours"]
        },
        merchant: {
          id: `${merchantId}-closed`,
          name: "Closed Smoke Cafe",
          openStatus: "closed",
          rules: [
            {
              id: "rule-closed-smoke",
              merchantId: `${merchantId}-closed`,
              goal: "fill_quiet_hours",
              maxDiscountPercent: 20,
              eligibleProducts: ["coffee"],
              validWindows: ["lunch"],
              dailyRedemptionCap: 1,
              brandTone: "cozy",
              forbiddenClaims: ["free"],
              autoApproveWithinRules: true,
              source: "merchant"
            }
          ]
        },
        dealInsight: {
          source: "gemma_local",
          summary: "Closed merchant smoke test insight.",
          suggestedProduct: "coffee",
          marketAnchorPriceEur: 5,
          confidence: 0.9,
          sourceUrl: "local://smoke-test",
          openStatusSignal: "Closed Smoke Cafe appears closed from OSM opening_hours"
        }
      })
    });

    if (closedOfferResponse.status !== 409) {
      throw new Error(`Expected closed merchant offer rejection, got ${closedOfferResponse.status}: ${await closedOfferResponse.text()}`);
    }

    const wrongCouponResponse = await fetch(`${baseUrl}/redemptions/issue`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId,
        offerId: offer.id,
        merchantId,
        couponCode: "WRONG-CODE",
        cashbackCents: offer.cashbackCents
      })
    });

    if (wrongCouponResponse.status !== 409) {
      throw new Error(`Expected mismatched coupon issue to be rejected, got ${wrongCouponResponse.status}: ${await wrongCouponResponse.text()}`);
    }

    const token = await requestJson("/redemptions/issue", {
      method: "POST",
      body: JSON.stringify({
        userId,
        offerId: offer.id,
        merchantId,
        couponCode: offer.couponCode,
        cashbackCents: offer.cashbackCents
      })
    });
    const qrPayload = JSON.parse(token.qrPayload);
    if (qrPayload.userId || qrPayload.tokenId !== token.id || !qrPayload.proof || qrPayload.proof.length !== 64) {
      throw new Error(`Expected QR payload to expose token proof but not userId, got ${token.qrPayload}.`);
    }

    const overCapResponse = await fetch(`${baseUrl}/redemptions/issue`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: `${userId}-over-cap`,
        offerId: offer.id,
        merchantId,
        couponCode: offer.couponCode,
        cashbackCents: offer.cashbackCents
      })
    });

    if (overCapResponse.status !== 409) {
      throw new Error(`Expected daily redemption cap rejection, got ${overCapResponse.status}: ${await overCapResponse.text()}`);
    }

    const graphExportResponse = await fetch(`${baseUrl}/privacy/graph/export`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ nodes: [{ id: "private", label: "private habit" }], edges: [] })
    });

    if (graphExportResponse.status !== 410) {
      throw new Error(`Expected private graph export rejection, got ${graphExportResponse.status}: ${await graphExportResponse.text()}`);
    }

    const tamperedPayloadResponse = await fetch(`${baseUrl}/redemptions/${encodeURIComponent(token.id)}/validate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ merchantId, qrPayload: JSON.stringify({ ...qrPayload, proof: "tampered" }) })
    });

    if (tamperedPayloadResponse.status !== 409) {
      throw new Error(`Expected tampered QR payload proof to be rejected, got ${tamperedPayloadResponse.status}: ${await tamperedPayloadResponse.text()}`);
    }

    const incompletePayloadResponse = await fetch(`${baseUrl}/redemptions/${encodeURIComponent(token.id)}/validate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ merchantId, qrPayload: JSON.stringify({ tokenId: qrPayload.tokenId, proof: qrPayload.proof }) })
    });

    if (incompletePayloadResponse.status !== 409) {
      throw new Error(`Expected incomplete QR payload proof to be rejected, got ${incompletePayloadResponse.status}: ${await incompletePayloadResponse.text()}`);
    }

    const validated = await requestJson(`/redemptions/${encodeURIComponent(token.id)}/validate`, {
      method: "POST",
      body: JSON.stringify({ merchantId, qrPayload: token.qrPayload })
    });
    const replayValidationResponse = await fetch(`${baseUrl}/redemptions/${encodeURIComponent(token.id)}/validate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ merchantId, qrPayload: token.qrPayload })
    });

    if (replayValidationResponse.status !== 409) {
      throw new Error(`Expected repeat redemption validation to be rejected, got ${replayValidationResponse.status}: ${await replayValidationResponse.text()}`);
    }

    await requestJson("/offers/decline", {
      method: "POST",
      body: JSON.stringify({ merchantId, offerId: offer.id })
    });
    await requestJson("/offers/decline", {
      method: "POST",
      body: JSON.stringify({ merchantId, offerId: offer.id })
    });

    const analytics = await requestJson(`/merchants/${merchantId}/analytics`);

    if (validated.status !== "validated") {
      throw new Error(`Expected validated token, got ${validated.status}.`);
    }
    if (analytics.accepts < 1 || analytics.redemptions < 1) {
      throw new Error(`Expected accept/redemption analytics, got ${JSON.stringify(analytics)}.`);
    }
    if (analytics.redemptions !== 1) {
      throw new Error(`Expected replay validation not to double-count redemptions, got ${JSON.stringify(analytics)}.`);
    }
    if (analytics.declines !== 1) {
      throw new Error(`Expected one aggregate decline after dismiss smoke, got ${JSON.stringify(analytics)}.`);
    }
    if (analytics.redemptionRate !== 1) {
      throw new Error(`Expected measured checkout conversion of 1, got ${analytics.redemptionRate}.`);
    }
    if (analytics.quietHourLiftBasis !== "not_measured" || analytics.quietHourLiftPercent !== 0) {
      throw new Error(`Expected quiet-hour lift to remain unmeasured without post-campaign Payone baseline, got ${JSON.stringify(analytics)}.`);
    }
    if (analytics.currentCampaignDailyCap !== 1 || analytics.currentCampaignRemainingToday !== 0) {
      throw new Error(`Expected exhausted campaign capacity after one capped issue, got ${JSON.stringify(analytics)}.`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          connectors: health.length,
          offerDiscountPercent: offer.discountPercent,
          offerTheme: offer.visualTheme.icon,
          tokenStatus: validated.status,
          analytics: {
            accepts: analytics.accepts,
            declines: analytics.declines,
            redemptions: analytics.redemptions,
            acceptRate: analytics.acceptRate,
            redemptionRate: analytics.redemptionRate,
            quietHourLiftBasis: analytics.quietHourLiftBasis,
            remainingToday: analytics.currentCampaignRemainingToday
          }
        },
        null,
        2
      )
    );
  } finally {
    server.kill();
    await sleep(100);
    if (server.exitCode !== null && server.exitCode !== 0 && output.length) {
      console.error(output.join(""));
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
