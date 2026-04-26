import { CityWalletConfig, cityWalletConfigForPoint } from "../config/cityWalletConfig";
import { getRuntimeConfig } from "../config/runtimeConfig";
import { fetchEventsNear, fetchMerchantsNear, fetchPayoneDemand } from "./cityWalletApi";
import { fetchWeather } from "./weatherClient";
import { ContextState, DemandSignal, EventSignal, GeoPoint, LocationSignal, Merchant, TimeSignal, WeatherSignal } from "../types";

const distanceMeters = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) => {
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

const getMerchantDemand = (merchantId: string, demandSignals: DemandSignal[]) =>
  demandSignals.find((signal) => signal.merchantId === merchantId);

const merchantOpenScore = (merchant: Merchant) => {
  if (merchant.openStatus === "open") {
    return 0.2;
  }
  if (merchant.openStatus === "closed") {
    return -0.4;
  }
  return 0;
};

const merchantScore = (
  config: CityWalletConfig,
  merchant: Merchant,
  location: LocationSignal,
  time: TimeSignal,
  weather: WeatherSignal,
  events: EventSignal[],
  demand?: DemandSignal
) => {
  const distance = distanceMeters(location.userPosition, merchant.location);
  const proximityScore = Math.max(0, 1 - distance / config.triggerThresholds.geofenceRadiusM);
  const demandNeedScore = demand ? 1 - demand.quietnessScore : 0;
  const weatherFit = merchant.category === "cafe" && weather.temperatureC <= config.triggerThresholds.coldTemperatureC ? 1 : 0.35;
  const timeFit = merchant.rules.some((rule) => rule.validWindows.includes(time.window)) ? 1 : 0;
  const eventFit = events.some((event) => event.expectedDemandImpact !== "low") ? 0.5 : 0.2;

  return (
    proximityScore * config.scoringWeights.location +
    demandNeedScore * config.scoringWeights.demand +
    weatherFit * config.scoringWeights.weather +
    timeFit * config.scoringWeights.time +
    eventFit * config.scoringWeights.event +
    merchantOpenScore(merchant)
  );
};

const getTimeSignal = (): TimeSignal => {
  const now = new Date();
  const hour = now.getHours();

  return {
    category: "time",
    localIsoTime: now.toISOString(),
    dayOfWeek: now.toLocaleDateString(undefined, { weekday: "long" }),
    window: hour < 11 ? "breakfast" : hour < 14 ? "lunch" : hour < 18 ? "afternoon" : "evening",
    minutesAvailable: 15
  };
};

export const buildLocationSignal = (point: GeoPoint, previousPoint?: GeoPoint, config = cityWalletConfigForPoint(point)): LocationSignal => {
  const speedMps = previousPoint ? distanceMeters(previousPoint, point) / 60 : 0;

  return {
    category: "location",
    userPosition: point,
    movement: speedMps > 1.4 ? "commuting" : speedMps < config.triggerThresholds.browsingSpeedMps ? "browsing" : "stationary",
    speedMps,
    dwellStopsLast10Min: speedMps < config.triggerThresholds.browsingSpeedMps ? 1 : 0,
    nearbyMerchantIds: []
  };
};

export const buildContextState = async (
  point: GeoPoint,
  userId?: string,
  previousPoint?: GeoPoint
): Promise<{ context: ContextState; merchants: Merchant[] }> => {
  const runtimeConfig = getRuntimeConfig();
  const scenarioConfig = cityWalletConfigForPoint(point);
  const time = getTimeSignal();
  const [weather, merchants, events] = await Promise.all([
    fetchWeather(point),
    fetchMerchantsNear(point),
    fetchEventsNear(point)
  ]);
  const demandSignals = merchants.length ? await fetchPayoneDemand(merchants.map((merchant) => merchant.id)) : [];
  const location = {
    ...buildLocationSignal(point, previousPoint, scenarioConfig),
    nearbyMerchantIds: merchants.map((merchant) => merchant.id)
  };

  const nearbyMerchants = merchants.filter((merchant) => {
    const distance = distanceMeters(location.userPosition, merchant.location);
    return distance <= scenarioConfig.triggerThresholds.geofenceRadiusM;
  });

  const rankedMerchantIds = [...nearbyMerchants]
    .sort(
      (a, b) =>
        merchantScore(scenarioConfig, b, location, time, weather, events, getMerchantDemand(b.id, demandSignals)) -
        merchantScore(scenarioConfig, a, location, time, weather, events, getMerchantDemand(a.id, demandSignals))
    )
    .map((merchant) => merchant.id);

  const cold = weather.temperatureC <= scenarioConfig.triggerThresholds.coldTemperatureC;
  const browsing = location.speedMps <= scenarioConfig.triggerThresholds.browsingSpeedMps;
  const quietMerchant = demandSignals.some(
    (signal) => signal.quietnessScore <= scenarioConfig.triggerThresholds.quietnessScore
  );
  const topMerchant = nearbyMerchants.find((merchant) => merchant.id === rankedMerchantIds[0]);
  const topDemand = topMerchant ? getMerchantDemand(topMerchant.id, demandSignals) : undefined;
  const topDemandDeltaPercent = topDemand && topDemand.baselineTransactionsPerHour > 0
    ? Math.round(Math.abs(1 - topDemand.currentTransactionsPerHour / topDemand.baselineTransactionsPerHour) * 100)
    : undefined;
  const topDemandDirection = topDemand && topDemand.currentTransactionsPerHour <= topDemand.baselineTransactionsPerHour
    ? "below"
    : "above";
  const topOpenReason = topMerchant?.openStatus === "open"
    ? `${topMerchant.name} appears open from OSM opening_hours`
    : topMerchant?.openStatus === "closed"
      ? `${topMerchant.name} appears closed from OSM opening_hours`
      : topMerchant
        ? `${topMerchant.name} has no reliable live opening-hours tag in OSM`
        : "No merchant opening status available";
  const eventAdapterConfigured = scenarioConfig.scenario === "egham";
  const eventEvidenceLabel = events[0]?.title || (eventAdapterConfigured
    ? "No live event in range"
    : `No configured event adapter for ${scenarioConfig.city}`);
  const eventEvidenceSource = eventAdapterConfigured
    ? scenarioConfig.signalSources.event
    : `Config needed: no local event adapter for ${scenarioConfig.city}`;
  const eventVisibleReason = events[0]
    ? `Live local event signal: ${events[0].title}`
    : eventAdapterConfigured
      ? "No live local events found near the active area"
      : `No local event adapter is configured for ${scenarioConfig.city}`;

  return {
    merchants,
    context: {
      id: `context-${Date.now()}`,
      city: weather.city,
      userId: userId || runtimeConfig.userId,
      generatedAt: time.localIsoTime,
      signals: [weather, location, time, ...events, ...demandSignals],
      compositeState: [
        cold && "cold",
        browsing && "browsing",
        time.window,
        topMerchant?.openStatus === "open" && "top merchant open",
        topMerchant?.openStatus === "closed" && "top merchant closed",
        quietMerchant && "nearby merchant quiet"
      ]
        .filter(Boolean)
        .join(" + "),
      visibleReasons: [
        `${Math.round(weather.temperatureC)}C and ${weather.condition} in ${weather.city}`,
        `Current movement classified as ${location.movement}`,
        topMerchant
          ? `${topMerchant.name} is within ${Math.round(distanceMeters(location.userPosition, topMerchant.location))}m`
          : "No merchant in active geofence",
        topDemand
          ? `${topDemand.source === "payone_demo" ? "Demo Payone density" : "Payone density"} is ${topDemandDeltaPercent ?? 0}% ${topDemandDirection} baseline (${topDemand.currentTransactionsPerHour}/${topDemand.baselineTransactionsPerHour} tx/hour)`
          : "Payone demand is not connected, so no demand signal was inferred",
        topOpenReason,
        eventVisibleReason,
        `${time.minutesAvailable} minutes available in the ${time.window} window`
      ],
      sourceEvidence: [
        {
          category: "weather",
          label: `${Math.round(weather.temperatureC)}C ${weather.condition}`,
          source: weather.source,
          status: "live"
        },
        {
          category: "location",
          label: `${location.userPosition.latitude.toFixed(5)}, ${location.userPosition.longitude.toFixed(5)}`,
          source: scenarioConfig.signalSources.location,
          status: "device"
        },
        {
          category: "time",
          label: `${time.dayOfWeek} ${time.window}`,
          source: scenarioConfig.signalSources.time,
          status: "device"
        },
        {
          category: "event",
          label: eventEvidenceLabel,
          source: eventEvidenceSource,
          status: events.length || eventAdapterConfigured ? "live" : "not_configured"
        },
        {
          category: "demand",
          label: topDemand
            ? `${topDemand.currentTransactionsPerHour}/${topDemand.baselineTransactionsPerHour} tx/hour`
            : "No transaction-density signal returned",
          source: scenarioConfig.signalSources.demand,
          status: topDemand?.source === "payone_demo" ? "demo" : topDemand ? "live" : "not_configured"
        }
      ],
      candidateMerchantIds: nearbyMerchants.map((merchant) => merchant.id),
      rankedMerchantIds
    }
  };
};

export const getTopMerchant = (context: ContextState, merchants: Merchant[]) => {
  const merchant = merchants.find((candidate) => candidate.id === context.rankedMerchantIds[0]);

  if (!merchant) {
    throw new Error("No ranked merchant available from live context signals.");
  }

  return merchant;
};
