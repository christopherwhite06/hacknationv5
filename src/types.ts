export type SignalCategory = "weather" | "location" | "time" | "event" | "demand";

export type UXChannel = "push" | "in_app_card" | "lock_screen_widget" | "map_banner";

export type RedemptionStatus = "issued" | "validated" | "expired" | "rejected";

export type AccountType = "user" | "business";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface WeatherSignal {
  category: "weather";
  city: string;
  condition: "clear" | "cloudy" | "rain" | "snow";
  temperatureC: number;
  source: "openweathermap" | "dwd" | "openmeteo";
  observedAt: string;
}

export interface LocationSignal {
  category: "location";
  userPosition: GeoPoint;
  movement: "browsing" | "commuting" | "stationary";
  speedMps: number;
  dwellStopsLast10Min: number;
  nearbyMerchantIds: string[];
}

export interface TimeSignal {
  category: "time";
  localIsoTime: string;
  dayOfWeek: string;
  window: "breakfast" | "lunch" | "afternoon" | "evening";
  minutesAvailable: number;
}

export interface EventSignal {
  category: "event";
  title: string;
  startsAt: string;
  distanceM: number;
  expectedDemandImpact: "low" | "medium" | "high";
}

export interface DemandSignal {
  category: "demand";
  merchantId: string;
  currentTransactionsPerHour: number;
  baselineTransactionsPerHour: number;
  quietnessScore: number;
  source: "payone" | "payone_demo";
}

export type ContextSignal =
  | WeatherSignal
  | LocationSignal
  | TimeSignal
  | EventSignal
  | DemandSignal;

export interface MerchantRule {
  id: string;
  merchantId: string;
  goal: "fill_quiet_hours" | "move_surplus" | "first_time_visit" | "increase_repeat_visits";
  maxDiscountPercent: number;
  eligibleProducts: string[];
  validWindows: TimeSignal["window"][];
  dailyRedemptionCap: number;
  brandTone: "cozy" | "premium" | "playful" | "direct";
  forbiddenClaims: string[];
  autoApproveWithinRules: boolean;
  triggerConditions?: Array<"quiet_demand" | "nearby_users" | "cold_weather" | "rain" | "time_window" | "preference_match">;
  audiencePreferences?: string[];
  source?: "merchant" | "demo";
}

export type BusinessEventScanCadence = "manual" | "daily" | "twice_daily" | "weekly";
export type BusinessEventMode = "manual" | "auto";

export interface DiscountAdjustment {
  id: string;
  startsAt: string;
  endsAt: string;
  discountPercent: number;
  reason: string;
  eventTitle?: string;
  status: "scheduled" | "active" | "expired";
}

export interface BusinessEventIntelligenceSettings {
  merchantId: string;
  mode: BusinessEventMode;
  scanCadence: BusinessEventScanCadence;
  manualDiscountPercent: number;
  minAutoDiscountPercent: number;
  maxAutoDiscountPercent: number;
  lastScanAt?: string;
  nextScanAt?: string;
  scheduledAdjustments: DiscountAdjustment[];
}

export interface BusinessEventScanResult {
  merchantId: string;
  scannedAt: string;
  sourceUrl: string;
  events: EventSignal[];
  recommendedDiscountPercent: number;
  decisionSource: "live_event_policy" | "gemma_local" | "config_needed";
  rationale: string[];
  scheduledAdjustments: DiscountAdjustment[];
}

export interface Merchant {
  id: string;
  name: string;
  category: "cafe" | "restaurant" | "retail" | "culture";
  location: GeoPoint;
  address: string;
  openingHours?: string;
  openStatus?: "open" | "closed" | "unknown";
  currentInventorySignals: string[];
  rules: MerchantRule[];
  productHints?: string[];
}

export interface WalletUser {
  id: string;
  name: string;
  walletBalanceCents: number;
}

export interface AccountProfile {
  username: string;
  email: string;
  sessionToken: string;
  accountType: AccountType;
}

export interface LedgerEntry {
  id: string;
  type: "accepted" | "dismissed" | "redeemed" | "cashback";
  title: string;
  merchantName: string;
  amountCents?: number;
  createdAt: string;
}

