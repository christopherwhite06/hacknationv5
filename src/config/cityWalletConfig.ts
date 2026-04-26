import { SignalCategory } from "../types";

export interface CityWalletConfig {
  city: string;
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
  city: "Egham live area",
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

export const cityWalletConfig = eghamConfig;
