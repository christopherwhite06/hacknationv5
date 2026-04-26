import { getRuntimeConfig } from "../config/runtimeConfig";
import {
  DemandSignal,
  EventSignal,
  GeoPoint,
  AccountProfile,
  AccountType,
  CalendarEvent,
  ConnectorHealth,
  BusinessEventIntelligenceSettings,
  BusinessEventScanCadence,
  BusinessEventScanResult,
  BusinessEventMode,
  LedgerEntry,
  LocalKnowledgeGraph,
  Merchant,
  MerchantRule,
  MerchantAnalytics,
  RedemptionToken,
  WalletUser
} from "../types";

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const config = getRuntimeConfig();
  const response = await fetch(`${config.cityWalletApiUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`City Wallet API ${response.status} for ${path}: ${body}`);
  }

  return response.json() as Promise<T>;
};

const encodePoint = (point: GeoPoint) => `lat=${point.latitude}&lon=${point.longitude}`;

export const fetchWalletUser = (userId?: string) => {
  const config = getRuntimeConfig();
  return requestJson<WalletUser>(`/users/${encodeURIComponent(userId || config.userId)}`);
};

export const createAccount = (account: { username: string; email: string; password: string; accountType: AccountType }) =>
  requestJson<AccountProfile>("/accounts", {
    method: "POST",
    body: JSON.stringify(account)
  });

export const loginAccount = (account: { username: string; email: string; password: string; accountType: AccountType }) =>
  requestJson<AccountProfile>("/sessions", {
    method: "POST",
    body: JSON.stringify(account)
  });

export const fetchMerchantsNear = (point: GeoPoint) =>
  requestJson<Merchant[]>(`/merchants/nearby?${encodePoint(point)}`);

export const fetchEventsNear = (point: GeoPoint) =>
  requestJson<EventSignal[]>(`/events/nearby?${encodePoint(point)}`);

export const fetchPayoneDemand = (merchantIds: string[]) =>
  requestJson<DemandSignal[]>(`/payone/transaction-density?merchantIds=${merchantIds.map(encodeURIComponent).join(",")}`);

export const persistRedemptionToken = (token: RedemptionToken) =>
  requestJson<RedemptionToken>("/redemptions", {
    method: "POST",
    body: JSON.stringify(token)
  });

export const validateRedemptionWithApi = (tokenId: string, merchantId: string, qrPayload?: string) =>
  requestJson<RedemptionToken>(`/redemptions/${encodeURIComponent(tokenId)}/validate`, {
    method: "POST",
    body: JSON.stringify({ merchantId, qrPayload })
  });

export const fetchMerchantAnalytics = (merchantId: string) =>
  requestJson<MerchantAnalytics>(`/merchants/${encodeURIComponent(merchantId)}/analytics`);

export const declineOffer = (offerId: string, merchantId: string) =>
  requestJson<MerchantAnalytics>("/offers/decline", {
    method: "POST",
    body: JSON.stringify({ offerId, merchantId })
  });

export const createMerchantRule = (merchantId: string, rule: MerchantRule) =>
  requestJson<MerchantRule>(`/merchants/${encodeURIComponent(merchantId)}/rules`, {
    method: "POST",
    body: JSON.stringify(rule)
  });

export const fetchBusinessEventIntelligence = (merchantId: string) =>
  requestJson<BusinessEventIntelligenceSettings>(`/merchants/${encodeURIComponent(merchantId)}/event-intelligence`);

export const saveBusinessEventIntelligence = (
  merchantId: string,
  settings: Partial<Pick<
    BusinessEventIntelligenceSettings,
    "manualDiscountPercent" | "minAutoDiscountPercent" | "maxAutoDiscountPercent"
  >> & {
    mode?: BusinessEventMode;
    scanCadence?: BusinessEventScanCadence;
  }
) =>
  requestJson<BusinessEventIntelligenceSettings>(`/merchants/${encodeURIComponent(merchantId)}/event-intelligence`, {
    method: "POST",
    body: JSON.stringify(settings)
  });

export const scanBusinessEvents = (merchant: Merchant, rule?: MerchantRule) =>
  requestJson<BusinessEventScanResult>(`/merchants/${encodeURIComponent(merchant.id)}/event-intelligence/scan`, {
    method: "POST",
    body: JSON.stringify({ merchant, rule })
  });

export const fetchLedger = (userId: string) =>
  requestJson<LedgerEntry[]>(`/users/${encodeURIComponent(userId)}/ledger`);

export const fetchConnectorHealth = () =>
  requestJson<ConnectorHealth[]>("/connectors/health");

export const syncGoogleCalendar = (userId: string, accessToken?: string) =>
  requestJson<CalendarEvent[]>("/integrations/google-calendar/sync", {
    method: "POST",
    body: JSON.stringify({ userId, accessToken })
  });

export const exportKnowledgeGraph = async (graph: LocalKnowledgeGraph) => graph;

export const deleteKnowledgeGraph = () =>
  requestJson<{ deleted: true }>("/privacy/graph", {
    method: "DELETE"
  });
