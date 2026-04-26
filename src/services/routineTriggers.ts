import AsyncStorage from "@react-native-async-storage/async-storage";
import { GeoPoint, RoutineTrigger, TimeSignal } from "../types";

const routineTriggerStorageKey = (ownerId = "guest") =>
  `spark-city-wallet.routine-triggers.${ownerId.replace(/[^a-z0-9_-]/gi, "_")}`;

export const loadRoutineTriggers = async (ownerId = "guest"): Promise<RoutineTrigger[]> => {
  const serialized = await AsyncStorage.getItem(routineTriggerStorageKey(ownerId));
  return serialized ? (JSON.parse(serialized) as RoutineTrigger[]) : [];
};

export const saveRoutineTriggers = (triggers: RoutineTrigger[], ownerId = "guest") =>
  AsyncStorage.setItem(routineTriggerStorageKey(ownerId), JSON.stringify(triggers));

export const distanceMeters = (from: GeoPoint, to: GeoPoint) => {
  const earthRadiusM = 6371000;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const currentTimeWindow = (): TimeSignal["window"] => {
  const hour = new Date().getHours();

  if (hour < 11) {
    return "breakfast";
  }
  if (hour < 15) {
    return "lunch";
  }
  if (hour < 18) {
    return "afternoon";
  }

  return "evening";
};

export const findMatchingRoutineTrigger = (
  triggers: RoutineTrigger[],
  point?: GeoPoint,
  timeWindow = currentTimeWindow()
) =>
  triggers.find((trigger) => {
    if (trigger.lastAskedAt && Date.now() - new Date(trigger.lastAskedAt).getTime() < 60 * 60 * 1000) {
      return false;
    }

    const timeMatches = !trigger.timeOfDay || trigger.timeOfDay === timeWindow;
    const locationMatches =
      !trigger.location ||
      !point ||
      distanceMeters(point, trigger.location) <= (trigger.radiusM || 250);

    return timeMatches && locationMatches;
  });

export const markRoutineTriggerAsked = (triggers: RoutineTrigger[], triggerId: string) =>
  triggers.map((trigger) =>
    trigger.id === triggerId ? { ...trigger, lastAskedAt: new Date().toISOString() } : trigger
  );
