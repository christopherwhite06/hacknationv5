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
    demand: "Payone transaction density feed or clearly-labelled local demo connector"
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
    event: "Configurable city event adapter; Royal Holloway adapter is active until Stuttgart credentials are connected",
    demand: "Payone transaction density feed or clearly-labelled local demo connector"
  }
};

export const gpsConfig: CityWalletConfig = {
  ...eghamConfig,
  scenario: "gps",
  city: "Current GPS area",
  defaultPoint: undefined,
  signalSources: {
    ...eghamConfig.signalSources,
    location: "Current device GPS geofence adapter"
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
