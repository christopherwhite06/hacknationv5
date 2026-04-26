const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");

const port = Number(process.env.CITY_WALLET_API_PORT || 3001);
const demoSupplyEnabled = process.env.CITY_WALLET_DEMO_SUPPLY === "enabled";
const demoDemandEnabled = process.env.CITY_WALLET_DEMO_DEMAND === "enabled";
const royalHollowayEventsUrl = "https://www.royalholloway.ac.uk/about-us/events/";
const royalHollowayPoint = { latitude: 51.42565, longitude: -0.56306 };

const merchantRules = new Map();
const generatedOffers = new Map();

const analytics = new Map();
const redemptions = new Map();
const accounts = new Map();
const ledgers = new Map();
const calendarConnections = new Map();
const eventIntelligenceSettings = new Map();
const merchantRuleGoals = new Set(["fill_quiet_hours", "move_surplus", "first_time_visit", "increase_repeat_visits"]);
const merchantRuleWindows = new Set(["breakfast", "lunch", "afternoon", "evening"]);
const merchantRuleTones = new Set(["cozy", "premium", "playful", "direct"]);

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json"
  });
  res.end(payload);
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });

const merchantAnalytics = (merchantId) => {
  if (!analytics.has(merchantId)) {
    analytics.set(merchantId, {
      merchantId,
      impressions: 0,
      accepts: 0,
      declines: 0,
      redemptions: 0,
      cashbackIssuedCents: 0,
      redemptionRate: 0,
      acceptRate: 0,
      quietHourLiftPercent: 0,
      quietHourLiftBasis: "not_measured"
    });
  }

  const current = analytics.get(merchantId);
  const currentCampaign = [...generatedOffers.values()]
    .filter((offer) => offer.merchantId === merchantId)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
  const issuedToday = currentCampaign ? issuedTokensForRuleToday(merchantId, currentCampaign.ruleId) : undefined;
  const dailyCap = currentCampaign ? Number(currentCampaign.dailyRedemptionCap || 0) : undefined;

  return {
    ...current,
    acceptRate: current.impressions ? current.accepts / current.impressions : 0,
    redemptionRate: current.accepts ? current.redemptions / current.accepts : 0,
    currentCampaignRuleId: currentCampaign?.ruleId,
    currentCampaignDailyCap: dailyCap,
    currentCampaignIssuedToday: issuedToday,
    currentCampaignRemainingToday: typeof dailyCap === "number" && typeof issuedToday === "number"
      ? Math.max(0, dailyCap - issuedToday)
      : undefined
  };
};

const updateAnalytics = (merchantId, patch) => {
  const current = merchantAnalytics(merchantId);
  analytics.set(merchantId, { ...current, ...patch });
  return merchantAnalytics(merchantId);
};

const issuedTokensForRuleToday = (merchantId, ruleId) => {
  const today = new Date().toISOString().slice(0, 10);
  return [...redemptions.values()].filter(
    (token) =>
      token.merchantId === merchantId &&
      token.ruleId === ruleId &&
      token.issuedAt.slice(0, 10) === today &&
      token.status !== "rejected"
  ).length;
};

