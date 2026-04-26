import { SignalCategory } from "../types";

export type CityWalletScenario = "egham" | "stuttgart" | "gps";

export interface CityWalletConfig {
  scenario: CityWalletScenario;
  city: string;
  defaultPoint?: {
    latitude: number;
    longitude: number;
    label: string;
  };
  signalSources: Record<SignalCategory, string>;
  triggerThresholds: {
    coldTemperatureC: number;
    quietnessScore: number;
    geofenceRadiusM: number;
    browsingSpeedMps: number;
  };
  scoringWeights: Record<SignalCategory, number>;
}

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

export const eghamConfig: CityWalletConfig = {
  scenario: "egham",
  city: "Egham live area",
  defaultPoint: {
    latitude: 51.42565,
    longitude: -0.56306,
    label: "Royal Holloway / Egham"
  },
  signalSources: {
    weather: "Open-Meteo live weather adapter",
    location: "Device GPS geofence adapter",
    time: "Local device clock",
    event: "Royal Holloway public events page and connected Google Calendar",
    demand: "Google Places popularity/opening metadata and Payone transaction density feed"
  },
  triggerThresholds: {
    coldTemperatureC: 12,
    quietnessScore: 0.35,
    geofenceRadiusM: 250,
    browsingSpeedMps: 0.85
  },
  scoringWeights: {
    weather: 0.18,
    location: 0.25,
    time: 0.14,
    event: 0.1,
    demand: 0.33
  }
};

export const stuttgartConfig: CityWalletConfig = {
  ...eghamConfig,
  scenario: "stuttgart",
  city: "Stuttgart configurable scenario",
  defaultPoint: {
    latitude: 48.7758,
    longitude: 9.1829,
    label: "Stuttgart old town"
  },
  signalSources: {
    ...eghamConfig.signalSources,
    event: "Config needed: connect a Stuttgart event adapter before using event signals",
    demand: "Google Places popularity/opening metadata and Payone transaction density feed"
  }
};

export const gpsConfig: CityWalletConfig = {
  ...eghamConfig,
  scenario: "gps",
  city: "Current GPS area",
  defaultPoint: undefined,
  signalSources: {
    ...eghamConfig.signalSources,
    location: "Current device GPS geofence adapter",
    event: "Config needed outside Egham until a local city event adapter is connected"
  }
};

export const cityWalletConfigs: Record<CityWalletScenario, CityWalletConfig> = {
  egham: eghamConfig,
  stuttgart: stuttgartConfig,
  gps: gpsConfig
};

const requestedScenario = process.env.EXPO_PUBLIC_CITY_WALLET_SCENARIO as CityWalletScenario | undefined;

export const cityWalletConfig = requestedScenario && cityWalletConfigs[requestedScenario]
  ? cityWalletConfigs[requestedScenario]
  : eghamConfig;

export const cityWalletConfigForPoint = (point?: { latitude: number; longitude: number }) => {
  if (!point) {
    return cityWalletConfig;
  }

  const matchedScenario = (["egham", "stuttgart"] as const)
    .map((scenario) => cityWalletConfigs[scenario])
    .find((config) => config.defaultPoint && distanceMeters(point, config.defaultPoint) <= 2000);

  return matchedScenario || gpsConfig;
};
