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

    await requestJson(`/merchants/${merchantId}/event-intelligence`, {
      method: "POST",
      body: JSON.stringify({ manualDiscountPercent: 18 })
    });

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
              dailyRedemptionCap: 5,
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

    const validated = await requestJson(`/redemptions/${encodeURIComponent(token.id)}/validate`, {
      method: "POST",
      body: JSON.stringify({ merchantId })
    });

    const analytics = await requestJson(`/merchants/${merchantId}/analytics`);

    if (validated.status !== "validated") {
      throw new Error(`Expected validated token, got ${validated.status}.`);
    }
    if (analytics.accepts < 1 || analytics.redemptions < 1) {
      throw new Error(`Expected accept/redemption analytics, got ${JSON.stringify(analytics)}.`);
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
            redemptions: analytics.redemptions,
            acceptRate: analytics.acceptRate
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