const cadenceMs = (cadence) => {
  if (cadence === "manual") {
    return undefined;
  }
  if (cadence === "twice_daily") {
    return 12 * 60 * 60 * 1000;
  }
  if (cadence === "weekly") {
    return 7 * 24 * 60 * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
};

const nextScanAt = (cadence, from = Date.now()) => {
  const interval = cadenceMs(cadence);
  return interval ? new Date(from + interval).toISOString() : undefined;
};

const activeEventAdjustment = (merchantId) => {
  const now = Date.now();
  const settings = eventIntelligenceSettings.get(merchantId);
  return settings?.scheduledAdjustments?.find((adjustment) => {
    const starts = Date.parse(adjustment.startsAt);
    const ends = Date.parse(adjustment.endsAt);
    return starts <= now && now <= ends;
  });
};

const eventSettingsFor = (merchantId) => {
  if (!eventIntelligenceSettings.has(merchantId)) {
    eventIntelligenceSettings.set(merchantId, {
      merchantId,
      mode: "manual",
      scanCadence: "daily",
      manualDiscountPercent: 10,
      minAutoDiscountPercent: 5,
      maxAutoDiscountPercent: 20,
      scheduledAdjustments: []
    });
  }

  const settings = eventIntelligenceSettings.get(merchantId);
  const now = Date.now();
  return {
    ...settings,
    scheduledAdjustments: (settings.scheduledAdjustments || []).map((adjustment) => ({
      ...adjustment,
      status: Date.parse(adjustment.endsAt) < now
        ? "expired"
        : Date.parse(adjustment.startsAt) <= now
          ? "active"
          : "scheduled"
    }))
  };
};

const eventImpactScore = (event) => {
  if (event.expectedDemandImpact === "high") {
    return 3;
  }
  if (event.expectedDemandImpact === "medium") {
    return 2;
  }
  return 1;
};

const buildEventDiscountPlan = (merchantId, settings, events) => {
  const eventsWithinWeek = events
    .filter((event) => {
      const starts = Date.parse(event.startsAt);
      return Number.isFinite(starts) && starts >= Date.now() && starts <= Date.now() + 7 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const topEvent = eventsWithinWeek[0];
  const baseDiscount = Number(settings.manualDiscountPercent || 10);

  if (!topEvent) {
    return {
      recommendedDiscountPercent: baseDiscount,
      rationale: ["No live local events were found in the next 7 days, so Spark keeps the current merchant rate."],
      scheduledAdjustments: []
    };
  }

  const score = eventImpactScore(topEvent);
  const eventStarts = Date.parse(topEvent.startsAt);
  const startsAt = new Date(Math.max(Date.now(), eventStarts - 3 * 60 * 60 * 1000)).toISOString();
  const endsAt = new Date(eventStarts + 6 * 60 * 60 * 1000).toISOString();
  const demandLikelyHigh = score >= 2 && topEvent.distanceM <= 2500;
  const recommended = demandLikelyHigh
    ? Math.max(Number(settings.minAutoDiscountPercent || 5), Math.min(Number(settings.maxAutoDiscountPercent || 20), baseDiscount - 2))
    : Math.max(Number(settings.minAutoDiscountPercent || 5), Math.min(Number(settings.maxAutoDiscountPercent || 20), baseDiscount + 4));
  const reason = demandLikelyHigh
    ? `Nearby event "${topEvent.title}" may naturally lift footfall, so Spark protects margin by easing the rate.`
    : `Local event "${topEvent.title}" is lower impact or farther away, so Spark can raise the rate to compete for attention.`;

  return {
    recommendedDiscountPercent: recommended,
    rationale: [
      reason,
      `Event starts ${new Date(topEvent.startsAt).toLocaleString("en-GB")} and is about ${Math.round(topEvent.distanceM)}m from the active area.`,
      "Decision uses live public event data and merchant guardrails; no event data is invented."
    ],
    scheduledAdjustments: [
      {
        id: `event-adjustment-${merchantId}-${Date.now()}`,
        startsAt,
        endsAt,
        discountPercent: recommended,
        reason,
        eventTitle: topEvent.title,
        status: Date.parse(startsAt) <= Date.now() && Date.now() <= Date.parse(endsAt) ? "active" : "scheduled"
      }
    ]
  };
};

const userLedger = (userId) => {
  if (!ledgers.has(userId)) {
    ledgers.set(userId, []);
  }

  return ledgers.get(userId);
};

const addLedgerEntry = (userId, entry) => {
  const current = userLedger(userId);
  const next = [{ id: `ledger-${Date.now()}`, createdAt: new Date().toISOString(), ...entry }, ...current];
  ledgers.set(userId, next);
  return next;
};

const couponCode = (merchantId) =>
  `SPARK-${merchantId.slice(0, 2).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const qrPayloadProof = ({ tokenId, offerId, merchantId, ruleId, couponCode }) =>
  crypto
    .createHmac("sha256", process.env.CITY_WALLET_QR_PROOF_SECRET || "city-wallet-local-dev")
    .update([tokenId, offerId, merchantId, ruleId, couponCode].join("|"))
    .digest("hex");

const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), salt, 32).toString("hex");

const createPasswordRecord = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt)
  };
};

const verifyPassword = (password, profile) => {
  const expectedHash = Buffer.from(profile.passwordHash, "hex");
  const providedHash = Buffer.from(hashPassword(password, profile.passwordSalt), "hex");
  return expectedHash.length === providedHash.length && crypto.timingSafeEqual(expectedHash, providedHash);
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const distanceMeters = (from, to) => {
  const earthRadiusM = 6371000;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const osmCategory = (tags = {}) => {
  const amenity = tags.amenity;
  const shop = tags.shop;
  const tourism = tags.tourism;

  if (amenity === "cafe" || amenity === "bar") {
    return "cafe";
  }
  if (["restaurant", "fast_food", "pub", "food_court"].includes(amenity)) {
    return "restaurant";
  }
  if (tourism === "museum" || amenity === "theatre" || amenity === "cinema" || amenity === "arts_centre") {
    return "culture";
  }
  if (shop) {
    return "retail";
  }

  return "retail";
};

const osmAddress = (tags = {}) =>
  [
    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
    tags["addr:postcode"],
    tags["addr:city"]
  ].filter(Boolean).join(", ") || tags.website || tags["contact:website"] || "Address not published in OpenStreetMap";

const osmProductHints = (tags = {}, category) => {
  if (category === "cafe") {
    return ["coffee", "tea", "pastry"];
  }
  if (category === "restaurant") {
    return ["meal", "lunch", "dinner"];
  }
  if (category === "culture") {
    return ["ticket", "visit"];
  }
  return [tags.shop || "retail item"];
};

const demoRuleForMerchant = (merchant, tags = {}) => {
  if (!demoSupplyEnabled || !merchant || merchant.openStatus === "closed") {
    return undefined;
  }

  const isStudentBreakFit =
    merchant.category === "cafe" ||
    merchant.category === "restaurant" ||
    /coffee|cafe|nero|toast|bakery|tea|pizza|kitchen/i.test(merchant.name);

  if (!isStudentBreakFit) {
    return undefined;
  }

  const products = osmProductHints(tags, merchant.category).slice(0, 3);

  return {
    id: `demo-rule-${merchant.id}`,
    merchantId: merchant.id,
    goal: "fill_quiet_hours",
    maxDiscountPercent: merchant.category === "cafe" ? 20 : 15,
    eligibleProducts: products.length ? products : ["study break"],
    validWindows: ["breakfast", "lunch", "afternoon", "evening"],
    dailyRedemptionCap: 30,
    brandTone: "cozy",
    forbiddenClaims: ["free", "guaranteed health benefit", "unlimited"],
    autoApproveWithinRules: true,
    triggerConditions: ["nearby_users", "time_window", "preference_match", "quiet_demand"],
    audiencePreferences: ["coffee", "quick lunch", "quiet seating", "student study break"],
    source: "demo"
  };
};

const parseTimeMinutes = (value = "") => {
  const match = value.match(/^(\d{1,2}):?(\d{2})?$/);
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * 60 + Number(match[2] || 0);
};

const osmOpenStatus = (openingHours) => {
  if (!openingHours) {
    return "unknown";
  }

  const normalized = openingHours.toLowerCase().trim();
  if (normalized === "24/7") {
    return "open";
  }
  if (normalized === "off" || normalized === "closed") {
    return "closed";
  }

  const timeRange = openingHours.match(/(\d{1,2}:?\d{0,2})\s*-\s*(\d{1,2}:?\d{0,2})/);
  if (!timeRange) {
    return "unknown";
  }

  const opens = parseTimeMinutes(timeRange[1]);
  const closes = parseTimeMinutes(timeRange[2]);
  if (!Number.isFinite(opens) || !Number.isFinite(closes)) {
    return "unknown";
  }

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  return opens <= closes
    ? current >= opens && current <= closes ? "open" : "closed"
    : current >= opens || current <= closes ? "open" : "closed";
};

const nearbyMerchantsFromOsm = async (lat, lon) => {
  const radiusM = 900;
  const query = `
    [out:json][timeout:12];
    (
      node(around:${radiusM},${lat},${lon})["name"]["amenity"~"cafe|restaurant|fast_food|bar|pub|theatre|cinema|arts_centre"];
      node(around:${radiusM},${lat},${lon})["name"]["shop"];
      node(around:${radiusM},${lat},${lon})["name"]["tourism"="museum"];
    );
    out center tags 25;
  `;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "SparkCityWallet/0.1 contact:local-dev"
    },
    body: new URLSearchParams({ data: query }).toString()
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap Overpass ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  return (payload.elements || [])
    .filter((element) => element.tags?.name && Number.isFinite(Number(element.lat || element.center?.lat)) && Number.isFinite(Number(element.lon || element.center?.lon)))
    .map((element) => {
      const category = osmCategory(element.tags);
      const id = `osm-${element.id}`;
      const merchant = {
        id,
        name: element.tags.name,
        category,
        location: {
          latitude: Number(element.lat || element.center?.lat),
          longitude: Number(element.lon || element.center?.lon)
        },
        address: osmAddress(element.tags),
        openingHours: element.tags.opening_hours,
        openStatus: osmOpenStatus(element.tags.opening_hours),
        currentInventorySignals: [
          "OpenStreetMap verified local business",
          element.tags.opening_hours ? `OSM opening_hours: ${element.tags.opening_hours}` : "",
          element.tags.opening_hours ? `Open status from OSM opening_hours: ${osmOpenStatus(element.tags.opening_hours)}` : "Opening hours not published in OSM",
          demoSupplyEnabled ? "Demo merchant campaign connector enabled for local supply-side testing" : "",
          element.tags.website || element.tags["contact:website"] || ""
        ].filter(Boolean),
        rules: merchantRules.get(id) || [],
        productHints: osmProductHints(element.tags, category)
      };
      const demoRule = demoRuleForMerchant(merchant, element.tags);
      return {
        ...merchant,
        rules: merchant.rules.length ? merchant.rules : demoRule ? [demoRule] : []
      };
    });
};

const calendarCategory = (summary = "") => {
  const normalized = summary.toLowerCase();

  if (normalized.includes("gym") || normalized.includes("run") || normalized.includes("fitness")) {
    return "fitness";
  }
  if (normalized.includes("lunch") || normalized.includes("dinner") || normalized.includes("friend")) {
    return "social";
  }
  if (normalized.includes("pickup") || normalized.includes("pick up") || normalized.includes("errand")) {
    return "errand";
  }
  if (normalized.includes("office") || normalized.includes("meeting") || normalized.includes("work")) {
    return "work";
  }

  return "personal";
};

const googleCalendarEvents = async (accessToken) => {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("maxResults", "10");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Google Calendar ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  return (payload.items || [])
    .filter((event) => event.summary && (event.start?.dateTime || event.start?.date))
    .map((event) => ({
      id: event.id,
      title: event.summary,
      startsAt: event.start.dateTime || `${event.start.date}T00:00:00.000Z`,
      endsAt: event.end?.dateTime || event.start.dateTime || `${event.start.date}T23:59:00.000Z`,
      locationName: event.location,
      category: calendarCategory(event.summary)
    }));
};

const parseRoyalHollowayDate = (value) => {
  const match = value.match(/(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/);
  if (!match) {
    return undefined;
  }

  const monthIndex = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(match[2].toLowerCase());

  if (monthIndex < 0) {
    return undefined;
  }

  return new Date(Date.UTC(Number(match[3]), monthIndex, Number(match[1]), 18, 0, 0)).toISOString();
};

const royalHollowayEvents = async (point) => {
  const distanceFromAdapterArea = distanceMeters(point, royalHollowayPoint);
  if (distanceFromAdapterArea > 20000) {
    return [];
  }

  const response = await fetch(royalHollowayEventsUrl, {
    headers: {
      Accept: "text/html",
      "User-Agent": "SparkCityWallet/0.1 contact:local-dev"
    }
  });

  if (!response.ok) {
    throw new Error(`Royal Holloway events ${response.status}: ${await response.text()}`);
  }

  const html = await response.text();
  const linkMatches = [...html.matchAll(/<a[^>]+href="([^"]*\/about-us\/events\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set();

  return linkMatches
    .map((match) => {
      const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const startsAt = parseRoyalHollowayDate(text);
      if (!startsAt) {
        return undefined;
      }
      const title = text.replace(/^\d{1,2}\s+[A-Za-z]+\s+20\d{2}\s*/, "").trim();
      const id = `rhul-${match[1].split("/").filter(Boolean).pop()}`;
      if (!title || seen.has(id)) {
        return undefined;
      }
      seen.add(id);
      const daysAway = (Date.parse(startsAt) - Date.now()) / (24 * 60 * 60 * 1000);
      return {
        category: "event",
        title: `Royal Holloway: ${title}`,
        startsAt,
        distanceM: Math.round(distanceMeters(point, royalHollowayPoint)),
        expectedDemandImpact: daysAway >= 0 && daysAway <= 7 ? "medium" : "low"
      };
    })
    .filter(Boolean)
    .slice(0, 6);
};

const placeNameFromOsm = async (lat, lon) => {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("zoom", "12");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SparkCityWallet/0.1 contact:local-dev"
    }
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap reverse geocode ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const address = payload.address || {};
  const name = address.city || address.town || address.village || address.suburb || address.county || payload.name;

  if (!name) {
    throw new Error("OpenStreetMap reverse geocode did not return a real place name.");
  }

  return name;
};

const weatherFromOpenMeteo = async (lat, lon) => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("current", "temperature_2m,weather_code");
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Open-Meteo ${response.status}`);
  }

  const payload = await response.json();
  const code = Number(payload.current?.weather_code ?? 0);
  const temperatureC = Number(payload.current?.temperature_2m);
  if (!Number.isFinite(temperatureC)) {
    throw new Error("Open-Meteo did not return a real current temperature.");
  }
  const condition = code >= 61 && code <= 82 ? "rain" : code >= 71 && code <= 77 ? "snow" : code >= 1 && code <= 3 ? "cloudy" : "clear";
  const city = await placeNameFromOsm(lat, lon);

  return {
    category: "weather",
    city,
    condition,
    temperatureC,
    source: "openmeteo",
    observedAt: new Date().toISOString()
  };
};

