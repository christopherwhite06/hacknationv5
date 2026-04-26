const { spawn } = require("child_process");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestJson = async (baseUrl, path, init) => {
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

const runServerScenario = async ({ port, env, run }) => {
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server/dev-api.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CITY_WALLET_API_PORT: String(port),
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await requestJson(baseUrl, "/connectors/health");
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await sleep(250);
      }
    }

    if (lastError) {
      throw lastError;
    }

    return await run(baseUrl);
  } finally {
    server.kill();
    await sleep(100);
    if (server.exitCode !== null && server.exitCode !== 0 && output.length) {
      console.error(output.join(""));
    }
  }
};

const main = async () => {
  const demoDemand = await runServerScenario({
    port: Number(process.env.CITY_WALLET_SCENARIO_PORT || 3115),
    env: { CITY_WALLET_DEMO_DEMAND: "enabled", CITY_WALLET_DEMO_SUPPLY: "enabled" },
    run: async (baseUrl) => {
      const density = await requestJson(baseUrl, "/payone/transaction-density?merchantIds=scenario-cafe,scenario-bookshop");
      if (density.length !== 2 || density.some((signal) => signal.source !== "payone_demo")) {
        throw new Error(`Expected labelled demo Payone density for each merchant, got ${JSON.stringify(density)}.`);
      }

      const stuttgartEvents = await requestJson(baseUrl, "/events/nearby?lat=48.7758&lon=9.1829");
      if (stuttgartEvents.length !== 0) {
        throw new Error(`Expected Stuttgart event signal to stay unconfigured, got ${JSON.stringify(stuttgartEvents)}.`);
      }

      const stuttgartScan = await requestJson(baseUrl, "/merchants/scenario-cafe/event-intelligence/scan", {
        method: "POST",
        body: JSON.stringify({
          merchant: {
            location: { lat: 48.7758, lon: 9.1829 }
          }
        })
      });
      if (stuttgartScan.sourceUrl !== "not_configured://events-adapter" || stuttgartScan.events.length !== 0) {
        throw new Error(`Expected Stuttgart event scan to show config-needed source, got ${JSON.stringify(stuttgartScan)}.`);
      }

      return density.length;
    }
  });

  const disabledDemand = await runServerScenario({
    port: Number(process.env.CITY_WALLET_SCENARIO_DISABLED_PORT || 3116),
    env: { CITY_WALLET_DEMO_SUPPLY: "enabled" },
    run: async (baseUrl) => {
      const density = await requestJson(baseUrl, "/payone/transaction-density?merchantIds=scenario-cafe");
      if (density.length !== 0) {
        throw new Error(`Expected no Payone demand when demo demand is disabled, got ${JSON.stringify(density)}.`);
      }
      return density.length;
    }
  });

  console.log(JSON.stringify({ ok: true, demoDemandSignals: demoDemand, disabledDemandSignals: disabledDemand }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