export interface ConnectorHealth {
  name: string;
  status: "connected" | "degraded" | "not_configured";
  detail: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationName?: string;
  location?: GeoPoint;
  category: "work" | "commute" | "fitness" | "social" | "errand" | "personal";
}

export interface RoutineTrigger {
  id: string;
  question: string;
  sourceEventId?: string;
  timeOfDay?: TimeSignal["window"];
  locationName?: string;
  location?: GeoPoint;
  radiusM?: number;
  lastAskedAt?: string;
}

export interface ContextState {
  id: string;
  city: string;
  userId: string;
  generatedAt: string;
  signals: ContextSignal[];
  compositeState: string;
  visibleReasons: string[];
  sourceEvidence: Array<{
    category: SignalCategory;
    label: string;
    source: string;
    status: "live" | "device" | "demo" | "not_configured";
  }>;
  candidateMerchantIds: string[];
  rankedMerchantIds: string[];
}

export interface GraphNode {
  id: string;
  type: "user" | "preference" | "place" | "offer" | "habit" | "context" | "schedule";
  label: string;
  weight: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: "likes" | "visited" | "ignored" | "accepted" | "redeemed" | "near" | "during" | "often_buys" | "avoids" | "scheduled";
  weight: number;
}

export interface LocalKnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LocalIntent {
  intent: string;
  urgency: string;
  tone: MerchantRule["brandTone"];
  merchantCategory: Merchant["category"];
  productHints: string[];
  confidence: number;
  privacyBudget: "local_only" | "abstract_intent_allowed";
  abstractSignal: string;
  evidence: string[];
}

export interface AgentDealInsight {
  source: "gemini_hermes" | "gemma_local";
  summary: string;
  suggestedProduct: string;
  marketAnchorPriceEur: number;
  confidence: number;
  sourceUrl: string;
  liveBusySignal?: string;
  openStatusSignal?: string;
  localEventTieIn?: string;
}

export interface BrowserSkill {
  id: string;
  origin: string;
  host: string;
  pathHint?: string;
  merchantCategory: Merchant["category"];
  productHints: string[];
  learnedFromUrl: string;
  instruction: string;
  successCount: number;
  lastUsedAt: string;
  createdAt: string;
}

export type BrowserAgentMode =
  | "gemini-3.1-pro-preview"
  | "gemini-3.0-flash-preview"
  | "gemini-3.1-flash-lite-preview"
  | "gemma";

export interface GeneratedOffer {
  id: string;
  merchantId: string;
  ruleId: string;
  title: string;
  body: string;
  cta: string;
  discountPercent: number;
  cashbackCents: number;
  couponCode: string;
  product: string;
  expiresAt: string;
  channel: UXChannel;
  emotionalFrame: string;
  visualTheme: {
    palette: string[];
    imagePrompt: string;
    icon: string;
    themeRationale: string;
  };
  visibleReasons: string[];
  firstThreeSecondFacts: string[];
  generationEvidence: {
    context: string[];
    merchantRule: string;
    dealSource: string;
    privacy: string;
  };
}

export interface RedemptionToken {
  id: string;
  offerId: string;
  merchantId: string;
  ruleId?: string;
  userId: string;
  couponCode: string;
  cashbackCents?: number;
  qrPayload: string;
  issuedAt: string;
  expiresAt: string;
  status: RedemptionStatus;
}

export interface MerchantAnalytics {
  merchantId: string;
  impressions: number;
  accepts: number;
  declines: number;
  redemptions: number;
  cashbackIssuedCents: number;
  acceptRate: number;
  redemptionRate: number;
  quietHourLiftPercent: number;
  quietHourLiftBasis: "not_measured" | "payone_demo" | "payone_live";
  currentCampaignRuleId?: string;
  currentCampaignDailyCap?: number;
  currentCampaignIssuedToday?: number;
  currentCampaignRemainingToday?: number;
}

export interface AiStackValidation {
  localModel: {
    requested: string;
    mvpRuntime: string;
    status: "adapter_ready" | "live_ready" | "blocked";
    privacyBoundary: string;
  };
  cloudAgent: {
    requested: string;
    browserLayer: string;
    status: "adapter_ready" | "live_ready" | "blocked";
    outboundData: string[];
  };
}
