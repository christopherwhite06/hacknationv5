import { getRuntimeConfig } from "../config/runtimeConfig";
import { GeoPoint, WeatherSignal } from "../types";

export const fetchWeather = async (point: GeoPoint): Promise<WeatherSignal> => {
  const config = getRuntimeConfig();
  const url = new URL(`${config.cityWalletApiUrl}/weather/current`);
  url.searchParams.set("lat", String(point.latitude));
  url.searchParams.set("lon", String(point.longitude));

  const response = await fetch(url.toString());

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`City Wallet weather API ${response.status}: ${body}`);
  }

  return response.json() as Promise<WeatherSignal>;
};