const generatedOffer = (body) => {
  const merchant = body.merchant;
  const insight = body.dealInsight;

  if (!merchant || !insight) {
    throw new Error("Offer generation requires merchant and dealInsight.");
  }

  const rule = merchant.rules?.[0];

  if (!rule) {
    throw new Error("Offer generation requires at least one merchant rule.");
  }

  const product = rule.eligibleProducts.includes(insight.suggestedProduct)
    ? insight.suggestedProduct
    : rule.eligibleProducts[0];
  const eventAdjustment = activeEventAdjustment(merchant.id);
  const eventSettings = eventSettingsFor(merchant.id);
  const requestedDiscountPercent = eventAdjustment
    ? Number(eventAdjustment.discountPercent)
    : Number(eventSettings.manualDiscountPercent || rule.maxDiscountPercent);
  const discountPercent = Math.max(0, Math.min(rule.maxDiscountPercent, requestedDiscountPercent));
  const cashbackCents = Math.round(Number(insight.marketAnchorPriceEur) * 100 * (discountPercent / 100));
  const expiresAt = new Date(Date.now() + 12 * 60 * 1000).toISOString();
  const code = couponCode(merchant.id);
  const contextText = [
    body.context?.compositeState,
    ...(body.context?.visibleReasons || []),
    insight.liveBusySignal,
    insight.openStatusSignal,
    insight.localEventTieIn
  ].filter(Boolean).join(" ").toLowerCase();
  const rainy = contextText.includes("rain");
  const quiet = contextText.includes("quiet") || contextText.includes("baseline");
  const eventLinked = Boolean(insight.localEventTieIn);
  const openNow = contextText.includes("appears open");
  const closedNow = contextText.includes("appears closed");
  const cold = contextText.includes("cold") || /\b\d+c\b/.test(contextText);
  const frame = rainy
    ? "rainy study break"
    : eventLinked
      ? "campus event moment"
      : quiet
        ? "quiet-hour merchant boost"
        : openNow
          ? "open-now nearby break"
          : closedNow
            ? "opening-hours check"
            : cold
              ? "warm-up nearby break"
              : "nearby study break";
  const palette = rainy
    ? ["#1E3A8A", "#DBEAFE", "#FFFFFF"]
    : eventLinked
      ? ["#6D28D9", "#EDE9FE", "#FFFFFF"]
      : quiet
        ? ["#047857", "#D1FAE5", "#FFFFFF"]
        : openNow
          ? ["#B91C1C", "#FEE2E2", "#FFFFFF"]
          : closedNow
            ? ["#374151", "#F3F4F6", "#FFFFFF"]
            : cold
              ? ["#0F766E", "#CCFBF1", "#FFFFFF"]
              : ["#E30613", "#FFFFFF", "#1A1A1A"];
  const openingFact = openNow
    ? "Appears open now"
    : closedNow
      ? "Opening status needs care"
      : "Opening status unknown";

  updateAnalytics(merchant.id, { impressions: merchantAnalytics(merchant.id).impressions + 1 });

  const offer = {
    id: `offer-${merchant.id}-${Date.now()}`,
    merchantId: merchant.id,
    ruleId: rule.id,
    title: `${discountPercent}% cashback on ${product}`,
    body: `${merchant.name} fits this moment: ${body.context?.compositeState || "live local context"}${eventLinked ? `, with ${insight.localEventTieIn}` : ""}.`,
    cta: "Claim offer",
    discountPercent,
    cashbackCents,
    couponCode: code,
    product,
    expiresAt,
    channel: "map_banner",
    emotionalFrame: frame,
    visualTheme: {
      palette,
      imagePrompt: `three second city wallet offer card for ${product} near ${merchant.name}, ${frame}`,
      icon: rainy ? "rain" : eventLinked ? "event" : quiet ? "quiet" : openNow ? "open" : closedNow ? "hours" : "spark"
    },
    visibleReasons: body.context?.visibleReasons || [],
    generationEvidence: {
      context: [
        body.context?.compositeState,
        insight.summary,
        insight.liveBusySignal,
        insight.openStatusSignal,
        insight.localEventTieIn,
        eventAdjustment ? `Business event intelligence active: ${eventAdjustment.reason}` : undefined,
        !eventAdjustment ? `Merchant manual rate applied: ${eventSettings.manualDiscountPercent}% requested, capped by ${rule.maxDiscountPercent}% rule guardrail` : undefined
      ].filter(Boolean),
      merchantRule: `${rule.goal.replaceAll("_", " ")} with max ${rule.maxDiscountPercent}% discount`,
      dealSource: insight.sourceUrl,
      privacy:
        insight.source === "gemma_local"
          ? "Browser-agent deal discovery used local Gemma only; no deal-search prompt was sent to Gemini."
          : "Only abstract intent and non-personal context were sent to Hermes/Gemini."
    },
    firstThreeSecondFacts: [
      merchant.name,
      `${discountPercent}% cashback`,
      `${product} now`,
      "Expires in 12 minutes",
      openingFact,
      "Claim offer"
    ]
  };
  generatedOffers.set(offer.id, {
    merchantId: merchant.id,
    ruleId: rule.id,
    dailyRedemptionCap: Number(rule.dailyRedemptionCap || 0),
    generatedAt: new Date().toISOString()
  });
  return offer;
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      json(res, 200, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "GET" && path.startsWith("/users/") && path.endsWith("/ledger")) {
      json(res, 200, userLedger(decodeURIComponent(path.split("/")[2])));
      return;
    }

    if (req.method === "GET" && path.startsWith("/users/") && path.split("/").length === 3) {
      const id = decodeURIComponent(path.split("/").pop());
      const profile = [...accounts.values()].find((account) => account.username === id);
      if (!profile) {
        json(res, 404, { error: "User profile was not found. Create or sign in to a real account first." });
        return;
      }
      const balance = userLedger(id).reduce((total, entry) => total + Number(entry.amountCents || 0), 0);
      json(res, 200, { id, name: profile.username, walletBalanceCents: balance });
      return;
    }

    if (req.method === "POST" && path === "/accounts") {
      const body = await readJsonBody(req);
      const email = normalizeEmail(body.email);
      if (!body.username || !email || !body.password) {
        json(res, 400, { error: "username, email and password are required" });
        return;
      }
      if (accounts.has(email)) {
        json(res, 409, { error: "An account already exists for this email." });
        return;
      }

      const profile = {
        username: body.username,
        email,
        accountType: body.accountType === "business" ? "business" : "user",
        ...createPasswordRecord(body.password),
        sessionToken: `session-${Date.now()}`
      };
      accounts.set(email, profile);
      userLedger(body.username);
      json(res, 200, {
        username: profile.username,
        email: profile.email,
        accountType: profile.accountType,
        sessionToken: profile.sessionToken
      });
      return;
    }

    if (req.method === "POST" && path === "/sessions") {
      const body = await readJsonBody(req);
      const profile = accounts.get(normalizeEmail(body.email));
      if (!body.password) {
        json(res, 400, { error: "password is required" });
        return;
      }
      if (!profile) {
        json(res, 401, { error: "Account not found. Create a real account before signing in." });
        return;
      }
      if (!verifyPassword(body.password, profile)) {
        json(res, 401, { error: "Invalid password." });
        return;
      }
      json(res, 200, {
        username: profile.username,
        email: profile.email,
        accountType: profile.accountType,
        sessionToken: `session-${Date.now()}`
      });
      return;
    }

    if (req.method === "POST" && path === "/integrations/google-calendar/sync") {
      const body = await readJsonBody(req);
      const userId = body.userId;
      if (!userId) {
        json(res, 400, { error: "Google Calendar sync requires a real userId." });
        return;
      }
      if (!body.accessToken) {
        json(res, 401, { error: "Google Calendar sync requires an OAuth access token." });
        return;
      }

      const events = await googleCalendarEvents(body.accessToken);
      calendarConnections.set(userId, {
        connectedAt: new Date().toISOString(),
        mode: "oauth_token"
      });
      json(res, 200, events);
      return;
    }

    if (req.method === "GET" && path === "/merchants/nearby") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        json(res, 400, { error: "lat and lon are required for real nearby business lookup." });
        return;
      }
      json(res, 200, await nearbyMerchantsFromOsm(lat, lon));
      return;
    }

    if (req.method === "GET" && path === "/events/nearby") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        json(res, 400, { error: "lat and lon are required for real local event lookup." });
        return;
      }
      json(res, 200, await royalHollowayEvents({ latitude: lat, longitude: lon }));
      return;
    }

    if (req.method === "GET" && path === "/weather/current") {
      const lat = url.searchParams.get("lat");
      const lon = url.searchParams.get("lon");
      if (!lat || !lon) {
        json(res, 400, { error: "lat and lon are required for real weather lookup." });
        return;
      }
      json(res, 200, await weatherFromOpenMeteo(lat, lon));
      return;
    }

    if (req.method === "GET" && path === "/payone/transaction-density") {
      const ids = (url.searchParams.get("merchantIds") || "").split(",").map(decodeURIComponent).filter(Boolean);
      if (!ids.length) {
        json(res, 400, { error: "merchantIds are required for transaction density lookup." });
        return;
      }
      if (!demoDemandEnabled) {
        json(res, 200, []);
        return;
      }
      json(res, 200, ids.slice(0, 8).map((merchantId, index) => {
        const baseline = 18 + index * 3;
        const quietnessScore = index % 3 === 0 ? 0.22 : index % 3 === 1 ? 0.48 : 0.67;
        return {
          category: "demand",
          merchantId,
          currentTransactionsPerHour: Math.max(1, Math.round(baseline * quietnessScore)),
          baselineTransactionsPerHour: baseline,
          quietnessScore,
          source: "payone_demo"
        };
      }));
      return;
    }

    if (req.method === "POST" && path === "/hermes/tasks") {
      const body = await readJsonBody(req);
      const auth = req.headers.authorization || "";
      const geminiApiKey = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

      if (!geminiApiKey) {
        json(res, 401, { error: "Hermes/Gemini gateway requires a Gemini API key." });
        return;
      }

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(body.model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: [
                      body.task,
                      "Return only JSON with keys: summary, suggestedProduct, marketAnchorPriceEur, confidence, sourceUrl, liveBusySignal, openStatusSignal, localEventTieIn.",
                      `Input: ${JSON.stringify(body.input)}`,
                      `Privacy: ${body.privacy}`
                    ].join("\n")
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!geminiResponse.ok) {
        json(res, geminiResponse.status, { error: await geminiResponse.text() });
        return;
      }

      const geminiPayload = await geminiResponse.json();
      const text = geminiPayload.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        json(res, 502, { error: "Gemini returned no structured deal insight." });
        return;
      }

      const insight = JSON.parse(text);
      const price = Number(insight.marketAnchorPriceEur);
      const confidence = Number(insight.confidence);

      if (!insight.summary || !insight.suggestedProduct || !Number.isFinite(price) || !Number.isFinite(confidence) || !insight.sourceUrl) {
        json(res, 502, { error: "Gemini response did not match the required deal insight schema." });
        return;
      }

      json(res, 200, {
        source: "gemini_hermes",
        summary: insight.summary,
        suggestedProduct: insight.suggestedProduct,
        marketAnchorPriceEur: price,
        confidence,
        sourceUrl: insight.sourceUrl,
        liveBusySignal: insight.liveBusySignal,
        openStatusSignal: insight.openStatusSignal,
        localEventTieIn: insight.localEventTieIn
      });
      return;
    }

    if (req.method === "POST" && path === "/offers/generate") {
      const body = await readJsonBody(req);
      if (!body.context?.userId) {
        json(res, 400, { error: "Offer generation requires a real context.userId." });
        return;
      }
      if (!body.merchant?.rules?.length) {
        json(res, 400, { error: "Offer generation requires at least one verified merchant rule." });
        return;
      }
      if (!body.dealInsight) {
        json(res, 400, { error: "Offer generation requires live deal insight." });
        return;
      }
      if (body.merchant?.openStatus === "closed") {
        json(res, 409, { error: "Offer generation stopped because live OSM opening_hours reports the merchant is closed." });
        return;
      }
      const offer = generatedOffer(body);
      json(res, 200, offer);
      return;
    }

    if (req.method === "POST" && path === "/offers/decline") {
      const body = await readJsonBody(req);
      if (!body.merchantId || !body.offerId) {
        json(res, 400, { error: "Offer decline requires merchantId and offerId." });
        return;
      }
      const current = merchantAnalytics(body.merchantId);
      json(res, 200, updateAnalytics(body.merchantId, { declines: current.declines + 1 }));
      return;
    }

    if (req.method === "POST" && path === "/redemptions/issue") {
      const body = await readJsonBody(req);
      if (!body.userId || !body.offerId || !body.merchantId || !body.couponCode) {
        json(res, 400, { error: "Redemption issue requires userId, offerId, merchantId and couponCode." });
        return;
      }
      const offerRecord = generatedOffers.get(body.offerId);
      if (!offerRecord || offerRecord.merchantId !== body.merchantId) {
        json(res, 404, { error: "Redemption issue requires a generated offer from this API instance." });
        return;
      }
      const dailyRedemptionCap = Number(offerRecord.dailyRedemptionCap || 0);
      if (dailyRedemptionCap <= 0) {
        json(res, 409, { error: "Merchant rule has no remaining redemption capacity for today." });
        return;
      }
      if (issuedTokensForRuleToday(body.merchantId, offerRecord.ruleId) >= dailyRedemptionCap) {
        json(res, 409, { error: "Merchant daily redemption cap has been reached for this campaign rule." });
        return;
      }
      const tokenId = `token-${Date.now()}`;
      const qrPayload = {
        tokenId,
        offerId: body.offerId,
        merchantId: body.merchantId,
        ruleId: offerRecord.ruleId,
        couponCode: body.couponCode
      };
      const token = {
        id: tokenId,
        offerId: body.offerId,
        merchantId: body.merchantId,
        ruleId: offerRecord.ruleId,
        userId: body.userId,
        couponCode: body.couponCode,
        cashbackCents: Number(body.cashbackCents || 0),
        qrPayload: JSON.stringify({ ...qrPayload, proof: qrPayloadProof(qrPayload) }),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
        status: "issued"
      };
      redemptions.set(token.id, token);
      const current = merchantAnalytics(body.merchantId);
      updateAnalytics(body.merchantId, { accepts: current.accepts + 1 });
      addLedgerEntry(body.userId, {
        type: "accepted",
        title: "Offer claimed",
        merchantName: body.merchantId,
        amountCents: 0
      });
      json(res, 200, token);
      return;
    }

    if (req.method === "POST" && path.startsWith("/redemptions/") && path.endsWith("/validate")) {
      const tokenId = path.split("/")[2];
      const token = redemptions.get(tokenId);
      const body = await readJsonBody(req);

      if (!token) {
        json(res, 404, { error: "Token not found" });
        return;
      }
      if (body.merchantId !== token.merchantId) {
        json(res, 403, { error: "Token can only be validated by the issuing merchant." });
        return;
      }
      if (body.qrPayload) {
        let scannedPayload;
        try {
          scannedPayload = typeof body.qrPayload === "string" ? JSON.parse(body.qrPayload) : body.qrPayload;
        } catch {
          json(res, 400, { error: "Scanned QR payload was not valid JSON." });
          return;
        }
        const expectedProof = qrPayloadProof({
          tokenId: token.id,
          offerId: token.offerId,
          merchantId: token.merchantId,
          ruleId: token.ruleId,
          couponCode: token.couponCode
        });
        if (scannedPayload.userId || scannedPayload.tokenId !== token.id || scannedPayload.proof !== expectedProof) {
          json(res, 409, { error: "Scanned QR payload proof did not match this token." });
          return;
        }
      }
      if (token.status === "validated") {
        json(res, 409, { error: "Token has already been validated." });
        return;
      }
      if (Date.parse(token.expiresAt) <= Date.now()) {
        json(res, 410, { error: "Token has expired." });
        return;
      }

      const validated = { ...token, status: "validated" };
      redemptions.set(tokenId, validated);
      const current = merchantAnalytics(token.merchantId);
      updateAnalytics(token.merchantId, {
        redemptions: current.redemptions + 1,
        cashbackIssuedCents: current.cashbackIssuedCents + Number(token.cashbackCents || 0)
      });
      addLedgerEntry(token.userId, {
        type: "redeemed",
        title: "Offer redeemed",
        merchantName: token.merchantId,
        amountCents: Number(token.cashbackCents || 0)
      });
      json(res, 200, validated);
      return;
    }

    if (req.method === "GET" && path.startsWith("/merchants/") && path.endsWith("/analytics")) {
      json(res, 200, merchantAnalytics(decodeURIComponent(path.split("/")[2])));
      return;
    }

    if (req.method === "POST" && path.startsWith("/merchants/") && path.endsWith("/rules")) {
      const merchantId = decodeURIComponent(path.split("/")[2]);
      const rule = await readJsonBody(req);
      if (
        !merchantRuleGoals.has(rule.goal) ||
        !Number.isFinite(Number(rule.maxDiscountPercent)) ||
        Number(rule.maxDiscountPercent) <= 0 ||
        !Array.isArray(rule.eligibleProducts) ||
        !rule.eligibleProducts.length ||
        !Array.isArray(rule.validWindows) ||
        !rule.validWindows.length ||
        !rule.validWindows.every((window) => merchantRuleWindows.has(window)) ||
        !merchantRuleTones.has(rule.brandTone) ||
        !Number.isFinite(Number(rule.dailyRedemptionCap)) ||
        Number(rule.dailyRedemptionCap) <= 0 ||
        !Array.isArray(rule.forbiddenClaims)
      ) {
        json(res, 400, { error: "Merchant rules require a valid goal, positive maxDiscountPercent, eligibleProducts, validWindows, brandTone, positive dailyRedemptionCap and forbiddenClaims." });
        return;
      }
      const savedRule = {
        ...rule,
        id: rule.id || `rule-${Date.now()}`,
        merchantId,
        maxDiscountPercent: Number(rule.maxDiscountPercent),
        dailyRedemptionCap: Number(rule.dailyRedemptionCap),
        source: "merchant"
      };
      const currentRules = merchantRules.get(merchantId) || [];
      merchantRules.set(merchantId, [savedRule, ...currentRules.filter((existing) => existing.id !== savedRule.id)]);
      json(res, 200, savedRule);
      return;
    }

    if (req.method === "GET" && path.startsWith("/merchants/") && path.endsWith("/event-intelligence")) {
      const merchantId = decodeURIComponent(path.split("/")[2]);
      json(res, 200, eventSettingsFor(merchantId));
      return;
    }

    if (req.method === "POST" && path.startsWith("/merchants/") && path.endsWith("/event-intelligence")) {
      const merchantId = decodeURIComponent(path.split("/")[2]);
      const body = await readJsonBody(req);
      const current = eventSettingsFor(merchantId);
      const scanCadence = ["manual", "daily", "twice_daily", "weekly"].includes(body.scanCadence)
        ? body.scanCadence
        : current.scanCadence;
      const mode = body.mode === "auto" || body.mode === "manual" ? body.mode : current.mode;
      const providedManualDiscount = Number(body.manualDiscountPercent);
      const providedMinAutoDiscount = Number(body.minAutoDiscountPercent);
      const providedMaxAutoDiscount = Number(body.maxAutoDiscountPercent);
      if (
        (Number.isFinite(providedManualDiscount) && providedManualDiscount <= 0) ||
        (Number.isFinite(providedMinAutoDiscount) && providedMinAutoDiscount < 0) ||
        (Number.isFinite(providedMaxAutoDiscount) && providedMaxAutoDiscount <= 0)
      ) {
        json(res, 400, { error: "Event intelligence rates must keep manual/max discounts above 0 and min discounts at or above 0." });
        return;
      }
      const next = {
        ...current,
        mode,
        scanCadence,
        manualDiscountPercent: Number.isFinite(providedManualDiscount)
          ? Math.min(50, providedManualDiscount)
          : current.manualDiscountPercent,
        minAutoDiscountPercent: Number.isFinite(providedMinAutoDiscount)
          ? Math.min(50, providedMinAutoDiscount)
          : current.minAutoDiscountPercent,
        maxAutoDiscountPercent: Number.isFinite(providedMaxAutoDiscount)
          ? Math.min(50, providedMaxAutoDiscount)
          : current.maxAutoDiscountPercent,
        nextScanAt: nextScanAt(scanCadence)
      };

      if (next.minAutoDiscountPercent > next.maxAutoDiscountPercent) {
        json(res, 400, { error: "minAutoDiscountPercent cannot be greater than maxAutoDiscountPercent." });
        return;
      }

      eventIntelligenceSettings.set(merchantId, next);
      json(res, 200, eventSettingsFor(merchantId));
      return;
    }

    if (req.method === "POST" && path.startsWith("/merchants/") && path.endsWith("/event-intelligence/scan")) {
      const merchantId = decodeURIComponent(path.split("/")[2]);
      const body = await readJsonBody(req);
      const settings = eventSettingsFor(merchantId);
      const point = body.merchant?.location || royalHollowayPoint;
      const eventAdapterInArea = distanceMeters(point, royalHollowayPoint) <= 20000;
      const events = eventAdapterInArea ? await royalHollowayEvents(point) : [];
      const plan = buildEventDiscountPlan(merchantId, settings, events);
      const scannedAt = new Date().toISOString();
      const next = {
        ...settings,
        lastScanAt: scannedAt,
        nextScanAt: nextScanAt(settings.scanCadence, Date.now()),
        scheduledAdjustments: settings.mode === "auto"
          ? [...plan.scheduledAdjustments, ...(settings.scheduledAdjustments || []).filter((adjustment) => Date.parse(adjustment.endsAt) > Date.now())].slice(0, 8)
          : settings.scheduledAdjustments || []
      };
      eventIntelligenceSettings.set(merchantId, next);
      json(res, 200, {
        merchantId,
        scannedAt,
        sourceUrl: eventAdapterInArea ? royalHollowayEventsUrl : "not_configured://events-adapter",
        events,
        recommendedDiscountPercent: plan.recommendedDiscountPercent,
        decisionSource: "live_event_policy",
        rationale: eventAdapterInArea
          ? plan.rationale
          : ["No event adapter is configured for this city, so Spark keeps the current merchant rate.", ...plan.rationale],
        scheduledAdjustments: settings.mode === "auto" ? next.scheduledAdjustments : plan.scheduledAdjustments
      });
      return;
    }

    if (req.method === "GET" && path === "/connectors/health") {
      json(res, 200, [
        { name: "Open-Meteo weather", status: "degraded", detail: "Adapter is configured; live reachability is checked during each context build, not by this health route." },
        { name: "Google Calendar", status: calendarConnections.size ? "connected" : "not_configured", detail: calendarConnections.size ? "Routine cold-start sync is active." : "Connect Calendar to cold-start schedule habits." },
        { name: "Royal Holloway events", status: "degraded", detail: "Adapter-ready for active points near Egham/Royal Holloway; other cities show no event signal until their adapter is configured." },
        {
          name: "Payone density",
          status: demoDemandEnabled ? "degraded" : "not_configured",
          detail: demoDemandEnabled
            ? "Demo transaction-density connector is enabled for company-side testing; replace with Payone credentials for production."
            : "No Payone credentials are connected, so demand signals are not invented."
        },
        {
          name: "Demo merchant campaigns",
          status: demoSupplyEnabled ? "degraded" : "not_configured",
          detail: demoSupplyEnabled
            ? "Demo merchant rules are enabled so the end-to-end merchant supply loop can be tested locally."
            : "No demo merchant campaign rules are enabled."
        },
        { name: "OpenStreetMap places", status: "degraded", detail: "Adapter is configured; nearby businesses are requested from Overpass during live context loading." },
        {
          name: "Hermes/Gemini agent",
          status: "degraded",
          detail: "Gateway route is available; each live Gemini call still requires a request Bearer key and reachable Hermes/Gemini runtime."
        },
        {
          name: "Local Gemma",
          status: "degraded",
          detail: "Device app calls the configured Ollama URL directly; the dev API does not claim the local model is running."
        }
      ]);
      return;
    }

    if (req.method === "POST" && path === "/privacy/graph/export") {
      json(res, 410, { error: "Raw local graph export is device-only; the API will not receive private graph data." });
      return;
    }

    if (req.method === "DELETE" && path === "/privacy/graph") {
      json(res, 200, { deleted: true });
      return;
    }

    json(res, 404, { error: `No route for ${req.method} ${path}` });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "Unknown API error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`City Wallet local API running on http://0.0.0.0:${port}`);
});
