import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import Constants from "expo-constants";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  PanResponder,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import QRCode from "react-native-qrcode-svg";
import Svg, { Line } from "react-native-svg";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cityWalletConfig, cityWalletConfigs } from "./src/config/cityWalletConfig";
import { aiStackValidation, discoverDealInsight } from "./src/services/aiStack";
import { learnBrowserSkillFromDeal, loadRelevantBrowserSkills } from "./src/services/browserSkills";
import { buildContextState } from "./src/services/contextEngine";
import { evaluateContextTrigger } from "./src/services/contextTriggerEngine";
import { generateOffer } from "./src/services/generativeOfferEngine";
import {
  addCalendarEventsToGraph,
  addHomeLocationToGraph,
  graphStorageKeyForOwner,
  inferLocalIntent,
  inferLocalIntentForQuestion,
  loadLocalKnowledgeGraph,
  recordLiveContextInGraph,
  recordManualPromptInGraph,
  recordOfferOutcomeLocally,
  saveLocalKnowledgeGraph
} from "./src/services/localKnowledgeGraph";
import { issueRedemptionToken, loadMerchantAnalytics, validateRedemptionToken } from "./src/services/redemptionService";
import {
  distanceMeters,
  findMatchingRoutineTrigger,
  loadRoutineTriggers,
  markRoutineTriggerAsked,
  saveRoutineTriggers
} from "./src/services/routineTriggers";
import {
  createAccount,
  createMerchantRule,
  deleteKnowledgeGraph,
  declineOffer,
  exportKnowledgeGraph,
  fetchBusinessEventIntelligence,
  fetchConnectorHealth,
  fetchLedger,
  fetchWalletUser,
  loginAccount,
  saveBusinessEventIntelligence,
  scanBusinessEvents,
  syncGoogleCalendar
} from "./src/services/cityWalletApi";
import {
  AccountProfile,
  AccountType,
  BrowserAgentMode,
  BusinessEventIntelligenceSettings,
  BusinessEventScanCadence,
  BusinessEventScanResult,
  CalendarEvent,
  ConnectorHealth,
  ContextState,
  GeneratedOffer,
  GeoPoint,
  LedgerEntry,
  LocalIntent,
  LocalKnowledgeGraph,
  Merchant,
  MerchantRule,
  MerchantAnalytics,
  RedemptionToken,
  RoutineTrigger,
  WalletUser
} from "./src/types";

WebBrowser.maybeCompleteAuthSession();

type Screen = "map" | "demo" | "graph" | "routine" | "offer" | "qr" | "wallet" | "profile" | "merchant";
type ThemeMode = "light" | "dark";
type AuthMode = "login" | "create";
type CurrencyCode = "EUR" | "USD" | "GBP";
type LocationPointSource = "gps" | "simulated" | "map";

type Account = {
  username: string;
  email: string;
  password: string;
  sessionToken?: string;
  accountType: AccountType;
};

const appName = "Spark City Wallet";
const splashLogo = require("./assets/ChatGPT Image Apr 25, 2026, 10_59_28 PM.png");
const appLogo = require("./assets/final_logo.png");
const sparkAgentImage = require("./assets/spark_agent_picture_transparent.png");

const showInAppNotice = async (notice: { title: string; body: string }) => {
  console.info(`[Spark notice] ${notice.title}: ${notice.body}`);
};

const isLegacyStuttgartTestPoint = (point: GeoPoint) =>
  Math.abs(point.latitude - 48.7758) < 0.0002 && Math.abs(point.longitude - 9.1829) < 0.0002;

const hasPreciseLocationPermission = (permission: Location.LocationPermissionResponse) => {
  const androidAccuracy = (permission as Location.LocationPermissionResponse & { android?: { accuracy?: string } }).android?.accuracy;
  return Platform.OS !== "android" || !androidAccuracy || androidAccuracy === "fine";
};

const getStartupLocationPoint = async (): Promise<{ point: GeoPoint; source: LocationPointSource }> => {
  const [permission, servicesEnabled] = await Promise.all([
    Location.requestForegroundPermissionsAsync(),
    Location.hasServicesEnabledAsync()
  ]);

  if (permission.status !== "granted" || !servicesEnabled) {
    throw new Error("Real GPS is required. Enable location permission and device location services to use Spark.");
  }
  if (!hasPreciseLocationPermission(permission)) {
    throw new Error("Precise location is required. Open app location permissions and switch Location accuracy from Approximate to Precise.");
  }

  const current = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Current GPS fix timed out. Move outside or enable precise emulator/device location.")), 12_000);
    })
  ]);

  const point = {
    latitude: current.coords.latitude,
    longitude: current.coords.longitude
  };

  if (isLegacyStuttgartTestPoint(point)) {
    throw new Error("The Android emulator is still reporting the old Stuttgart test GPS point. Set the emulator location to your real UK location or run on your phone.");
  }

  return {
    point,
    source: "gps"
  };
};

const userNavItems: Array<{ id: Screen; label: string }> = [
  { id: "map", label: "Map" },
  { id: "demo", label: "Demo" },
  { id: "offer", label: "Offer" },
  { id: "wallet", label: "Savings" }
];

const businessNavItems: Array<{ id: Screen; label: string }> = [
  { id: "merchant", label: "Business" },
  { id: "demo", label: "Demo" },
  { id: "wallet", label: "Savings" },
  { id: "map", label: "Map" }
];

const storageKeys = {
  account: "city-wallet-account",
  customerAccount: "city-wallet-customer-account",
  businessAccount: "city-wallet-business-account",
  browserAgentMode: "city-wallet-browser-agent-mode",
  currency: "city-wallet-currency",
  homePoint: "city-wallet-home-point",
  onboarding: "city-wallet-onboarding-complete",
  graphResetMarker: "city-wallet-graph-reset-marker",
  graphPaused: "city-wallet-graph-paused",
  theme: "city-wallet-theme"
};
const graphResetVersion = "2026-04-26-fresh-live-graph";
const privacyPausedGraph: LocalKnowledgeGraph = { nodes: [], edges: [] };

const currencyOptions: Array<{ code: CurrencyCode; symbol: string; eurRate: number }> = [
  { code: "EUR", symbol: "EUR", eurRate: 1 },
  { code: "USD", symbol: "USD", eurRate: 1.07 },
  { code: "GBP", symbol: "GBP", eurRate: 0.86 }
];

const browserAgentOptions: Array<{ mode: BrowserAgentMode; label: string }> = [
  { mode: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { mode: "gemini-3.0-flash-preview", label: "Gemini 3.0 Flash" },
  { mode: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
  { mode: "gemma", label: "Gemma 4 private" }
];

const isGeminiBrowserMode = (mode: BrowserAgentMode) => mode !== "gemma";

const formatMoney = (amountCents: number, currency: CurrencyCode) => {
  const option = currencyOptions.find((item) => item.code === currency) || currencyOptions[0];
  const amount = (amountCents / 100) * option.eurRate;

  return `${amount.toFixed(2)} ${option.symbol}`;
};

const addressPart = (value?: string | null) => value?.trim() || undefined;

const formatLocationLabel = (
  address?: Location.LocationGeocodedAddress,
  loading = false,
  source?: LocationPointSource
) => {
  if (loading) {
    return "Finding your current place...";
  }
  if (!address) {
    return "Waiting for your current GPS location...";
  }

  const streetLine = [address.streetNumber, address.street].map(addressPart).filter(Boolean).join(" ");
  const cityLine = [address.postalCode, address.city || address.subregion].map(addressPart).filter(Boolean).join(" ");
  const fullAddress = [streetLine, cityLine, address.region, address.country]
    .map(addressPart)
    .filter(Boolean)
    .join(", ");

  if (fullAddress) {
    return source === "simulated" || source === "map" ? `Selected location: ${fullAddress}` : `You are at ${fullAddress}`;
  }

  const primary = [address.name, address.street].map(addressPart).filter(Boolean).find((value) => value && value !== address.city);
  const area = [address.district, address.city, address.region].map(addressPart).filter(Boolean).slice(0, 2).join(", ");
  const country = addressPart(address.country);
  const label = [primary, area, country].filter(Boolean).join(" - ");

  if (!label) {
    return "Your current place is available, but no address name was returned.";
  }

  return source === "simulated" || source === "map" ? `Selected location near ${label}` : `You are near ${label}`;
};

const ownerStorageId = (account?: Account) => account?.username || "signed-out";
const ownerHomeKey = (ownerId: string) => `${storageKeys.homePoint}.${ownerId.replace(/[^a-z0-9_-]/gi, "_")}`;
const ownerDataKey = (ownerId: string, name: string) => `city-wallet.${name}.${ownerId.replace(/[^a-z0-9_-]/gi, "_")}`;
const homeRadiusM = 90;

const themes = {
  light: {
    mode: "light" as const,
    background: "#FFFFFF",
    surface: "rgba(255,255,255,0.88)",
    surfaceAlt: "rgba(255,244,245,0.92)",
    text: "#111827",
    muted: "#4B5563",
    caption: "#6B7280",
    border: "rgba(227,6,19,0.14)",
    primary: "#E30613",
    primarySoft: "#FFE8EA",
    inverse: "#1A1A1A",
    inverseText: "#FFFFFF",
    successBg: "#EAF7EE",
    successText: "#087443",
    graphLine: "#D9D9D9"
  },
  dark: {
    mode: "dark" as const,
    background: "#190206",
    surface: "rgba(32,4,8,0.84)",
    surfaceAlt: "rgba(69,22,27,0.72)",
    text: "#F5F5F5",
    muted: "#C8C8C8",
    caption: "#A6A6A6",
    border: "#2B3038",
    primary: "#FF3342",
    primarySoft: "#45161B",
    inverse: "#050506",
    inverseText: "#FFFFFF",
    successBg: "#123623",
    successText: "#78D99A",
    graphLine: "#3B3F49"
  }
};

type AppTheme = (typeof themes)[ThemeMode];
type ThemeKit = { theme: AppTheme; styles: ReturnType<typeof createStyles> };
const ThemeContext = createContext<ThemeKit>({ theme: themes.light, styles: createStyles(themes.light) });

const useThemeKit = () => useContext(ThemeContext);

export default function App() {
  const [screen, setScreen] = useState<Screen>("map");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [offer, setOffer] = useState<GeneratedOffer | undefined>();
  const [token, setToken] = useState<RedemptionToken | undefined>();
  const [analytics, setAnalytics] = useState<MerchantAnalytics | undefined>();
  const [eventIntelligence, setEventIntelligence] = useState<BusinessEventIntelligenceSettings | undefined>();
  const [eventScanResult, setEventScanResult] = useState<BusinessEventScanResult | undefined>();
  const [agentStatus, setAgentStatus] = useState("Connecting to local Gemma and Hermes Agent...");
  const [context, setContext] = useState<ContextState | undefined>();
  const [merchant, setMerchant] = useState<Merchant | undefined>();
  const [localIntent, setLocalIntent] = useState<LocalIntent | undefined>();
  const [localGraph, setLocalGraph] = useState<LocalKnowledgeGraph | undefined>();
  const [traversalIndex, setTraversalIndex] = useState(0);
  const [userPoint, setUserPoint] = useState<GeoPoint | undefined>();
  const [locationSource, setLocationSource] = useState<LocationPointSource | undefined>();
  const [homePoint, setHomePoint] = useState<GeoPoint | undefined>();
  const [walletUser, setWalletUser] = useState<WalletUser | undefined>();
  const [account, setAccount] = useState<Account | undefined>();
  const [customerAccount, setCustomerAccount] = useState<Account | undefined>();
  const [businessAccount, setBusinessAccount] = useState<Account | undefined>();
  const [authMode, setAuthMode] = useState<AuthMode>("create");
  const [authForm, setAuthForm] = useState<Account>({ username: "", email: "", password: "", accountType: "user" });
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [connectorHealth, setConnectorHealth] = useState<ConnectorHealth[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [routineTriggers, setRoutineTriggers] = useState<RoutineTrigger[]>([]);
  const [pendingRoutineTrigger, setPendingRoutineTrigger] = useState<RoutineTrigger | undefined>();
  const [calendarAccessToken, setCalendarAccessToken] = useState("");
  const [routineStatus, setRoutineStatus] = useState("Connect Google Calendar to cold-start Spark's routine graph.");
  const [manualPrompt, setManualPrompt] = useState("");
  const [manualPromptMode, setManualPromptMode] = useState<"text" | "voice">("text");
  const [manualPromptStatus, setManualPromptStatus] = useState("Ask Spark for something nearby, like coffee or lunch.");
  const [manualPromptSearching, setManualPromptSearching] = useState(false);
  const [simulatedTravelEnabled, setSimulatedTravelEnabled] = useState(false);
  const [simulatedTravelExpanded, setSimulatedTravelExpanded] = useState(false);
  const [simulatedTravelSpeedKmh, setSimulatedTravelSpeedKmh] = useState("4");
  const [travelStatus, setTravelStatus] = useState("Simulation off. Real GPS is used as the starting point.");
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [graphPaused, setGraphPaused] = useState(false);
  const [browserAgentMode, setBrowserAgentMode] = useState<BrowserAgentMode>("gemini-3.1-pro-preview");
  const [currency, setCurrency] = useState<CurrencyCode>("EUR");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [graphResetComplete, setGraphResetComplete] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mapScrollLocked, setMapScrollLocked] = useState(false);
  const [locationRetryToken, setLocationRetryToken] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [liveSetupError, setLiveSetupError] = useState<string | undefined>();
  const splashEntrance = useRef(new Animated.Value(0)).current;
  const lastNotifiedOfferId = useRef<string | undefined>(undefined);
  const lastLocationAlert = useRef<string | undefined>(undefined);
  const livePipelineInFlight = useRef(false);
  const lastPipelinePoint = useRef<GeoPoint | undefined>(undefined);
  const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const isExpoGo = Constants.appOwnership === "expo";
  const [, googleAuthResponse, promptGoogleAuth] = Google.useAuthRequest({
    androidClientId: googleAndroidClientId,
    webClientId: googleWebClientId,
    scopes: ["openid", "profile", "email", "https://www.googleapis.com/auth/calendar.readonly"]
  });
  const theme = themes[themeMode];
  const styles = useMemo(() => createStyles(theme), [theme]);
  const themeKit = useMemo(() => ({ theme, styles }), [theme, styles]);
  const ownerId = ownerStorageId(account);
  const isAtHome = Boolean(userPoint && homePoint && distanceMeters(userPoint, homePoint) <= homeRadiusM);

  const fetchWalletUserForSession = async () => {
    try {
      return await fetchWalletUser(ownerId);
    } catch (caught) {
      const canRehydrateDevSession = account && caught instanceof Error && /City Wallet API 404 for \/users\//.test(caught.message);
      if (!canRehydrateDevSession) {
        throw caught;
      }

      await createAccount({
        username: account.username,
        email: account.email,
        password: account.password || account.sessionToken || "local-dev-session",
        accountType: account.accountType || "user"
      });
      return fetchWalletUser(ownerId);
    }
  };

  const loadPipelineForPoint = async (point: GeoPoint, statusMessage?: string) => {
    if (livePipelineInFlight.current) {
      return;
    }

    livePipelineInFlight.current = true;
    setLiveSetupError(undefined);
    try {
      const previousPoint = userPoint;
      const [user, { context: liveContext, merchants: liveMerchants }, storedGraph] = await Promise.all([
        fetchWalletUserForSession(),
        buildContextState(point, ownerId, previousPoint),
        loadLocalKnowledgeGraph(ownerId)
      ]);
      const localGraph = graphPaused ? storedGraph : recordLiveContextInGraph(storedGraph, liveContext, liveMerchants);
      const selectedMerchant = liveMerchants.find((candidate) => candidate.id === liveContext.rankedMerchantIds[0]);

      if (!graphPaused) {
        await saveLocalKnowledgeGraph(localGraph, ownerId);
      }
      lastPipelinePoint.current = point;
      setWalletUser(user);
      setUserPoint(point);
      setLocalGraph(localGraph);
      setContext(liveContext);
      setMerchant(selectedMerchant);
      if (selectedMerchant) {
        fetchBusinessEventIntelligence(selectedMerchant.id)
          .then(setEventIntelligence)
          .catch(() => undefined);
      } else {
        setEventIntelligence(undefined);
        setEventScanResult(undefined);
      }

      const intent = await inferLocalIntent(liveContext, graphPaused ? privacyPausedGraph : localGraph);
      const [walletLedger, health] = await Promise.all([
        fetchLedger(user.id),
        fetchConnectorHealth()
      ]);
      setLocalIntent(intent);
      setLedger(walletLedger);
      setConnectorHealth(health);
      await saveOwnerLocalData(ownerId, {
        walletUser: user,
        ledger: walletLedger,
        connectorHealth: health
      });

      if (!selectedMerchant?.rules.length) {
        setOffer(undefined);
        setAnalytics(undefined);
        setAgentStatus(
          selectedMerchant
            ? `Spark used live data near ${selectedMerchant.name}, but no verified merchant campaign rules are active there. It will not invent a fake offer.`
            : "Spark used live location data, but no verified nearby merchant is in range yet."
        );
        return;
      }

      try {
        const browserSkills = graphPaused ? [] : await loadRelevantBrowserSkills(ownerId, intent);
        const dealInsight = await discoverDealInsight(intent, liveContext, browserAgentMode, browserSkills);
        if (!graphPaused) {
          await learnBrowserSkillFromDeal(ownerId, intent, liveContext, dealInsight);
        }
        const offerMerchant = selectedMerchant;
        const generatedOffer = await generateOffer(liveContext, intent, offerMerchant, dealInsight);
        const merchantAnalytics = await loadMerchantAnalytics(offerMerchant.id);

        setMerchant(offerMerchant);
        setOffer(generatedOffer);
        setAnalytics(merchantAnalytics);
        setAgentStatus(
          statusMessage ||
            (graphPaused
              ? "Private graph use is paused. Spark used live context only and did not reuse local graph or browser skills."
              : undefined) ||
            (isGeminiBrowserMode(browserAgentMode)
              ? "Hermes/Gemini returned live deal intelligence using abstract intent only."
              : "Local Gemma generated private deal intelligence without calling the browser agent.")
        );
      } catch (caught) {
        setOffer(undefined);
        setAnalytics(undefined);
        setAgentStatus(
          caught instanceof Error
            ? `Spark loaded live context near ${selectedMerchant.name}, but deal generation stopped: ${caught.message}`
            : `Spark loaded live context near ${selectedMerchant.name}, but deal generation stopped.`
        );
      }
    } finally {
      livePipelineInFlight.current = false;
    }
  };

  const retryPreciseLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status === "granted" && hasPreciseLocationPermission(permission)) {
      setLiveSetupError(undefined);
      setLocationRetryToken((current) => current + 1);
      return;
    }

    await Linking.openSettings();
  };

  useEffect(() => {
    Animated.timing(splashEntrance, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
    const timeout = setTimeout(() => setShowSplash(false), 1400);

    return () => clearTimeout(timeout);
  }, [splashEntrance]);

  useEffect(() => {
    const locationProblem = liveSetupError && /gps|location|precise|emulator/i.test(liveSetupError);
    if (!locationProblem || lastLocationAlert.current === liveSetupError) {
      return;
    }

    lastLocationAlert.current = liveSetupError;
    Alert.alert(
      "Enable precise location",
      `${liveSetupError}\n\nOn Android, choose Allow, then make sure Precise location is turned on for this app.`,
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Request again",
          onPress: () => {
            retryPreciseLocation().catch((caught) => {
              setLiveSetupError(caught instanceof Error ? caught.message : "Could not request location permission.");
            });
          }
        },
        {
          text: "Open Settings",
          onPress: () => {
            Linking.openSettings().catch(() => undefined);
          }
        }
      ]
    );
  }, [liveSetupError]);

  useEffect(() => {
    let active = true;

    const loadStoredPreferences = async () => {
      const [
        storedAccount,
        storedCustomerAccount,
        storedBusinessAccount,
        storedBrowserAgentMode,
        storedCurrency,
        storedOnboarding,
        storedTheme,
        storedGraphPaused
      ] = await Promise.all([
        AsyncStorage.getItem(storageKeys.account),
        AsyncStorage.getItem(storageKeys.customerAccount),
        AsyncStorage.getItem(storageKeys.businessAccount),
        AsyncStorage.getItem(storageKeys.browserAgentMode),
        AsyncStorage.getItem(storageKeys.currency),
        AsyncStorage.getItem(storageKeys.onboarding),
        AsyncStorage.getItem(storageKeys.theme),
        AsyncStorage.getItem(storageKeys.graphPaused)
      ]);

      if (!active) {
        return;
      }

      if (storedAccount) {
        const parsedAccount = JSON.parse(storedAccount) as AccountProfile;
        const activeAccount = { ...parsedAccount, accountType: parsedAccount.accountType || "user", password: "" };
        setAccount(activeAccount);
        if (activeAccount.accountType === "business") {
          setBusinessAccount(activeAccount);
        } else {
          setCustomerAccount(activeAccount);
        }
        const storedOwnerId = parsedAccount.username;
        const [storedWalletUser, storedLedger, storedConnectorHealth, storedCalendarEvents] = await Promise.all([
          AsyncStorage.getItem(ownerDataKey(storedOwnerId, "walletUser")),
          AsyncStorage.getItem(ownerDataKey(storedOwnerId, "ledger")),
          AsyncStorage.getItem(ownerDataKey(storedOwnerId, "connectorHealth")),
          AsyncStorage.getItem(ownerDataKey(storedOwnerId, "calendarEvents"))
        ]);
        if (storedWalletUser) {
          setWalletUser(JSON.parse(storedWalletUser) as WalletUser);
        }
        if (storedLedger) {
          setLedger(JSON.parse(storedLedger) as LedgerEntry[]);
        }
        if (storedConnectorHealth) {
          setConnectorHealth(JSON.parse(storedConnectorHealth) as ConnectorHealth[]);
        }
        if (storedCalendarEvents) {
          setCalendarEvents(JSON.parse(storedCalendarEvents) as CalendarEvent[]);
        }
      }
      if (storedCustomerAccount) {
        const parsedCustomer = JSON.parse(storedCustomerAccount) as AccountProfile;
        setCustomerAccount({ ...parsedCustomer, accountType: "user", password: "" });
      }
      if (storedBusinessAccount) {
        const parsedBusiness = JSON.parse(storedBusinessAccount) as AccountProfile;
        setBusinessAccount({ ...parsedBusiness, accountType: "business", password: "" });
      }
      if (storedTheme === "light" || storedTheme === "dark") {
        setThemeMode(storedTheme);
      }
      if (storedBrowserAgentMode === "gemini") {
        setBrowserAgentMode("gemini-3.1-pro-preview");
      } else if (browserAgentOptions.some((option) => option.mode === storedBrowserAgentMode)) {
        setBrowserAgentMode(storedBrowserAgentMode as BrowserAgentMode);
      }
      if (storedCurrency === "EUR" || storedCurrency === "USD" || storedCurrency === "GBP") {
        setCurrency(storedCurrency);
      }
      setOnboardingComplete(storedOnboarding === "true");
      setGraphPaused(storedGraphPaused === "true");
      setPreferencesLoaded(true);
    };

    loadStoredPreferences().catch((caught) => {
      setError(caught instanceof Error ? caught.message : `Could not load saved ${appName} settings`);
      setPreferencesLoaded(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const clearKnowledgeGraphOnce = async () => {
      if (!preferencesLoaded) {
        return;
      }

      if (!account) {
        if (active) {
          setGraphResetComplete(true);
        }
        return;
      }

      const markerKey = `${storageKeys.graphResetMarker}.${graphResetVersion}`;
      const alreadyReset = await AsyncStorage.getItem(markerKey);

      if (!alreadyReset) {
        const allKeys = await AsyncStorage.getAllKeys();
        const graphKeys = allKeys.filter((key) => key.startsWith("city-wallet.local-knowledge-graph."));
        if (graphKeys.length) {
          await AsyncStorage.multiRemove(graphKeys);
        }
        await deleteKnowledgeGraph().catch(() => undefined);
        await AsyncStorage.setItem(markerKey, "true");
      }

      if (active) {
        setLocalGraph(undefined);
        setTraversalIndex(0);
        setGraphResetComplete(true);
      }
    };

    clearKnowledgeGraphOnce().catch((caught) => {
      if (active) {
        setError(caught instanceof Error ? caught.message : "Could not clear the local knowledge graph.");
        setGraphResetComplete(true);
      }
    });

    return () => {
      active = false;
    };
  }, [account, ownerId, preferencesLoaded]);

  useEffect(() => {
    if (!googleAuthResponse) {
      return;
    }

    if (googleAuthResponse.type === "error") {
      const params = (googleAuthResponse as { params?: Record<string, string> }).params;
      setError(params?.error_description || params?.error || "Google rejected the sign-in request.");
      return;
    }

    if (googleAuthResponse.type !== "success") {
      return;
    }

    const finishGoogleLogin = async () => {
      const accessToken = googleAuthResponse.authentication?.accessToken;

      if (!accessToken) {
        throw new Error("Google login did not return an access token.");
      }

      const response = await fetch("https://www.googleapis.com/userinfo/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error(`Google profile request failed with ${response.status}`);
      }

      const profile = (await response.json()) as { email?: string; name?: string; id?: string };
      const username = profile.name || profile.email?.split("@")[0] || `google-${profile.id || Date.now()}`;
      const email = profile.email || `${username}@google.local`;
      const storedAccount = {
        username,
        email,
        password: "",
        sessionToken: `google-${accessToken.slice(0, 12)}`,
        accountType: "user" as const
      };

      await AsyncStorage.setItem(storageKeys.account, JSON.stringify(storedAccount));
      setAccount(storedAccount);
      setAuthForm({ username, email, password: "", accountType: "user" });
      setCalendarAccessToken(accessToken);
      const walletLedger = await fetchLedger(username);
      setLedger(walletLedger);
      await saveOwnerLocalData(username, { ledger: walletLedger });
    };

    finishGoogleLogin().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Google login failed.");
    });
  }, [googleAuthResponse]);

  useEffect(() => {
    if (!preferencesLoaded || !account || !graphResetComplete) {
      return;
    }

    let active = true;

    const prepareRoutinePrompts = async () => {
      const storedTriggers = await loadRoutineTriggers(ownerId);

      if (!active) {
        return;
      }

      setRoutineTriggers(storedTriggers);
      setRoutineStatus("Expo Go notifications are disabled. Spark will ask routine questions in-app.");
    };

    prepareRoutinePrompts().catch((caught) => {
      setRoutineStatus(caught instanceof Error ? caught.message : "Could not prepare routine prompts.");
    });

    return () => {
      active = false;
    };
  }, [account, browserAgentMode, ownerId, preferencesLoaded]);

  useEffect(() => {
    if (!preferencesLoaded || !account) {
      return;
    }

    let active = true;

    const loadLivePipeline = async () => {
      try {
        const { point, source } = await getStartupLocationPoint();
        if (!active) {
          return;
        }
        setLocationSource(source);

        const savedHome = await AsyncStorage.getItem(ownerHomeKey(ownerId));
        const parsedHome = savedHome ? (JSON.parse(savedHome) as GeoPoint) : undefined;
        const staleHome = parsedHome && distanceMeters(point, parsedHome) > 10_000;
        const resolvedHome = parsedHome && !staleHome ? parsedHome : point;
        if (!savedHome || staleHome) {
          await AsyncStorage.setItem(ownerHomeKey(ownerId), JSON.stringify(resolvedHome));
        }
        const storedGraph = await loadLocalKnowledgeGraph(ownerId);
        const graphWithHome = graphPaused ? storedGraph : addHomeLocationToGraph(storedGraph, resolvedHome);
        if (!graphPaused) {
          await saveLocalKnowledgeGraph(graphWithHome, ownerId);
        }
        if (!active) {
          return;
        }
        setHomePoint(resolvedHome);
        setLocalGraph(graphWithHome);

        setTravelStatus("Real GPS active. Current location is saved as Home, so standing still here will not trigger Spark.");
        await loadPipelineForPoint(
          point,
          "Home waypoint set from real GPS. Spark will suppress standing-still triggers here."
        );
      } catch (caught) {
        if (active) {
          setLiveSetupError(caught instanceof Error ? caught.message : `Unknown ${appName} live setup error`);
        }
      }
    };

    loadLivePipeline();

    return () => {
      active = false;
    };
  }, [account, graphPaused, graphResetComplete, locationRetryToken, ownerId, preferencesLoaded]);

  useEffect(() => {
    if (!account || !preferencesLoaded || simulatedTravelEnabled) {
      return;
    }

    let sub: Location.LocationSubscription | undefined;

    (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        return;
      }
      if (!hasPreciseLocationPermission(permission)) {
        setLiveSetupError("Precise location is required. Open app location permissions and switch Location accuracy from Approximate to Precise.");
        return;
      }
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 12
        },
        (location) => {
          const nextPoint = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          if (isLegacyStuttgartTestPoint(nextPoint)) {
            setLiveSetupError("The Android emulator is still reporting the old Stuttgart test GPS point. Set the emulator location to your real UK location or run on your phone.");
            return;
          }
          setUserPoint(nextPoint);
          setLocationSource("gps");
          const previousPipelinePoint = lastPipelinePoint.current;
          const shouldRefreshLiveContext = !previousPipelinePoint || distanceMeters(nextPoint, previousPipelinePoint) >= 25;
          if (shouldRefreshLiveContext && !livePipelineInFlight.current) {
            void loadPipelineForPoint(nextPoint, "Live GPS moved. Spark refreshed your nearby context and deals.").catch((caught) => {
              setLiveSetupError(caught instanceof Error ? caught.message : "Could not refresh live GPS context.");
            });
          }
        }
      );
    })().catch(() => undefined);

    return () => {
      sub?.remove();
    };
  }, [account, browserAgentMode, graphPaused, ownerId, preferencesLoaded, simulatedTravelEnabled]);

  useEffect(() => {
    if (!localGraph?.edges.length || graphPaused) {
      return;
    }

    const interval = setInterval(() => {
      setTraversalIndex((current) => (current + 1) % localGraph.edges.length);
    }, 1200);

    return () => clearInterval(interval);
  }, [graphPaused, localGraph]);

  useEffect(() => {
    if (isAtHome) {
      return;
    }

    const matchedTrigger = findMatchingRoutineTrigger(routineTriggers, userPoint);

    if (!matchedTrigger || pendingRoutineTrigger) {
      return;
    }

    const updatedTriggers = markRoutineTriggerAsked(routineTriggers, matchedTrigger.id);
    setRoutineTriggers(updatedTriggers);
    saveRoutineTriggers(updatedTriggers, ownerId);
    setPendingRoutineTrigger(matchedTrigger);
    setRoutineStatus("Spark found a routine moment and is asking for permission before searching.");
    showInAppNotice({
      title: "Spark has a question",
      body: matchedTrigger.question
    });
  }, [isAtHome, ownerId, pendingRoutineTrigger, routineTriggers, userPoint]);

  useEffect(() => {
    if (!context || !merchant || !offer || isAtHome || lastNotifiedOfferId.current === offer.id) {
      return;
    }

    const decision = evaluateContextTrigger(context, merchant, offer);

    if (!decision.shouldNotify) {
      return;
    }

    lastNotifiedOfferId.current = offer.id;
    setAgentStatus(`Spark notified because ${decision.reasons.slice(0, 2).join(" and ")}.`);
    showInAppNotice({
      title: decision.title,
      body: decision.body
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Spark could not send the offer notification.");
    });
  }, [context, isAtHome, merchant, offer]);

  useEffect(() => {
    const businessAllowedScreens: Screen[] = ["merchant", "demo", "wallet", "map", "profile", "graph", "routine", "offer", "qr"];

    if (account?.accountType === "business" && !businessAllowedScreens.includes(screen)) {
      setScreen("merchant");
    }
  }, [account?.accountType, screen]);

  const navigatePrimary = (nextScreen: Screen) => {
    setProfileMenuOpen(false);
    setScreen(nextScreen);
  };

  const acceptOffer = async () => {
    if (!offer) {
      return;
    }

    try {
      setError(undefined);
      const issuedToken = await issueRedemptionToken(offer, ownerId);
      setToken(issuedToken);
      setAnalytics(await loadMerchantAnalytics(offer.merchantId));
      const walletLedger = await fetchLedger(issuedToken.userId);
      setLedger(walletLedger);
      await saveOwnerLocalData(issuedToken.userId, { ledger: walletLedger });
      if (!graphPaused) {
        const graph = recordOfferOutcomeLocally(localGraph || (await loadLocalKnowledgeGraph(ownerId)), offer.id, "accepted");
        await saveLocalKnowledgeGraph(graph, ownerId);
        setLocalGraph(graph);
      }
      setAgentStatus(
        graphPaused
          ? "Checkout token issued; private graph use is paused, so the accepted offer was not written to local memory."
          : "Checkout token issued; accepted outcome was recorded in local-only graph memory."
      );
      setScreen("qr");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spark could not issue the checkout token.");
    }
  };

  const redeemOffer = async () => {
    if (!token || !merchant) {
      return;
    }

    try {
      setError(undefined);
      const validatedToken = await validateRedemptionToken(token, merchant.id);
      setToken(validatedToken);
      setAnalytics(await loadMerchantAnalytics(merchant.id));
      const walletLedger = await fetchLedger(validatedToken.userId);
      setLedger(walletLedger);
      await saveOwnerLocalData(validatedToken.userId, { ledger: walletLedger });
      if (!graphPaused) {
        const graph = recordOfferOutcomeLocally(localGraph || (await loadLocalKnowledgeGraph(ownerId)), token.offerId, "redeemed");
        await saveLocalKnowledgeGraph(graph, ownerId);
        setLocalGraph(graph);
      }
      setAgentStatus(
        graphPaused
          ? "Checkout validated; private graph use is paused, so redemption was not written to local memory."
          : "Checkout validated; redeemed outcome was recorded in local-only graph memory."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Merchant checkout validation failed.");
    }
  };

  const dismissOffer = async () => {
    if (!offer || !merchant) {
      return;
    }

    try {
      setError(undefined);
      setAnalytics(await declineOffer(offer.id, merchant.id));
      if (!graphPaused) {
        const graph = recordOfferOutcomeLocally(localGraph || (await loadLocalKnowledgeGraph(ownerId)), offer.id, "dismissed");
        await saveLocalKnowledgeGraph(graph, ownerId);
        setLocalGraph(graph);
      }
      setAgentStatus(
        graphPaused
          ? "Offer dismissed; private graph use is paused, so the decline was not written to local memory."
          : "Offer dismissed; aggregate analytics updated and local-only graph memory recorded the outcome."
      );
      setOffer(undefined);
      setScreen("map");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spark could not dismiss the offer.");
    }
  };

  const walletBalance = walletUser ? formatMoney(walletUser.walletBalanceCents, currency) : "--";
  const saveOwnerLocalData = async (
    targetOwnerId: string,
    patch: Partial<{
      walletUser: WalletUser;
      ledger: LedgerEntry[];
      connectorHealth: ConnectorHealth[];
      calendarEvents: CalendarEvent[];
    }>
  ) => {
    await Promise.all(
      Object.entries(patch).map(([name, value]) =>
        AsyncStorage.setItem(ownerDataKey(targetOwnerId, name), JSON.stringify(value))
      )
    );
  };

  const toggleTheme = async () => {
    const next = themeMode === "light" ? "dark" : "light";
    setThemeMode(next);
    await AsyncStorage.setItem(storageKeys.theme, next);
  };

  const changeBrowserAgentMode = async (mode: BrowserAgentMode) => {
    setBrowserAgentMode(mode);
    await AsyncStorage.setItem(storageKeys.browserAgentMode, mode);
    setAgentStatus(
      isGeminiBrowserMode(mode)
        ? `Browser agent set to ${browserAgentOptions.find((option) => option.mode === mode)?.label || mode} for live deal discovery.`
        : "Browser agent set to local Gemma 4 for fully private, less accurate deal discovery."
    );
  };

  const changeCurrency = async (nextCurrency: CurrencyCode) => {
    setCurrency(nextCurrency);
    await AsyncStorage.setItem(storageKeys.currency, nextCurrency);
  };

  const completeOnboarding = async () => {
    await AsyncStorage.setItem(storageKeys.onboarding, "true");
    setOnboardingComplete(true);
  };

  const submitAuth = async () => {
    setError(undefined);
    try {
      const accountRequest = authMode === "create"
        ? { ...authForm, username: authForm.username.trim(), email: authForm.email.trim() }
        : { ...authForm, email: authForm.email.trim() };
      const profile =
        authMode === "create"
          ? await createAccount(accountRequest)
          : await loginAccount(accountRequest);
      const storedAccount = { ...profile, password: "" };
      await AsyncStorage.setItem(storageKeys.account, JSON.stringify(storedAccount));
      if (storedAccount.accountType === "business") {
        await AsyncStorage.setItem(storageKeys.businessAccount, JSON.stringify(storedAccount));
        setBusinessAccount(storedAccount);
      } else {
        await AsyncStorage.setItem(storageKeys.customerAccount, JSON.stringify(storedAccount));
        setCustomerAccount(storedAccount);
      }
      setAccount(storedAccount);
      setAuthForm({ username: profile.username, email: profile.email, password: "", accountType: profile.accountType });
      const walletLedger = await fetchLedger(profile.username);
      setLedger(walletLedger);
      await saveOwnerLocalData(profile.username, { ledger: walletLedger });
      if (profile.accountType === "business") {
        setScreen("merchant");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account request failed.");
    }
  };

  const switchAccountMode = async (targetType: AccountType) => {
    setProfileMenuOpen(false);
    setError(undefined);

    const targetAccount = targetType === "business" ? businessAccount : customerAccount;
    if (targetAccount) {
      await AsyncStorage.setItem(storageKeys.account, JSON.stringify(targetAccount));
      setAccount(targetAccount);
      setAuthForm({
        username: targetAccount.username,
        email: targetAccount.email,
        password: "",
        accountType: targetAccount.accountType
      });
      setScreen(targetType === "business" ? "merchant" : "map");
      return;
    }

    setAuthMode("create");
    setAuthForm({
      username: targetType === "business" && account?.username ? `${account.username}-business` : account?.username || "",
      email: "",
      password: "",
      accountType: targetType
    });
    setError(
      targetType === "business"
        ? "Create a business account before switching into business mode."
        : "Create a customer account before switching back to customer mode."
    );
    setScreen("profile");
  };

  const signOut = async () => {
    await AsyncStorage.removeItem(storageKeys.account);
    await AsyncStorage.removeItem(storageKeys.customerAccount);
    await AsyncStorage.removeItem(storageKeys.businessAccount);
    setAccount(undefined);
    setCustomerAccount(undefined);
    setBusinessAccount(undefined);
    setWalletUser(undefined);
    setLedger([]);
    setOffer(undefined);
    setToken(undefined);
    setMerchant(undefined);
    setContext(undefined);
    setLocalIntent(undefined);
    setLocalGraph(undefined);
    setHomePoint(undefined);
    setUserPoint(undefined);
    setLocationSource(undefined);
    setScreen("profile");
  };

  const loginWithGoogle = async () => {
    setError(undefined);

    if (isExpoGo && Platform.OS !== "web") {
      setError(
        "Google sign-in cannot run inside Expo Go with an Android OAuth client. Build a development app for package com.sparkcitywallet.app using the same SHA-1, then Google sign-in will use your Android client ID."
      );
      return;
    }

    if (!googleAndroidClientId && Platform.OS !== "web") {
      setError("Add EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID to .env after creating your Google OAuth Android client.");
      return;
    }

    if (Platform.OS === "web" && !googleWebClientId) {
      setError("Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to .env for Google login on web.");
      return;
    }

    await promptGoogleAuth();
  };

  const pauseGraph = async (paused: boolean) => {
    await AsyncStorage.setItem(storageKeys.graphPaused, String(paused));
    setGraphPaused(paused);
  };

  const connectGoogleCalendar = async () => {
    const userId = ownerId;
    const accessToken = calendarAccessToken.trim();

    if (!accessToken) {
      setRoutineStatus("Google Calendar sync requires Google login or a Calendar OAuth access token.");
      return;
    }
    if (graphPaused) {
      setRoutineStatus("Private graph use is paused. Resume graph use before syncing Calendar into routine memory.");
      return;
    }

    setRoutineStatus("Syncing Google Calendar and writing routine signals into the local graph...");
    const events = await syncGoogleCalendar(userId, accessToken);
    const currentGraph = localGraph || (await loadLocalKnowledgeGraph(ownerId));
    const { graph: updatedGraph, triggers } = addCalendarEventsToGraph(currentGraph, events);
    const mergedTriggers = [
      ...triggers,
      ...routineTriggers.filter((trigger) => !triggers.some((candidate) => candidate.id === trigger.id))
    ];

    await Promise.all([
      saveLocalKnowledgeGraph(updatedGraph, ownerId),
      saveRoutineTriggers(mergedTriggers, ownerId),
      showInAppNotice({
        title: "Spark learned your routine",
        body: "Calendar events are now part of your local graph. Spark will ask before searching deals."
      })
    ]);

    setCalendarEvents(events);
    setLocalGraph(updatedGraph);
    setRoutineTriggers(mergedTriggers);
    setPendingRoutineTrigger(triggers[0]);
    const health = await fetchConnectorHealth();
    setConnectorHealth(health);
    await saveOwnerLocalData(ownerId, { calendarEvents: events, connectorHealth: health });
    setRoutineStatus(`${events.length} calendar events added to the local graph. Spark created ${triggers.length} permission prompts.`);
  };

  const answerRoutinePrompt = async (accepted: boolean) => {
    if (!pendingRoutineTrigger) {
      return;
    }

    if (!accepted) {
      setRoutineStatus("Spark skipped this routine search and kept the graph unchanged.");
      setPendingRoutineTrigger(undefined);
      return;
    }

    if (!context || !localGraph || !userPoint) {
      setRoutineStatus("Spark needs live context before searching for a routine deal.");
      return;
    }
    if (graphPaused) {
      setRoutineStatus("Private graph use is paused. Spark will not search routine memory until you resume graph use.");
      return;
    }

    setRoutineStatus(
      isGeminiBrowserMode(browserAgentMode)
        ? "Gemma is searching the local graph with your question, then Hermes/Gemini will look for the best deal."
        : "Gemma is searching the local graph and using local Gemma 4 for private deal discovery."
    );
    const intent = await inferLocalIntentForQuestion(pendingRoutineTrigger.question, context, localGraph);
    const browserSkills = await loadRelevantBrowserSkills(ownerId, intent);
    const dealInsight = await discoverDealInsight(intent, context, browserAgentMode, browserSkills);
    await learnBrowserSkillFromDeal(ownerId, intent, context, dealInsight);
    if (!merchant?.rules.length) {
      setRoutineStatus("No verified merchant rules were found near your real location. Spark will not invent a fallback merchant.");
      return;
    }
    const offerMerchant = merchant;
    const generatedOffer = await generateOffer(context, intent, offerMerchant, dealInsight);

    setLocalIntent(intent);
    setMerchant(offerMerchant);
    setOffer(generatedOffer);
    setPendingRoutineTrigger(undefined);
    setScreen("offer");
    setRoutineStatus("Spark generated a routine-aware offer from your calendar question.");
  };

  const searchFromManualPrompt = async () => {
    const prompt = manualPrompt.trim();

    if (!prompt) {
      setManualPromptStatus("Type what you want Spark to find first.");
      return;
    }

    if (!context || !userPoint) {
      setManualPromptStatus("Spark needs live context before manually searching for deals.");
      return;
    }
    if (graphPaused) {
      setManualPromptStatus("Private graph use is paused. Resume graph use before asking Spark to search your local graph.");
      return;
    }

    setManualPromptSearching(true);
    setManualPromptStatus("Gemma is searching your local graph with this request...");

    try {
      const graph = recordManualPromptInGraph(localGraph || (await loadLocalKnowledgeGraph(ownerId)), prompt);
      await saveLocalKnowledgeGraph(graph, ownerId);
      const intent = await inferLocalIntentForQuestion(prompt, context, graph);
      setManualPromptStatus(
        isGeminiBrowserMode(browserAgentMode)
          ? "Local Gemma found the intent. Hermes/Gemini is now finding the best deal."
          : "Local Gemma found the intent and is privately generating deal intelligence."
      );
      const browserSkills = await loadRelevantBrowserSkills(ownerId, intent);
      const dealInsight = await discoverDealInsight(intent, context, browserAgentMode, browserSkills);
      await learnBrowserSkillFromDeal(ownerId, intent, context, dealInsight);
      if (!merchant?.rules.length) {
        setManualPromptStatus("No verified merchant rules were found near your real location. Spark will not invent a fallback merchant.");
        return;
      }
      const offerMerchant = merchant;
      const generatedOffer = await generateOffer(context, intent, offerMerchant, dealInsight);

      setLocalGraph(graph);
      setLocalIntent(intent);
      setMerchant(offerMerchant);
      setOffer(generatedOffer);
      setAgentStatus(`Spark searched from your prompt: "${prompt}"`);
      setManualPromptStatus("Spark found a deal from your request.");
      setManualPrompt("");
      setScreen("offer");
    } catch (caught) {
      setManualPromptStatus(caught instanceof Error ? caught.message : "Spark could not search from that request.");
    } finally {
      setManualPromptSearching(false);
    }
  };

  const simulateTravelToPoint = async (point: GeoPoint) => {
    try {
      setUserPoint(point);
      setLocationSource(simulatedTravelEnabled ? "simulated" : "map");
      setTravelStatus(
        simulatedTravelEnabled
          ? `Simulated map center moved at ${simulatedTravelSpeedKmh || "0"} km/h to ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}.`
          : `Map moved Spark's active location to ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}.`
      );
      await loadPipelineForPoint(
        point,
        simulatedTravelEnabled
          ? `Simulated map center moved the user dot at ${simulatedTravelSpeedKmh || "0"} km/h and refreshed live context.`
          : "Map movement changed Spark's active area and refreshed live context."
      );
    } catch (caught) {
      setLiveSetupError(caught instanceof Error ? caught.message : "Map movement could not refresh live context.");
    }
  };

  if (showSplash) {
    return (
      <ThemeContext.Provider value={themeKit}>
        <SafeAreaView style={styles.splashScreen}>
          <Animated.View
            style={[
              styles.splashLogo,
              {
                opacity: splashEntrance,
                transform: [
                  {
                    translateY: splashEntrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [28, 0]
                    })
                  },
                  {
                    scale: splashEntrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1]
                    })
                  }
                ]
              }
            ]}
          >
            <SplashLogoMark width={320} />
          </Animated.View>
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  if (!account) {
    return (
      <ThemeContext.Provider value={themeKit}>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} />
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.signInBrand}>
              <AppLogoMark width={380} />
            </View>
            {error && <EmptyState title="Account setup required" body={error} />}
            <ProfileScreen
              account={account}
              authMode={authMode}
              form={authForm}
              walletUser={walletUser}
              browserAgentMode={browserAgentMode}
              currency={currency}
              themeMode={themeMode}
              onChangeMode={setAuthMode}
              onChangeForm={setAuthForm}
              onChangeAccountType={(accountType) => setAuthForm({ ...authForm, accountType })}
              onSubmit={submitAuth}
              onGoogleLogin={loginWithGoogle}
              onSignOut={signOut}
              onChangeBrowserAgentMode={changeBrowserAgentMode}
              onChangeCurrency={changeCurrency}
              graphPaused={graphPaused}
              onPauseGraph={pauseGraph}
              onToggleTheme={toggleTheme}
            />
          </ScrollView>
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  if (!onboardingComplete) {
    return (
      <ThemeContext.Provider value={themeKit}>
        <SafeAreaView style={styles.safeArea}>
          <OnboardingScreen onComplete={completeOnboarding} />
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  const activeNavItems = account.accountType === "business" ? businessNavItems : userNavItems;

  return (
    <ThemeContext.Provider value={themeKit}>
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={themeMode === "dark" ? "light-content" : "dark-content"} />
      <View style={styles.appHeader}>
        <View style={styles.brandRow}>
          <AppLogoMark width={230} />
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => setProfileMenuOpen((current) => !current)}
          >
            <HeaderAvatar account={account} walletUser={walletUser} />
          </TouchableOpacity>
        </View>
      </View>

      {profileMenuOpen && (
        <ProfileMenu
          account={account}
          walletUser={walletUser}
          walletBalance={walletBalance}
          hasBusinessAccount={Boolean(businessAccount)}
          onNavigate={(nextScreen) => {
            setScreen(nextScreen);
            setProfileMenuOpen(false);
          }}
          onSignOut={async () => {
            await signOut();
            setProfileMenuOpen(false);
          }}
          onSwitchMode={switchAccountMode}
          onToggleTheme={toggleTheme}
        />
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.nav}
        style={styles.navScroller}
      >
        {activeNavItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.navButton, screen === item.id && styles.navButtonActive]}
            onPress={() => navigatePrimary(item.id)}
          >
            <Text style={[styles.navText, screen === item.id && styles.navTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!mapScrollLocked}>
        {error && <EmptyState title="Account setup required" body={error} />}

        {screen === "map" && (
          <MapScreen
            agentStatus={agentStatus}
            contextReasons={context?.visibleReasons || []}
            contextSourceEvidence={context?.sourceEvidence || []}
            compositeState={context?.compositeState || "Loading city context"}
            intent={localIntent?.abstractSignal || "Waiting for local Gemma intent"}
            manualPrompt={manualPrompt}
            manualPromptMode={manualPromptMode}
            manualPromptSearching={manualPromptSearching}
            manualPromptStatus={manualPromptStatus}
            offer={offer}
            merchant={merchant}
            localGraph={localGraph}
            traversalIndex={traversalIndex}
            homePoint={homePoint}
            isAtHome={isAtHome}
            simulatedTravelEnabled={simulatedTravelEnabled}
            simulatedTravelExpanded={simulatedTravelExpanded}
            simulatedTravelSpeedKmh={simulatedTravelSpeedKmh}
            travelStatus={travelStatus}
            userPoint={userPoint}
            locationSource={locationSource}
            onChangeSimulatedTravelSpeed={setSimulatedTravelSpeedKmh}
            onChangeManualPrompt={setManualPrompt}
            onChangeManualPromptMode={setManualPromptMode}
            onOpenSimulatedTravelControls={() => setSimulatedTravelExpanded((current) => !current)}
            onOpenOffer={() => setScreen("offer")}
            onDismissOffer={dismissOffer}
            onMapInteractionChange={setMapScrollLocked}
            onSearchManualPrompt={searchFromManualPrompt}
            onSimulatedTravelPoint={simulateTravelToPoint}
            onToggleSimulatedTravel={(enabled) => {
              setSimulatedTravelEnabled(enabled);
              if (!enabled) {
                setLocationSource(undefined);
              }
              setTravelStatus(
                enabled
                  ? "Simulation enabled. Drag the map to move the test user location."
                  : "Simulation off. Real GPS is used as the starting point."
              );
            }}
          />
        )}

        {screen === "map" && liveSetupError && (
          <EmptyState
            title="Live deal setup required"
            body={`${liveSetupError} Spark will not invent weather, event, merchant, or demand signals; fix the connector/configuration and retry. Profile, settings, map movement, and business tools still work.`}
          />
        )}

        {screen === "map" && !context && !liveSetupError && <Text style={styles.loading}>Loading live city context...</Text>}

        {screen === "demo" && (
          <DemoJourneyScreen
            accountType={account.accountType}
            agentStatus={agentStatus}
            analytics={analytics}
            connectorHealth={connectorHealth}
            context={context}
            liveSetupError={liveSetupError}
            merchant={merchant}
            offer={offer}
            token={token}
            onAcceptOffer={acceptOffer}
            onOpenMap={() => setScreen("map")}
            onOpenMerchant={() => setScreen("merchant")}
            onOpenOffer={() => setScreen("offer")}
            onRedeemOffer={redeemOffer}
          />
        )}

        {screen === "graph" && localGraph && (
          <KnowledgeGraphScreen
            graph={localGraph}
            activeEdgeIndex={traversalIndex}
            intent={localIntent}
            graphPaused={graphPaused}
            onPauseGraph={pauseGraph}
            onExportGraph={async () => {
              setLocalGraph(await exportKnowledgeGraph(localGraph));
            }}
            onDeleteGraph={async () => {
              await deleteKnowledgeGraph();
              await AsyncStorage.removeItem(graphStorageKeyForOwner(ownerId));
              setLocalGraph({ nodes: [], edges: [] });
            }}
          />
        )}

        {screen === "graph" && !localGraph && !error && (
          <Text style={styles.loading}>Loading private knowledge graph...</Text>
        )}

        {screen === "routine" && (
          <RoutineScreen
            accessToken={calendarAccessToken}
            calendarEvents={calendarEvents}
            pendingTrigger={pendingRoutineTrigger}
            routineStatus={routineStatus}
            routineTriggers={routineTriggers}
            onAccessTokenChange={setCalendarAccessToken}
            onAnswerPrompt={answerRoutinePrompt}
            onConnectCalendar={connectGoogleCalendar}
          />
        )}

        {screen === "offer" && offer && merchant && (
          <OfferScreen offer={offer} merchantName={merchant.name} onAccept={acceptOffer} onDismiss={dismissOffer} />
        )}

        {screen === "offer" && !offer && <Text style={styles.loading}>Generating offer...</Text>}

        {screen === "qr" && offer && token && (
          <RedemptionScreen currency={currency} offer={offer} token={token} onRedeem={redeemOffer} />
        )}

        {screen === "qr" && (!offer || !token) && (
          <EmptyState title="No active token yet" body="Accept the generated wallet offer to create a one-time QR token." />
        )}

        {screen === "profile" && (
          <ProfileScreen
            account={account}
            authMode={authMode}
            form={authForm}
            walletUser={walletUser}
            browserAgentMode={browserAgentMode}
            currency={currency}
            themeMode={themeMode}
            onChangeMode={setAuthMode}
            onChangeForm={setAuthForm}
            onChangeAccountType={(accountType) => setAuthForm({ ...authForm, accountType })}
            onSubmit={submitAuth}
            onGoogleLogin={loginWithGoogle}
            onSignOut={signOut}
            onChangeBrowserAgentMode={changeBrowserAgentMode}
            onChangeCurrency={changeCurrency}
            graphPaused={graphPaused}
            onPauseGraph={pauseGraph}
            onToggleTheme={toggleTheme}
          />
        )}

        {screen === "wallet" && (
          <WalletLedgerScreen
            ledger={ledger}
            connectorHealth={connectorHealth}
            currentOffer={offer}
            currency={currency}
            walletBalance={walletBalance}
          />
        )}

        {screen === "merchant" && merchant && (
          <MerchantScreen
            analytics={analytics}
            activeOffer={offer}
            eventIntelligence={eventIntelligence}
            eventScanResult={eventScanResult}
            merchant={merchant}
            onSaveRule={async (rule) => {
              const savedRule = await createMerchantRule(merchant.id, rule);
              setMerchant({ ...merchant, rules: [savedRule, ...merchant.rules.filter((item) => item.id !== savedRule.id)] });
            }}
            onSaveEventIntelligence={async (patch) => {
              const saved = await saveBusinessEventIntelligence(merchant.id, patch);
              setEventIntelligence(saved);
            }}
            onScanEvents={async () => {
              const result = await scanBusinessEvents(merchant, merchant.rules[0]);
              setEventScanResult(result);
              setEventIntelligence(await fetchBusinessEventIntelligence(merchant.id));
              return result;
            }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
    </ThemeContext.Provider>
  );
}

function MapScreen({
  agentStatus,
  contextReasons,
  contextSourceEvidence,
  compositeState,
  intent,
  manualPrompt,
  manualPromptMode,
  manualPromptSearching,
  manualPromptStatus,
  offer,
  merchant,
  localGraph,
  traversalIndex,
  homePoint,
  isAtHome,
  simulatedTravelEnabled,
  simulatedTravelExpanded,
  simulatedTravelSpeedKmh,
  travelStatus,
  userPoint,
  locationSource,
  onChangeSimulatedTravelSpeed,
  onChangeManualPrompt,
  onChangeManualPromptMode,
  onOpenSimulatedTravelControls,
  onOpenOffer,
  onDismissOffer,
  onMapInteractionChange,
  onSearchManualPrompt,
  onSimulatedTravelPoint,
  onToggleSimulatedTravel
}: {
  agentStatus: string;
  contextReasons: string[];
  contextSourceEvidence: ContextState["sourceEvidence"];
  compositeState: string;
  intent: string;
  manualPrompt: string;
  manualPromptMode: "text" | "voice";
  manualPromptSearching: boolean;
  manualPromptStatus: string;
  offer?: GeneratedOffer;
  merchant?: Merchant;
  localGraph?: LocalKnowledgeGraph;
  traversalIndex: number;
  homePoint?: GeoPoint;
  isAtHome: boolean;
  simulatedTravelEnabled: boolean;
  simulatedTravelExpanded: boolean;
  simulatedTravelSpeedKmh: string;
  travelStatus: string;
  userPoint?: GeoPoint;
  locationSource?: LocationPointSource;
  onChangeSimulatedTravelSpeed: (speed: string) => void;
  onChangeManualPrompt: (prompt: string) => void;
  onChangeManualPromptMode: (mode: "text" | "voice") => void;
  onOpenSimulatedTravelControls: () => void;
  onOpenOffer: () => void;
  onDismissOffer: () => void;
  onMapInteractionChange: (isInteracting: boolean) => void;
  onSearchManualPrompt: () => void;
  onSimulatedTravelPoint: (point: GeoPoint) => void;
  onToggleSimulatedTravel: (enabled: boolean) => void;
}) {
  const { styles } = useThemeKit();
  const promptInputRef = useRef<TextInput>(null);
  const [mapDealRevealed, setMapDealRevealed] = useState(false);
  const [currentPlace, setCurrentPlace] = useState<Location.LocationGeocodedAddress | undefined>();
  const [currentPlaceLoading, setCurrentPlaceLoading] = useState(false);
  const sparkSpeech = offer && merchant
    ? `${offer.discountPercent} percent cashback on ${offer.product} at ${merchant.name}. Claim it now; it expires in 12 minutes because ${offer.visibleReasons[0] || "your live context matches the merchant guardrails"}.`
    : `I am checking your local context and public internet sources for useful nearby offers.`;

  useEffect(() => {
    if (!offer) {
      setMapDealRevealed(false);
    }
  }, [offer?.id]);

  useEffect(() => {
    if (!userPoint) {
      setCurrentPlace(undefined);
      setCurrentPlaceLoading(false);
      return;
    }

    let active = true;
    setCurrentPlaceLoading(true);

    Location.reverseGeocodeAsync(userPoint)
      .then(([place]) => {
        if (active) {
          setCurrentPlace(place);
        }
      })
      .catch(() => {
        if (active) {
          setCurrentPlace(undefined);
        }
      })
      .finally(() => {
        if (active) {
          setCurrentPlaceLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [locationSource, userPoint?.latitude, userPoint?.longitude]);

  return (
    <>
      <View style={styles.mapShell}>
        <MapSurface
          offerId={offer?.id}
          homePoint={homePoint}
          userPoint={userPoint}
          locationSource={locationSource}
          merchant={merchant}
          simulatedTravelEnabled={simulatedTravelEnabled}
          onMapInteractionChange={onMapInteractionChange}
          onSimulatedTravelPoint={onSimulatedTravelPoint}
          onDealMarkerRevealed={setMapDealRevealed}
        />
        <View style={styles.mapStatusPill}>
          <Text style={styles.mapStatusText}>
            {Platform.OS === "ios" ? "Apple Maps" : Platform.OS === "android" ? "Google Maps + GPS" : "Map"}
          </Text>
        </View>
        <SparkMapAgent message={sparkSpeech} />
      </View>
      <View style={styles.locationReadout}>
        <View style={styles.locationReadoutDot} />
        <Text style={styles.locationReadoutText}>{formatLocationLabel(currentPlace, currentPlaceLoading, locationSource)}</Text>
      </View>

      {offer && merchant && mapDealRevealed && (
        <View style={styles.dealPreviewCard}>
          <View style={styles.sparkMiniFace}>
            <Text style={styles.sparkMiniFaceText}>:)</Text>
          </View>
          <View style={styles.popupTextWrap}>
            <Text style={styles.popupKicker}>Spark found a deal</Text>
            <Text style={styles.popupTitle}>{offer.title}</Text>
            <Text style={styles.popupBody}>{merchant.name} · {offer.discountPercent}% cashback</Text>
          </View>
          <TouchableOpacity style={styles.popupButton} onPress={onOpenOffer}>
            <Text style={styles.popupButtonText}>View</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.listTextWrap}>
            <Text style={styles.sectionTitle}>Ask Spark</Text>
            <Text style={styles.caption}>Gemma checks your local graph, then Spark can search public internet deals too.</Text>
          </View>
          <Text style={styles.statusBadge}>Manual</Text>
        </View>
        <View style={styles.authToggleRow}>
          <TouchableOpacity
            style={[styles.authToggle, manualPromptMode === "text" && styles.authToggleActive]}
            onPress={() => {
              onChangeManualPromptMode("text");
              promptInputRef.current?.focus();
            }}
          >
            <Text style={[styles.authToggleText, manualPromptMode === "text" && styles.authToggleTextActive]}>
              Text
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.authToggle, manualPromptMode === "voice" && styles.authToggleActive]}
            onPress={() => {
              onChangeManualPromptMode("voice");
              promptInputRef.current?.focus();
            }}
          >
            <Text style={[styles.authToggleText, manualPromptMode === "voice" && styles.authToggleTextActive]}>
              Voice
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          ref={promptInputRef}
          style={styles.promptInput}
          placeholder="I want a coffee, find me deals"
          placeholderTextColor="#8A8A8A"
          value={manualPrompt}
          onChangeText={onChangeManualPrompt}
          returnKeyType="search"
          onSubmitEditing={onSearchManualPrompt}
        />
        {manualPromptMode === "voice" && (
          <Text style={styles.caption}>
            Voice mode uses your phone keyboard microphone: tap the prompt field, press the mic, then hit Search.
          </Text>
        )}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.primaryButtonFlex, manualPromptSearching && styles.buttonDisabled]}
            disabled={manualPromptSearching}
            onPress={onSearchManualPrompt}
          >
            <Text style={styles.primaryButtonText}>{manualPromptSearching ? "Searching..." : "Search deals"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => onChangeManualPrompt("I want a coffee, find me deals")}
          >
            <Text style={styles.secondaryButtonText}>Coffee</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.signalPill}>{manualPromptStatus}</Text>
        {isAtHome && (
          <Text style={styles.caption}>
            You are at Home. Spark will save account data locally but will not trigger standing-still prompts here.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Live Context</Text>
          <TouchableOpacity style={styles.statusBadgeButton} onPress={onOpenSimulatedTravelControls}>
            <Text style={styles.statusBadgeText}>{simulatedTravelExpanded ? "Hide sim" : "Simulate"}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.signalPill}>{compositeState || "Watching for a useful moment"}</Text>
        <Text style={styles.muted}>Private intent: {intent}</Text>
        {contextReasons.slice(0, 2).map((reason) => (
          <Text key={reason} style={styles.bullet}>- {reason}</Text>
        ))}
        {contextSourceEvidence.length > 0 && (
          <View style={styles.rulePreview}>
            <Text style={styles.ruleLine}>Source evidence</Text>
            {contextSourceEvidence.map((evidence) => (
              <Text key={`${evidence.category}-${evidence.source}`} style={styles.caption}>
                {evidence.category}: {evidence.label} · {evidence.status.replaceAll("_", " ")}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.caption}>{agentStatus}</Text>
        {simulatedTravelExpanded && (
          <View style={styles.inlineControls}>
            <Text style={styles.ruleLine}>Scenario quick starts</Text>
            <Text style={styles.caption}>
              Current config: {cityWalletConfig.city}. Egham/Stuttgart buttons move the test user with labelled simulation; GPS returns to the device location flow.
            </Text>
            <View style={styles.businessChipRow}>
              {(["egham", "stuttgart"] as const).map((scenario) => {
                const scenarioConfig = cityWalletConfigs[scenario];
                const defaultPoint = scenarioConfig.defaultPoint;

                return (
                  <TouchableOpacity
                    key={scenario}
                    style={styles.ruleChip}
                    disabled={!defaultPoint}
                    onPress={() => {
                      if (!defaultPoint) {
                        return;
                      }
                      onToggleSimulatedTravel(true);
                      onSimulatedTravelPoint({
                        latitude: defaultPoint.latitude,
                        longitude: defaultPoint.longitude
                      });
                    }}
                  >
                    <Text style={styles.ruleChipText}>
                      {scenarioConfig.defaultPoint?.label || scenarioConfig.city}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.ruleChip, locationSource === "gps" && styles.ruleChipActive]}
                onPress={() => onToggleSimulatedTravel(false)}
              >
                <Text style={[styles.ruleChipText, locationSource === "gps" && styles.ruleChipTextActive]}>
                  Current GPS
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.authToggleRow}>
              <TouchableOpacity
                style={[styles.authToggle, simulatedTravelEnabled && styles.authToggleActive]}
                onPress={() => onToggleSimulatedTravel(true)}
              >
                <Text style={[styles.authToggleText, simulatedTravelEnabled && styles.authToggleTextActive]}>
                  Enabled
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.authToggle, !simulatedTravelEnabled && styles.authToggleActive]}
                onPress={() => onToggleSimulatedTravel(false)}
              >
                <Text style={[styles.authToggleText, !simulatedTravelEnabled && styles.authToggleTextActive]}>
                  Disabled
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Travel speed km/h"
              placeholderTextColor="#8A8A8A"
              keyboardType="numeric"
              value={simulatedTravelSpeedKmh}
              onChangeText={(value) => onChangeSimulatedTravelSpeed(value.replace(/[^0-9.]/g, ""))}
            />
            <Text style={styles.caption}>{travelStatus}</Text>
          </View>
        )}
      </View>

      {localGraph && <MapKnowledgeGraphPanel graph={localGraph} activeEdgeIndex={traversalIndex} />}

      <TouchableOpacity style={[styles.primaryButton, !offer && styles.buttonDisabled]} disabled={!offer} onPress={onOpenOffer}>
        <Text style={styles.primaryButtonText}>{offer ? "Open current offer" : "No verified offer yet"}</Text>
      </TouchableOpacity>

      {offer && (
        <TouchableOpacity style={styles.secondaryButton} onPress={onDismissOffer}>
          <Text style={styles.secondaryButtonText}>Not now</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

const pickSparkVoice = async () => {
  const voices = await Speech.getAvailableVoicesAsync();
  return voices.find((voice) => /male|david|mark|alex|daniel|tom|guy/i.test(`${voice.name} ${voice.identifier}`));
};

function SparkMapAgent({ message }: { message: string }) {
  const { styles, theme } = useThemeKit();
  const hover = useRef(new Animated.Value(0)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const bubbleY = useRef(new Animated.Value(8)).current;
  const bubbleScale = useRef(new Animated.Value(0.88)).current;
  const [bubbleOpen, setBubbleOpen] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const speechDurationMs = useMemo(
    () => Math.min(22_000, 1800 + message.length * 52),
    [message]
  );

  const playEntrance = () => {
    bubbleOpacity.setValue(0);
    bubbleY.setValue(10);
    bubbleScale.setValue(0.86);
    Animated.parallel([
      Animated.timing(bubbleOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(bubbleY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.spring(bubbleScale, {
        toValue: 1,
        friction: 7,
        tension: 90,
        useNativeDriver: true
      })
    ]).start();
  };

  const scheduleAutoHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      setBubbleOpen(false);
      Animated.timing(bubbleOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true
      }).start();
    }, speechDurationMs);
  };

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, {
          toValue: -5,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(hover, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    loop.start();

    return () => loop.stop();
  }, [hover]);

  useEffect(() => {
    setBubbleOpen(true);
    playEntrance();
    scheduleAutoHide();

    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, [message]);

  useEffect(() => {
    let active = true;

    const speak = async () => {
      const voice = await pickSparkVoice();

      if (!active) {
        return;
      }

      Speech.stop();
      Speech.speak(message, {
        voice: voice?.identifier,
        language: "en-US",
        pitch: 1.08,
        rate: 0.92
      });
    };

    speak();

    return () => {
      active = false;
      Speech.stop();
    };
  }, [message]);

  const onPressAgent = () => {
    Speech.stop();
    Speech.speak(message, { language: "en-US", pitch: 1.08, rate: 0.92 });

    if (bubbleOpen) {
      setBubbleOpen(false);
      Animated.timing(bubbleOpacity, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    } else {
      setBubbleOpen(true);
      playEntrance();
      scheduleAutoHide();
    }
  };

  return (
    <View style={styles.sparkMapAgent} pointerEvents="box-none">
      {bubbleOpen && (
        <Animated.View
          style={[
            styles.sparkBubbleColumn,
            {
              opacity: bubbleOpacity,
              transform: [{ translateY: bubbleY }, { scale: bubbleScale }]
            }
          ]}
        >
          <View style={[styles.sparkSpeechBubble, { borderColor: theme.border, backgroundColor: theme.mode === "dark" ? "rgba(40,10,16,0.95)" : "rgba(255,255,255,0.96)" }]}>
            <Text style={styles.sparkSpeechText}>{message}</Text>
          </View>
          <View style={[styles.sparkBubbleTail, { borderTopColor: theme.mode === "dark" ? "rgba(40,10,16,0.95)" : "rgba(255,255,255,0.96)" }]} />
        </Animated.View>
      )}
      <Animated.View style={{ transform: [{ translateY: hover }] }}>
        <TouchableOpacity style={styles.sparkAgentBody} onPress={onPressAgent} accessibilityRole="button" accessibilityLabel="Spark agent">
          <Image source={sparkAgentImage} style={styles.sparkAgentImage} resizeMode="contain" />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function MapKnowledgeGraphPanel({
  graph,
  activeEdgeIndex
}: {
  graph: LocalKnowledgeGraph;
  activeEdgeIndex: number;
}) {
  const { styles, theme } = useThemeKit();
  const activeEdge = graph.edges[activeEdgeIndex % Math.max(graph.edges.length, 1)];
  const fromNode = graph.nodes.find((node) => node.id === activeEdge?.from);
  const toNode = graph.nodes.find((node) => node.id === activeEdge?.to);
  const width = 320;
  const height = 260;
  const centerX = width / 2;
  const centerY = height / 2;
  const nodePositions = graph.nodes.map((node, index) => {
    const angle = graph.nodes.length <= 1 ? 0 : (Math.PI * 2 * index) / graph.nodes.length - Math.PI / 2;
    const ring = index === 0 ? 0 : index % 2 === 0 ? 104 : 76;
    const x = index === 0 ? centerX : centerX + Math.cos(angle) * ring;
    const y = index === 0 ? centerY : centerY + Math.sin(angle) * ring;

    return { node, x, y };
  });
  const positionFor = (nodeId: string) => nodePositions.find((position) => position.node.id === nodeId);

  return (
    <View style={styles.mapGraphPanel}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.mapGraphTitle}>Full knowledge graph</Text>
        <Text style={styles.mapGraphCount}>{graph.nodes.length} nodes · {graph.edges.length} edges</Text>
      </View>
      <View style={styles.mapGraphVisual}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} style={styles.mapGraphSvg}>
          {graph.edges.map((edge, index) => {
            const from = positionFor(edge.from);
            const to = positionFor(edge.to);

            if (!from || !to) {
              return null;
            }

            const isActive = edge === activeEdge;
            return (
              <Line
                key={`${edge.from}-${edge.to}-${index}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={isActive ? theme.primary : theme.graphLine}
                strokeOpacity={isActive ? 0.95 : 0.45}
                strokeWidth={isActive ? 3 : 1.5}
              />
            );
          })}
        </Svg>
        {nodePositions.map(({ node, x, y }) => (
          <View
            key={node.id}
            style={[
              styles.mapGraphNodeBubble,
              {
                left: `${(x / width) * 100}%`,
                top: `${(y / height) * 100}%`
              }
            ]}
          >
            <Text numberOfLines={2} style={styles.mapGraphNodeText}>{node.label}</Text>
          </View>
        ))}
      </View>
      <Text numberOfLines={1} style={styles.mapGraphEdgeText}>
        {activeEdge && fromNode && toNode
          ? `Spark traversing: ${fromNode.label} -> ${toNode.label}`
          : "Graph shows only data stored on this device (no demo fixtures). Move or add calendar events to grow it."}
      </Text>
    </View>
  );
}

function SplashLogoMark({ width = 286 }: { width?: number }) {
  return (
    <Image source={splashLogo} style={{ width, height: width }} resizeMode="contain" />
  );
}

function AppLogoMark({ width = 220 }: { width?: number }) {
  return (
    <Image source={appLogo} style={{ width, height: width * 0.667 }} resizeMode="contain" />
  );
}

function HeaderAvatar({ account, walletUser }: { account?: Account; walletUser?: WalletUser }) {
  const { styles } = useThemeKit();
  const displayName = account?.username || walletUser?.name || "Sign in";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <View style={styles.headerAvatar}>
      <Text style={styles.headerAvatarText}>{initials}</Text>
    </View>
  );
}

function ProfileMenu({
  account,
  walletUser,
  walletBalance,
  hasBusinessAccount,
  onNavigate,
  onSignOut,
  onSwitchMode,
  onToggleTheme
}: {
  account?: Account;
  walletUser?: WalletUser;
  walletBalance: string;
  hasBusinessAccount: boolean;
  onNavigate: (screen: Screen) => void;
  onSignOut: () => void;
  onSwitchMode: (accountType: AccountType) => void;
  onToggleTheme: () => void;
}) {
  const { styles } = useThemeKit();
  const displayName = account?.username || walletUser?.name || "Sign in";
  const isBusinessMode = account?.accountType === "business";

  return (
    <View style={styles.profileMenu}>
      <View style={styles.profileMenuHeader}>
        <HeaderAvatar account={account} walletUser={walletUser} />
        <View style={styles.profileHeaderText}>
          <Text style={styles.ruleLine}>{displayName}</Text>
          <Text style={styles.caption}>{account?.email || "Tap Settings to sign in"}</Text>
        </View>
      </View>
      <Text style={styles.savingsMiniText}>Wallet balance: {walletBalance}</Text>
      <View style={styles.menuModeCard}>
        <Text style={styles.caption}>Current mode</Text>
        <Text style={styles.ruleLine}>{isBusinessMode ? "Business" : "Customer"}</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.menuModeButton, !isBusinessMode && styles.menuModeButtonActive]}
            onPress={() => onSwitchMode("user")}
          >
            <Text style={[styles.menuButtonText, !isBusinessMode && styles.menuModeButtonTextActive]}>Customer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuModeButton, isBusinessMode && styles.menuModeButtonActive]}
            onPress={() => onSwitchMode("business")}
          >
            <Text style={[styles.menuButtonText, isBusinessMode && styles.menuModeButtonTextActive]}>
              {hasBusinessAccount || isBusinessMode ? "Business" : "Create business"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.menuGrid}>
        <TouchableOpacity style={styles.menuButton} onPress={() => onNavigate("profile")}>
          <Text style={styles.menuButtonText}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => onNavigate("routine")}>
          <Text style={styles.menuButtonText}>Routine</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => onNavigate("wallet")}>
          <Text style={styles.menuButtonText}>Savings</Text>
        </TouchableOpacity>
        {account?.accountType === "business" && (
          <TouchableOpacity style={styles.menuButton} onPress={() => onNavigate("merchant")}>
            <Text style={styles.menuButtonText}>Business</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryButtonFlex} onPress={onToggleTheme}>
          <Text style={styles.secondaryButtonText}>Toggle theme</Text>
        </TouchableOpacity>
        {account && (
          <TouchableOpacity style={styles.secondaryButtonFlex} onPress={onSignOut}>
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const { styles } = useThemeKit();
  const steps = [
    {
      title: "Meet Spark",
      body: "Spark watches your private city graph locally and looks for useful offer moments without exposing raw habits."
    },
    {
      title: "Local Gemma first",
      body: "Gemma reads your graph on device. Only abstract intent is sent to Hermes and Gemini for live deal discovery."
    },
    {
      title: "You control the data",
      body: "You can pause graph use, export it, or delete it from the Graph tab whenever you want."
    }
  ];

  return (
    <ScrollView contentContainerStyle={styles.onboardingContent}>
      <View style={styles.onboardingLogo}>
        <AppLogoMark width={330} />
      </View>
      <Text style={styles.appTitle}>Your wallet is ready.</Text>
      <Text style={styles.muted}>Here is how Spark creates offers without turning your private graph into cloud data.</Text>

      {steps.map((step, index) => (
        <View key={step.title} style={styles.card}>
          <Text style={styles.channel}>0{index + 1}</Text>
          <Text style={styles.sectionTitle}>{step.title}</Text>
          <Text style={styles.muted}>{step.body}</Text>
        </View>
      ))}

      <TouchableOpacity style={styles.primaryButton} onPress={onComplete}>
        <Text style={styles.primaryButtonText}>Start Spark City Wallet</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DemoJourneyScreen({
  accountType,
  agentStatus,
  analytics,
  connectorHealth,
  context,
  liveSetupError,
  merchant,
  offer,
  token,
  onAcceptOffer,
  onOpenMap,
  onOpenMerchant,
  onOpenOffer,
  onRedeemOffer
}: {
  accountType: AccountType;
  agentStatus: string;
  analytics?: MerchantAnalytics;
  connectorHealth: ConnectorHealth[];
  context?: ContextState;
  liveSetupError?: string;
  merchant?: Merchant;
  offer?: GeneratedOffer;
  token?: RedemptionToken;
  onAcceptOffer: () => void;
  onOpenMap: () => void;
  onOpenMerchant: () => void;
  onOpenOffer: () => void;
  onRedeemOffer: () => void;
}) {
  const { styles } = useThemeKit();
  const tokenReady = token?.status === "issued" || token?.status === "validated";
  const merchantRule = merchant?.rules[0];
  const blocker =
    liveSetupError ||
    (!context ? "Live context has not loaded yet." : undefined) ||
    (!merchant ? "No real nearby merchant is currently ranked inside the geofence." : undefined) ||
    (!merchantRule ? "No merchant-supplied or labelled demo campaign rule is active for the ranked merchant." : undefined) ||
    (!offer ? "No generated offer is available yet. Spark will not show a static fallback offer." : undefined);
  const activeConnectors = connectorHealth.filter((connector) => connector.status !== "not_configured");
  const configNeededConnectorCount = connectorHealth.length - activeConnectors.length;
  const demoConnectorText = connectorHealth
    .filter((connector) => connector.status !== "not_configured" && /demo/i.test(`${connector.name} ${connector.detail}`))
    .map((connector) => `${connector.name}: ${connector.detail}`);
  const liveOrDeviceSignals = context?.sourceEvidence.filter((evidence) => evidence.status === "live" || evidence.status === "device") || [];
  const demoSignalCount = context?.sourceEvidence.filter((evidence) => evidence.status === "demo").length || 0;
  const configNeededSignalCount = context?.sourceEvidence.filter((evidence) => evidence.status === "not_configured").length || 0;
  const sourceStatusSummary = (["live", "device", "demo", "not_configured"] as ContextState["sourceEvidence"][number]["status"][])
    .map((status) => ({
      status,
      count: context?.sourceEvidence.filter((evidence) => evidence.status === status).length || 0
    }))
    .filter((item) => item.count > 0);
  const generatedEvidence = offer?.generationEvidence;
  const checkoutStatus = token
    ? `${token.status} token, ${analytics?.redemptions ?? 0} merchant redemptions`
    : "No token yet; accept the generated offer to issue checkout proof.";
  const judgeCoverage = [
    {
      title: "01 Context sensing",
      status: liveOrDeviceSignals.length >= 2 ? "ready" : "config needed",
      body: context
        ? `${liveOrDeviceSignals.length} live/device signals, ${demoSignalCount} labelled demo signal(s), ${configNeededSignalCount} config-needed source(s). ${context.compositeState || "Composite state pending."}`
        : "Waiting for GPS, weather, OSM merchant, event and demand evidence."
    },
    {
      title: "02 Generative offer",
      status: offer ? "ready" : "blocked",
      body: offer
        ? `${offer.discountPercent}% on ${offer.product}; rule ${generatedEvidence?.merchantRule || offer.ruleId}; deal source ${generatedEvidence?.dealSource || "not reported"}.`
        : "No static offer is shown before the dynamic generation API returns."
    },
    {
      title: "03 Checkout loop",
      status: tokenReady ? token.status : "pending",
      body: checkoutStatus
    },
    {
      title: "Merchant side",
      status: merchantRule ? "ready" : "config needed",
      body: merchantRule
        ? `${merchantRule.source === "demo" ? "Labelled demo" : "Merchant"} rule: ${merchantRule.goal.replaceAll("_", " ")} up to ${merchantRule.maxDiscountPercent}%, cap ${merchantRule.dailyRedemptionCap}.`
        : "Open the merchant dashboard to add guardrails before Spark can generate an offer."
    },
    {
      title: "Privacy boundary",
      status: "visible",
      body: generatedEvidence?.privacy || "Raw graph, routine, preference and precise movement data stay local; cloud calls use abstract intent only."
    },
    {
      title: "Realness audit",
      status: demoConnectorText.length ? "labelled demo" : "live/config",
      body: demoConnectorText.length
        ? "Every demo connector is named below; missing infrastructure remains config-needed instead of silently inventing data."
        : "No demo connector is reporting as enabled; unavailable services stay visible as config-needed."
    }
  ];

  const journeySteps = [
    {
      title: "Context detection",
      status: context ? "ready" : "config needed",
      body: context?.compositeState || blocker || "Waiting for live GPS, weather, OSM places, time and event signals."
    },
    {
      title: "Generated offer",
      status: offer ? "ready" : "blocked",
      body: offer
        ? `${offer.title} at ${merchant?.name || "ranked merchant"} from rule ${offer.ruleId}.`
        : "Offer generation waits for real context, a ranked merchant, a real deal insight and merchant guardrails."
    },
    {
      title: "Accept or decline",
      status: offer ? "ready" : "blocked",
      body: offer
        ? "Accept creates a one-time checkout token; dismiss updates aggregate merchant analytics."
        : "No action is shown until Spark has a generated offer."
    },
    {
      title: "QR/token redemption",
      status: tokenReady ? token.status : "pending",
      body: token
        ? `Token ${token.id} is ${token.status} and expires at ${new Date(token.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "Accept the generated offer to issue a QR/token through the local redemption API."
    },
    {
      title: "Merchant analytics",
      status: analytics ? "ready" : "waiting",
      body: analytics
        ? `${analytics.impressions} impressions, ${analytics.accepts} accepts, ${analytics.declines} declines, ${analytics.redemptions} redemptions.`
        : "Analytics appears after a merchant and generated offer are active."
    }
  ];

  return (
    <>
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.listTextWrap}>
            <Text style={styles.sectionTitle}>Hackathon Demo Readiness</Text>
            <Text style={styles.caption}>
              End-to-end loop from context detection to generated offer, QR/token redemption and merchant analytics.
            </Text>
          </View>
          <Text style={styles.statusBadge}>{accountType === "business" ? "Business" : "Customer"}</Text>
        </View>
        <Text style={styles.signalPill}>{agentStatus}</Text>
        {blocker ? (
          <Text style={styles.muted}>Current blocker: {blocker}</Text>
        ) : (
          <Text style={styles.successText}>The full live/demo-labelled redemption loop is ready to show.</Text>
        )}
        <View style={styles.row}>
          <TouchableOpacity style={styles.secondaryButtonFlex} onPress={onOpenMap}>
            <Text style={styles.secondaryButtonText}>Open live map</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButtonFlex, !offer && styles.buttonDisabled]}
            disabled={!offer}
            onPress={onOpenOffer}
          >
            <Text style={styles.primaryButtonText}>View offer</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Loop Progress</Text>
        {journeySteps.map((step, index) => (
          <View key={step.title} style={styles.ledgerRow}>
            <View style={styles.listTextWrap}>
              <Text style={styles.ruleLine}>{index + 1}. {step.title}</Text>
              <Text style={styles.caption}>{step.body}</Text>
            </View>
            <Text style={styles.statusBadge}>{step.status}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Brief Coverage Evidence</Text>
        <Text style={styles.caption}>
          Judge-facing proof that Spark is covering the required modules without hiding unavailable connectors.
        </Text>
        {judgeCoverage.map((item) => (
          <View key={item.title} style={styles.ledgerRow}>
            <View style={styles.listTextWrap}>
              <Text style={styles.ruleLine}>{item.title}</Text>
              <Text style={styles.caption}>{item.body}</Text>
            </View>
            <Text style={styles.statusBadge}>{item.status}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Visible Source Evidence</Text>
        {sourceStatusSummary.length > 0 && (
          <Text style={styles.caption}>
            {sourceStatusSummary.map((item) => `${item.count} ${item.status.replaceAll("_", " ")}`).join(" · ")}
          </Text>
        )}
        {context?.sourceEvidence.length ? (
          context.sourceEvidence.map((evidence) => (
            <View key={`${evidence.category}-${evidence.source}`} style={styles.ledgerRow}>
              <View style={styles.listTextWrap}>
                <Text style={styles.ruleLine}>{evidence.category}: {evidence.label}</Text>
                <Text style={styles.caption}>{evidence.source}</Text>
              </View>
              <Text style={styles.statusBadge}>{evidence.status.replaceAll("_", " ")}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>
            Source labels appear after live context loads. Missing credentials are shown as unavailable or config-needed, not invented.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Offer UX Requirements</Text>
        <Metric label="Channel" value={offer?.channel.replaceAll("_", " ") || "Waiting for generated offer"} />
        <Metric label="Tone" value={offer?.emotionalFrame || merchantRule?.brandTone || "Set by generated context and merchant rule"} />
        <Metric label="First 3 seconds" value={offer?.firstThreeSecondFacts.slice(0, 3).join(" | ") || "merchant | product | rate"} />
        <Metric
          label="Ends by"
          value={offer ? `expires ${new Date(offer.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, accept, or dismiss` : "expiry/accept/dismiss after generation"}
        />
        {offer && (
          <View style={styles.row}>
            <TouchableOpacity style={styles.primaryButtonFlex} onPress={onAcceptOffer}>
              <Text style={styles.primaryButtonText}>Accept and issue QR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, !tokenReady && styles.buttonDisabled]}
              disabled={!tokenReady}
              onPress={onRedeemOffer}
            >
              <Text style={styles.secondaryButtonText}>Redeem token</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Merchant Readiness</Text>
        <Metric label="Merchant" value={merchant?.name || "No ranked merchant"} />
        <Metric label="Rule source" value={merchantRule?.source === "demo" ? "labelled demo connector" : merchantRule ? "merchant supplied" : "config needed"} />
        <Metric label="Rule guardrail" value={merchantRule ? `${merchantRule.goal.replaceAll("_", " ")} up to ${merchantRule.maxDiscountPercent}%` : "No active rule"} />
        <Metric label="Accept rate" value={`${Math.round((analytics?.acceptRate ?? 0) * 100)}%`} />
        <TouchableOpacity style={styles.secondaryButton} onPress={onOpenMerchant}>
          <Text style={styles.secondaryButtonText}>Open merchant dashboard</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Reality and Privacy Check</Text>
        <Text style={styles.bullet}>- Active/configured connectors visible: {activeConnectors.length}; config-needed connectors: {configNeededConnectorCount}</Text>
        <Text style={styles.bullet}>- Private graph, preferences, routine and precise movement history stay local.</Text>
        <Text style={styles.bullet}>- Cloud/Hermes/Gemini receives only abstract intent plus public context and merchant facts.</Text>
        {demoConnectorText.length ? (
          demoConnectorText.map((item) => <Text key={item} style={styles.bullet}>- Demo-labelled: {item}</Text>)
        ) : (
          <Text style={styles.bullet}>- No demo connector is currently reporting as enabled.</Text>
        )}
      </View>
    </>
  );
}

function RoutineScreen({
  accessToken,
  calendarEvents,
  pendingTrigger,
  routineStatus,
  routineTriggers,
  onAccessTokenChange,
  onAnswerPrompt,
  onConnectCalendar
}: {
  accessToken: string;
  calendarEvents: CalendarEvent[];
  pendingTrigger?: RoutineTrigger;
  routineStatus: string;
  routineTriggers: RoutineTrigger[];
  onAccessTokenChange: (token: string) => void;
  onAnswerPrompt: (accepted: boolean) => void;
  onConnectCalendar: () => void;
}) {
  const { styles } = useThemeKit();

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Google Calendar Routine Sync</Text>
        <Text style={styles.muted}>
          Connect Calendar to cold-start Spark with schedule habits, likely locations, and useful moments of the day.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Optional Google Calendar OAuth access token"
          placeholderTextColor="#8A8A8A"
          autoCapitalize="none"
          secureTextEntry
          value={accessToken}
          onChangeText={onAccessTokenChange}
        />
        <TouchableOpacity style={styles.primaryButton} onPress={onConnectCalendar}>
          <Text style={styles.primaryButtonText}>Sync Google Calendar</Text>
        </TouchableOpacity>
        <Text style={styles.caption}>{routineStatus}</Text>
      </View>

      {pendingTrigger && (
        <View style={styles.successCard}>
          <Text style={styles.sectionTitle}>Spark asks first</Text>
          <Text style={styles.successText}>{pendingTrigger.question}</Text>
          <Text style={styles.caption}>
            If you say yes, Gemma searches the local graph with this question, then Hermes/Gemini finds the best deal.
          </Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.primaryButtonFlex} onPress={() => onAnswerPrompt(true)}>
              <Text style={styles.primaryButtonText}>Yes, search</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => onAnswerPrompt(false)}>
              <Text style={styles.secondaryButtonText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Routine Triggers</Text>
        {routineTriggers.length ? (
          routineTriggers.map((trigger) => (
            <View key={trigger.id} style={styles.ledgerRow}>
              <View style={styles.listTextWrap}>
                <Text style={styles.ruleLine}>{trigger.question}</Text>
                <Text style={styles.caption}>
                  {trigger.timeOfDay || "any time"} · {trigger.locationName || "any location"}
                </Text>
              </View>
              <Text style={styles.statusBadge}>{trigger.radiusM ? `${trigger.radiusM}m` : "time"}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>No routine prompts yet. Sync Google Calendar to create time and location triggers.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Calendar Signals Added</Text>
        {calendarEvents.length ? (
          calendarEvents.map((event) => (
            <View key={event.id} style={styles.ledgerRow}>
              <View style={styles.listTextWrap}>
                <Text style={styles.ruleLine}>{event.title}</Text>
                <Text style={styles.caption}>
                  {new Date(event.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {event.locationName || "No location"}
                </Text>
              </View>
              <Text style={styles.statusBadge}>{event.category}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>Calendar events will appear here after sync and stay local in the graph.</Text>
        )}
      </View>
    </>
  );
}

function ProfileScreen({
  account,
  authMode,
  form,
  walletUser,
  browserAgentMode,
  currency,
  themeMode,
  onChangeMode,
  onChangeForm,
  onChangeAccountType,
  onSubmit,
  onGoogleLogin,
  onSignOut,
  onChangeBrowserAgentMode,
  onChangeCurrency,
  graphPaused,
  onPauseGraph,
  onToggleTheme
}: {
  account?: Account;
  authMode: AuthMode;
  form: Account;
  walletUser?: WalletUser;
  browserAgentMode: BrowserAgentMode;
  currency: CurrencyCode;
  themeMode: ThemeMode;
  onChangeMode: (mode: AuthMode) => void;
  onChangeForm: (form: Account) => void;
  onChangeAccountType: (accountType: AccountType) => void;
  onSubmit: () => void;
  onGoogleLogin: () => void;
  onSignOut: () => void;
  onChangeBrowserAgentMode: (mode: BrowserAgentMode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
  graphPaused: boolean;
  onPauseGraph: (paused: boolean) => Promise<void>;
  onToggleTheme: () => void;
}) {
  const { styles } = useThemeKit();
  const displayName = account?.username || walletUser?.name || "Sign in";
  const initials = displayName.slice(0, 2).toUpperCase();
  const canSubmit = Boolean(
    authMode === "create"
      ? form.username.trim() && form.email.trim() && form.password.trim()
      : form.email.trim() && form.password.trim()
  );
  const accountTypeLabel = form.accountType === "business" ? "business" : "local offers";

  if (account) {
    return (
      <>
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{initials}</Text>
          </View>
          <View style={styles.profileHeaderText}>
            <Text style={styles.kicker}>Profile picture</Text>
            <Text style={styles.sectionTitle}>{displayName}</Text>
            <Text style={styles.caption}>{account.email}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Metric label="Wallet ID" value={walletUser?.id || "Not connected"} />
          <Metric label="Email" value={account.email} />
          <Metric label="Account type" value={account.accountType === "business" ? "Business" : "User"} />
          <TouchableOpacity style={styles.secondaryButton} onPress={onSignOut}>
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <TouchableOpacity style={styles.settingRow} onPress={onToggleTheme}>
            <Text style={styles.ruleLine}>Appearance</Text>
            <Text style={styles.settingValue}>{themeMode === "light" ? "Light" : "Dark"}</Text>
          </TouchableOpacity>
          <View style={styles.settingBlock}>
            <Text style={styles.ruleLine}>Currency</Text>
            <View style={styles.authToggleRow}>
              {currencyOptions.map((option) => (
                <TouchableOpacity
                  key={option.code}
                  style={[styles.authToggle, currency === option.code && styles.authToggleActive]}
                  onPress={() => onChangeCurrency(option.code)}
                >
                  <Text style={[styles.authToggleText, currency === option.code && styles.authToggleTextActive]}>
                    {option.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.settingBlock}>
            <Text style={styles.ruleLine}>Browser agent model</Text>
            <View style={styles.authToggleRow}>
              {browserAgentOptions.map((option) => (
                <TouchableOpacity
                  key={option.mode}
                  style={[styles.authToggle, browserAgentMode === option.mode && styles.authToggleActive]}
                  onPress={() => onChangeBrowserAgentMode(option.mode)}
                >
                  <Text style={[styles.authToggleText, browserAgentMode === option.mode && styles.authToggleTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.caption}>
              Gemini models use Hermes for live deal discovery. Gemma is local/private but cannot browse live sites.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Privacy and Live Data</Text>
          <Text style={styles.caption}>Spark is configured for {cityWalletConfig.city}. These inputs are configurable without changing the offer pipeline.</Text>
          <Text style={styles.bullet}>- Local only: private graph, routine memory, browser skills, raw preferences.</Text>
          <Text style={styles.bullet}>- Live grounding: {Object.values(cityWalletConfig.signalSources).join("; ")}.</Text>
          <Text style={styles.bullet}>- Cloud: Hermes/Gemini receives abstract intent plus public merchant/context facts, not raw movement history.</Text>
          <Text style={styles.bullet}>- Demo: merchant campaign rules and Payone density are labelled demo connectors until production credentials are connected.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onPauseGraph(!graphPaused)}>
            <Text style={styles.secondaryButtonText}>{graphPaused ? "Resume private graph use" : "Pause private graph use"}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sign in</Text>
        <View style={styles.authToggleRow}>
          <TouchableOpacity
            style={[styles.authToggle, form.accountType === "user" && styles.authToggleActive]}
            onPress={() => onChangeAccountType("user")}
          >
            <Text style={[styles.authToggleText, form.accountType === "user" && styles.authToggleTextActive]}>
              Local offers
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.authToggle, form.accountType === "business" && styles.authToggleActive]}
            onPress={() => onChangeAccountType("business")}
          >
            <Text style={[styles.authToggleText, form.accountType === "business" && styles.authToggleTextActive]}>
              My business
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.authToggleRow}>
          <TouchableOpacity
            style={[styles.authToggle, authMode === "create" && styles.authToggleActive]}
            onPress={() => onChangeMode("create")}
          >
            <Text style={[styles.authToggleText, authMode === "create" && styles.authToggleTextActive]}>
              Create account
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.authToggle, authMode === "login" && styles.authToggleActive]}
            onPress={() => onChangeMode("login")}
          >
            <Text style={[styles.authToggleText, authMode === "login" && styles.authToggleTextActive]}>
              Login
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder={authMode === "create" ? "Username" : "Username (not required for login)"}
          placeholderTextColor="#8A8A8A"
          autoCapitalize="none"
          editable={authMode === "create"}
          value={form.username}
          onChangeText={(username) => onChangeForm({ ...form, username })}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#8A8A8A"
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={(email) => onChangeForm({ ...form, email })}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#8A8A8A"
          secureTextEntry
          value={form.password}
          onChangeText={(password) => onChangeForm({ ...form, password })}
        />

        <TouchableOpacity
          style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          <Text style={styles.primaryButtonText}>
            {authMode === "create" ? `Create ${accountTypeLabel} account` : `Login as ${accountTypeLabel}`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.googleButton} onPress={onGoogleLogin}>
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        </TouchableOpacity>

      </View>
    </>
  );
}

const geoToMapPixel = (point: GeoPoint, c: GeoPoint, w: number, h: number) => {
  const latDelta = 0.018;
  const lonDelta = 0.018;
  const leftP = 50 + ((point.longitude - c.longitude) / lonDelta) * 100;
  const topP = 50 + ((c.latitude - point.latitude) / latDelta) * 100;
  const left = Math.max(2, Math.min(98, leftP));
  const top = Math.max(2, Math.min(98, topP));

  return { x: (left / 100) * w, y: (top / 100) * h };
};

const jaggedPathPoints = (from: { x: number; y: number }, to: { x: number; y: number }, seed = 0) => {
  const pts: { x: number; y: number }[] = [from];
  const n = 6;

  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    const wobble = (Math.sin(seed + i * 1.7) * 0.5 + 0.5) * 14;
    const side = (i % 2 === 0 ? 1 : -1) * wobble;
    pts.push({
      x: from.x + (to.x - from.x) * t + side * 0.35,
      y: from.y + (to.y - from.y) * t + side
    });
  }

  pts.push(to);
  return pts;
};

function MapLightningOverlay({
  from,
  to,
  width,
  height,
  color,
  glow
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  width: number;
  height: number;
  color: string;
  glow: string;
}) {
  const pts = useMemo(
    () => jaggedPathPoints(from, to, 2.3),
    [from, from.x, from.y, to, to.x, to.y]
  );

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {pts.slice(0, -1).map((p, i) => (
        <Line
          key={`g-${i}`}
          x1={p.x}
          y1={p.y}
          x2={pts[i + 1]!.x}
          y2={pts[i + 1]!.y}
          stroke={glow}
          strokeWidth={6}
          strokeLinecap="round"
          strokeOpacity={0.4}
        />
      ))}
      {pts.slice(0, -1).map((p, i) => (
        <Line
          key={`c-${i}`}
          x1={p.x}
          y1={p.y}
          x2={pts[i + 1]!.x}
          y2={pts[i + 1]!.y}
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

function MapSurface({
  offerId,
  homePoint,
  userPoint,
  locationSource,
  merchant,
  simulatedTravelEnabled,
  onMapInteractionChange,
  onSimulatedTravelPoint,
  onDealMarkerRevealed
}: {
  offerId?: string;
  homePoint?: GeoPoint;
  userPoint?: GeoPoint;
  locationSource?: LocationPointSource;
  merchant?: Merchant;
  simulatedTravelEnabled: boolean;
  onMapInteractionChange: (isInteracting: boolean) => void;
  onSimulatedTravelPoint: (point: GeoPoint) => void;
  onDealMarkerRevealed: (visible: boolean) => void;
}) {
  const { styles, theme } = useThemeKit();
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const shouldUseGoogleEmbed = Platform.OS === "web" || (Platform.OS === "android" && Constants.appOwnership === "expo");
  const shouldUseNativeMap = Platform.OS !== "web" && !shouldUseGoogleEmbed;
  const mapRef = useRef<InstanceType<typeof MapView> | null>(null);
  const [mapSize, setMapSize] = useState({ w: 360, h: 430 });
  const [mapReady, setMapReady] = useState(!shouldUseNativeMap);
  const [dealMarkerVisible, setDealMarkerVisible] = useState(false);
  const [lightning, setLightning] = useState<null | { from: { x: number; y: number }; to: { x: number; y: number } }>(null);
  const finishedLightningFor = useRef<string | undefined>(undefined);
  const lightningTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const simulatedDragStart = useRef<GeoPoint | undefined>(undefined);
  const center = userPoint ?? merchant?.location;
  const hasRealOrSimulatedUserPoint = Boolean(userPoint);

  const initialRegion = useMemo<Region | undefined>(
    () => center
      ? {
        latitude: center.latitude,
        longitude: center.longitude,
        latitudeDelta: 0.042,
        longitudeDelta: 0.042
      }
      : undefined,
    [center?.latitude, center?.longitude]
  );

  const overlayPosition = (point: GeoPoint) => {
    if (!center) {
      return { left: "50%" as const, top: "50%" as const };
    }
    const latDelta = 0.018;
    const lonDelta = 0.018;
    const left = Math.max(2, Math.min(98, 50 + ((point.longitude - center.longitude) / lonDelta) * 100));
    const top = Math.max(2, Math.min(98, 50 + ((center.latitude - point.latitude) / latDelta) * 100));

    return { left: `${left}%` as const, top: `${top}%` as const };
  };

  const googleMapEmbedSrc = (() => {
    if (!center) {
      return undefined;
    }
    const query = encodeURIComponent(`${center.latitude},${center.longitude}`);
    return `https://www.google.com/maps?q=${query}&z=16&output=embed`;
  })();
  const googleMapEmbedHtml = googleMapEmbedSrc
    ? `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden;background:#f5f5f5;}</style></head><body><iframe title="Google Maps" src="${googleMapEmbedSrc}" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer-when-downgrade"></iframe></body></html>`
    : undefined;

  const simulatedEmbedPanResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => shouldUseGoogleEmbed && Boolean(center),
      onMoveShouldSetPanResponder: () => shouldUseGoogleEmbed && Boolean(center),
      onPanResponderGrant: () => {
        simulatedDragStart.current = center;
      },
      onPanResponderRelease: (_, gesture) => {
        const start = simulatedDragStart.current;
        simulatedDragStart.current = undefined;
        if (!start || !mapSize.w || !mapSize.h) {
          return;
        }
        const latitudeDelta = 0.042;
        const longitudeDelta = 0.042;
        const nextPoint = {
          latitude: start.latitude + (gesture.dy / mapSize.h) * latitudeDelta,
          longitude: start.longitude - (gesture.dx / mapSize.w) * longitudeDelta
        };
        if (!userPoint || distanceMeters(nextPoint, userPoint) >= 5) {
          onSimulatedTravelPoint(nextPoint);
        }
      },
      onPanResponderTerminate: () => {
        simulatedDragStart.current = undefined;
      }
    }),
    [center?.latitude, center?.longitude, mapSize.h, mapSize.w, onSimulatedTravelPoint, shouldUseGoogleEmbed, userPoint?.latitude, userPoint?.longitude]
  );

  useEffect(() => {
    if (!shouldUseNativeMap || !userPoint || !mapRef.current) {
      return;
    }
    mapRef.current.animateToRegion(
      {
        latitude: userPoint.latitude,
        longitude: userPoint.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04
      },
      500
    );
  }, [shouldUseNativeMap, userPoint?.latitude, userPoint?.longitude]);

  const runLightning = async (latLng: GeoPoint) => {
    if (!center) {
      return;
    }
    const from = { x: mapSize.w - 56, y: 64 };
    let to = geoToMapPixel(
      { latitude: latLng.latitude, longitude: latLng.longitude },
      center,
      mapSize.w,
      mapSize.h
    );

    if (shouldUseNativeMap && mapRef.current && mapReady) {
      try {
        to = await mapRef.current.pointForCoordinate(latLng);
      } catch {
        to = geoToMapPixel(
          { latitude: latLng.latitude, longitude: latLng.longitude },
          center,
          mapSize.w,
          mapSize.h
        );
      }
    }

    setLightning({ from, to });
  };

  useEffect(() => {
    if (lightningTimer.current) {
      clearTimeout(lightningTimer.current);
      lightningTimer.current = undefined;
    }

    if (!offerId || !merchant) {
      setDealMarkerVisible(false);
      setLightning(null);
      finishedLightningFor.current = undefined;
      onDealMarkerRevealed(false);
      return;
    }

    if (finishedLightningFor.current === offerId) {
      setDealMarkerVisible(true);
      onDealMarkerRevealed(true);
      return;
    }

    onDealMarkerRevealed(false);
    setDealMarkerVisible(false);

    if (shouldUseNativeMap && !mapReady) {
      return;
    }

    const t = setTimeout(() => {
      void runLightning(merchant.location).then(() => {
        lightningTimer.current = setTimeout(() => {
          setLightning(null);
          finishedLightningFor.current = offerId;
          setDealMarkerVisible(true);
          onDealMarkerRevealed(true);
        }, 900);
      });
    }, 120);
    return () => {
      clearTimeout(t);
      if (lightningTimer.current) {
        clearTimeout(lightningTimer.current);
        lightningTimer.current = undefined;
      }
    };
  }, [offerId, merchant?.id, merchant?.location?.latitude, merchant?.location?.longitude, mapReady, onDealMarkerRevealed, shouldUseNativeMap]);

  const mapContent =
    !center
      ? (
        <View style={styles.mapSetupCard}>
          <Text style={styles.mapSetupTitle}>Real GPS required</Text>
          <Text style={styles.mapSetupText}>Enable precise location. Spark will not show a fake map position.</Text>
          <TouchableOpacity style={styles.mapSetupButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.mapSetupButtonText}>Open location settings</Text>
          </TouchableOpacity>
        </View>
        )
      : Platform.OS === "android" && shouldUseNativeMap && !googleMapsApiKey
        ? (
          <View style={styles.mapSetupCard}>
            <Text style={styles.mapSetupTitle}>Google Maps key required</Text>
            <Text style={styles.mapSetupText}>
              Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY with Android Maps SDK enabled, then rebuild the dev app.
            </Text>
          </View>
          )
        : Platform.OS === "web"
      ? React.createElement("iframe", {
        src: googleMapEmbedSrc!,
        style: {
          border: 0,
          width: "100%",
          height: "100%",
          filter: theme.mode === "dark" ? "invert(90%) hue-rotate(180deg)" : "none"
        },
        loading: "lazy" as "lazy",
        referrerPolicy: "no-referrer-when-downgrade" as "no-referrer-when-downgrade",
        title: "Map"
      })
        : shouldUseGoogleEmbed
          ? (
            <WebView
              source={{ html: googleMapEmbedHtml! }}
              style={styles.mapNative}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              nestedScrollEnabled
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(request) => {
                const url = request.url.toLowerCase();
                return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("about:blank");
              }}
            />
            )
      : (
        <MapView
          ref={mapRef}
          style={styles.mapNative}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          mapType="standard"
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          rotateEnabled
          scrollEnabled
          pitchEnabled
          zoomEnabled
          onMapReady={() => setMapReady(true)}
          onRegionChangeComplete={(region) => {
            const nextPoint = { latitude: region.latitude, longitude: region.longitude };
            if (!userPoint || distanceMeters(nextPoint, userPoint) >= 5) {
              onSimulatedTravelPoint(nextPoint);
            }
          }}
        >
          {homePoint && <Marker coordinate={homePoint} title="Home" />}
          {hasRealOrSimulatedUserPoint && userPoint && !simulatedTravelEnabled && (
            <Marker coordinate={userPoint} title="You" description={locationSource === "simulated" ? "Simulated position" : "Current GPS position"}>
              <View style={styles.currentLocationMarker}>
                <View style={styles.currentLocationHalo} />
                <View style={styles.currentLocationDot} />
              </View>
            </Marker>
          )}
          {dealMarkerVisible && merchant && (
            <Marker
              coordinate={merchant.location}
              title={merchant.name}
              description="Offer location"
            />
          )}
        </MapView>
        );

  return (
    <View
      style={styles.mapFrame}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setMapSize({ w: width, h: height });
      }}
      onTouchStart={() => onMapInteractionChange(true)}
      onTouchEnd={() => onMapInteractionChange(false)}
      onTouchCancel={() => onMapInteractionChange(false)}
    >
      {mapContent}
      {lightning && (
        <View pointerEvents="none" style={styles.mapLightningHost}>
          <MapLightningOverlay
            from={lightning.from}
            to={lightning.to}
            width={mapSize.w}
            height={mapSize.h}
            color="#FDE68A"
            glow={theme.primary}
          />
        </View>
      )}
      {shouldUseGoogleEmbed && userPoint && !simulatedTravelEnabled && (
        <View pointerEvents="none" style={[styles.currentLocationMarkerWeb, overlayPosition(userPoint)]}>
          <View style={styles.currentLocationHalo} />
          <View style={styles.currentLocationDot} />
        </View>
      )}
      {shouldUseGoogleEmbed && dealMarkerVisible && merchant && (
        <View
          pointerEvents="none"
          style={[styles.mapOverlayMarker, styles.mapOverlayMarkerSpark, overlayPosition(merchant.location)]}
        />
      )}
      {simulatedTravelEnabled && userPoint && (
        <View pointerEvents="none" style={styles.currentLocationMarkerCenter}>
          <View style={styles.currentLocationHalo} />
          <View style={styles.currentLocationDot} />
        </View>
      )}
      {shouldUseGoogleEmbed && (
        <View style={styles.mapDragCapture} {...simulatedEmbedPanResponder.panHandlers} />
      )}

      <View pointerEvents={simulatedTravelEnabled ? "box-none" : "none"} style={styles.mapOverlay}>
        {simulatedTravelEnabled && (
          <View pointerEvents="box-none" style={styles.mapSimHint}>
            <Text style={styles.mapSimHintText}>
              Simulation is on. Drag the map, then release; the center glowing dot becomes Spark's live test location.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function OfferScreen({
  offer,
  merchantName,
  onAccept,
  onDismiss
}: {
  offer: GeneratedOffer;
  merchantName: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { styles } = useThemeKit();
  const palette = offer.visualTheme.palette;
  const accent = palette[0] || "#E30613";
  const expiresAt = new Date(offer.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const primaryReason = offer.visibleReasons[0] || offer.generationEvidence.context[0] || "Live context matched merchant guardrails";
  const dealSourceLabel = offer.generationEvidence.dealSource.startsWith("local://")
    ? "Local Gemma evidence"
    : `Public source: ${offer.generationEvidence.dealSource.replace(/^https?:\/\//, "").split("/")[0]}`;
  const privacyLabel = offer.generationEvidence.privacy.toLowerCase().includes("abstract")
    ? "Privacy: abstract intent only"
    : "Privacy: local-only";
  const proofSummary = `${offer.generationEvidence.merchantRule} · ${dealSourceLabel} · ${privacyLabel}`;

  return (
    <>
      <View style={[styles.offerCard, { backgroundColor: accent }]}>
        <Text style={styles.channel}>{offer.channel.replaceAll("_", " ")} · {offer.emotionalFrame}</Text>
        <Text style={styles.offerTitle}>{offer.discountPercent}% cashback</Text>
        <Text style={styles.merchantName}>{merchantName}</Text>
        <Text style={styles.offerBody}>{offer.product} · expires {expiresAt}</Text>
        <View style={styles.factGrid}>
          {offer.firstThreeSecondFacts.map((fact) => (
            <View key={fact} style={styles.fact}>
              <Text style={styles.factText}>{fact}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.offerBody}>{offer.body}</Text>
        <Text style={styles.offerBody}>Why now: {primaryReason}</Text>
        <Text style={styles.offerBody}>Proof: {proofSummary}</Text>
        <View style={styles.factGrid}>
          <View style={styles.fact}>
            <Text style={styles.factText} numberOfLines={1}>{dealSourceLabel}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factText} numberOfLines={1}>{privacyLabel}</Text>
          </View>
        </View>
        <Text style={styles.couponCode}>Code: {offer.couponCode}</Text>

        <View style={styles.row}>
          <TouchableOpacity style={styles.primaryButtonFlex} onPress={onAccept}>
            <Text style={styles.primaryButtonText}>{offer.cta}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onDismiss}>
            <Text style={styles.secondaryButtonText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Generated by Spark City Wallet</Text>
        <Text style={styles.bullet}>- Channel: {offer.channel.replaceAll("_", " ")}</Text>
        <Text style={styles.bullet}>- First 3 seconds: merchant, product, rate, expiry, CTA.</Text>
        <Text style={styles.bullet}>- End state: accept creates QR/token, dismiss records aggregate decline, expiry closes the offer.</Text>
        <Text style={styles.bullet}>- Emotional frame: {offer.emotionalFrame}</Text>
        <Text style={styles.bullet}>- GenUI theme: {offer.visualTheme.icon} · {offer.visualTheme.palette.join(", ")}</Text>
        <Text style={styles.bullet}>- Theme rationale: {offer.visualTheme.themeRationale}</Text>
        <Text style={styles.bullet}>- Offer guardrail: {offer.generationEvidence.merchantRule}</Text>
        <Text style={styles.bullet}>- Deal source: {offer.generationEvidence.dealSource}</Text>
        <Text style={styles.bullet}>- Privacy: {offer.generationEvidence.privacy}</Text>
        <Text style={styles.bullet}>- The merchant supplied guardrails; Spark generated copy, timing, discount, and checkout token.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Why this offer appeared</Text>
        {[...offer.visibleReasons, ...offer.generationEvidence.context].map((reason) => (
          <Text key={reason} style={styles.bullet}>- {reason}</Text>
        ))}
      </View>
    </>
  );
}

function RedemptionScreen({
  currency,
  offer,
  token,
  onRedeem
}: {
  currency: CurrencyCode;
  offer: GeneratedOffer;
  token: RedemptionToken;
  onRedeem: () => void;
}) {
  const { styles } = useThemeKit();
  const tokenExpiresAt = new Date(token.expiresAt);
  const tokenExpired = Date.parse(token.expiresAt) <= Date.now();
  const scanEnabled = token.status === "issued" && !tokenExpired;
  const tokenEndingState = token.status === "validated"
    ? "Redeemed already; this one-time token cannot be scanned again."
    : tokenExpired
      ? "Expired; ask Spark to generate a fresh offer before checkout."
      : `Ready for one merchant scan until ${tokenExpiresAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  let qrProofPreview = "not available";
  let qrContainsUserId = false;
  try {
    const parsedPayload = JSON.parse(token.qrPayload) as { proof?: string; userId?: string };
    qrProofPreview = parsedPayload.proof ? `${parsedPayload.proof.slice(0, 10)}...` : "missing";
    qrContainsUserId = Boolean(parsedPayload.userId);
  } catch {
    qrProofPreview = "invalid payload";
  }

  return (
    <>
      <View style={styles.cardCentered}>
        <Text style={styles.sectionTitle}>Scan to Redeem</Text>
        <View style={styles.qrWrap}>
          <QRCode value={token.qrPayload} size={190} />
        </View>
        <Text style={styles.muted}>Token: {token.id}</Text>
        <Text style={styles.muted}>Coupon code: {token.couponCode}</Text>
        <Text style={styles.muted}>Status: {token.status}</Text>
        <Text style={styles.muted}>Ending state: {tokenEndingState}</Text>
        <Text style={styles.muted}>Cashback: {formatMoney(offer.cashbackCents, currency)}</Text>
        <Text style={styles.muted}>QR proof: {qrProofPreview}</Text>
        <Text style={styles.muted}>
          QR privacy: {qrContainsUserId ? "contains user ID - check failed" : "no user ID in scanned payload"}
        </Text>
      </View>

      <TouchableOpacity style={[styles.primaryButton, !scanEnabled && styles.buttonDisabled]} disabled={!scanEnabled} onPress={onRedeem}>
        <Text style={styles.primaryButtonText}>Validate merchant scan and checkout</Text>
      </TouchableOpacity>

      {token.status === "validated" && (
        <View style={styles.successCard}>
          <Text style={styles.sectionTitle}>Cashback confirmed</Text>
          <Text style={styles.successText}>
            The offer was redeemed at checkout. Merchant analytics updated in aggregate only.
          </Text>
        </View>
      )}
    </>
  );
}

function SavingsSummary({
  confirmedSavingsCents,
  currency,
  currentOffer
}: {
  confirmedSavingsCents: number;
  currency: CurrencyCode;
  currentOffer?: GeneratedOffer;
}) {
  const { styles } = useThemeKit();
  const lift = useRef(new Animated.Value(0)).current;
  const offerRetailCents = currentOffer?.discountPercent
    ? Math.round(currentOffer.cashbackCents / (currentOffer.discountPercent / 100))
    : 0;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(lift, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(lift, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    loop.start();

    return () => loop.stop();
  }, [lift]);

  return (
    <Animated.View
      style={[
        styles.savingsHero,
        {
          transform: [
            {
              translateY: lift.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -4]
              })
            }
          ]
        }
      ]}
    >
      <Text style={styles.savingsKicker}>Savings</Text>
      <Text style={styles.savingsTotal}>{formatMoney(confirmedSavingsCents, currency)}</Text>
      <Text style={styles.savingsBody}>Confirmed money saved from redeemed cashback and discount credits.</Text>

      {currentOffer ? (
        <View style={styles.savingsBreakdown}>
          <View>
            <Text style={styles.savingsHeroMiniText}>Current retail price</Text>
            <Text style={styles.savingsValue}>{formatMoney(offerRetailCents, currency)}</Text>
          </View>
          <View>
            <Text style={styles.savingsHeroMiniText}>{currentOffer.discountPercent}% discount saves</Text>
            <Text style={styles.savingsValue}>{formatMoney(currentOffer.cashbackCents, currency)}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.savingsHeroMiniText}>Spark will show retail comparison when a live offer is generated.</Text>
      )}
    </Animated.View>
  );
}

function WalletLedgerScreen({
  ledger,
  connectorHealth,
  currentOffer,
  currency,
  walletBalance
}: {
  ledger: LedgerEntry[];
  connectorHealth: ConnectorHealth[];
  currentOffer?: GeneratedOffer;
  currency: CurrencyCode;
  walletBalance: string;
}) {
  const { styles } = useThemeKit();
  const confirmedSavingsCents = ledger
    .filter((entry) => (entry.type === "redeemed" || entry.type === "cashback") && Number(entry.amountCents || 0) > 0)
    .reduce((total, entry) => total + Number(entry.amountCents || 0), 0);
  const securityConnectors = connectorHealth.filter((connector) => /qr|proof|secret|checkout/i.test(`${connector.name} ${connector.detail}`));

  return (
    <>
      <SavingsSummary confirmedSavingsCents={confirmedSavingsCents} currency={currency} currentOffer={currentOffer} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Wallet Balance</Text>
        <Text style={styles.appTitle}>{walletBalance}</Text>
        <Text style={styles.caption}>Savings are counted when cashback or discount credits land in your wallet.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Savings History</Text>
        {ledger.length ? (
          ledger.map((entry) => (
            <View key={entry.id} style={styles.ledgerRow}>
              <View>
                <Text style={styles.ruleLine}>{entry.title}</Text>
                <Text style={styles.caption}>{entry.merchantName} · {entry.type}</Text>
              </View>
              <Text style={styles.metricValue}>
                {typeof entry.amountCents === "number" ? formatMoney(entry.amountCents, currency) : ""}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>Your wallet history will appear after Spark creates and redeems offers.</Text>
        )}
      </View>

      {securityConnectors.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Checkout Security Health</Text>
          {securityConnectors.map((connector) => (
            <View key={connector.name} style={styles.settingRow}>
              <View style={styles.listTextWrap}>
                <Text style={styles.ruleLine}>{connector.name}</Text>
                <Text style={styles.caption}>{connector.detail}</Text>
              </View>
              <Text style={styles.statusBadge}>{connector.status.replaceAll("_", " ")}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Live Connectors</Text>
        {connectorHealth.map((connector) => (
          <View key={connector.name} style={styles.settingRow}>
            <View>
              <Text style={styles.ruleLine}>{connector.name}</Text>
              <Text style={styles.caption}>{connector.detail}</Text>
            </View>
            <Text style={styles.statusBadge}>{connector.status.replaceAll("_", " ")}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const businessTriggerOptions: Array<{ id: NonNullable<MerchantRule["triggerConditions"]>[number]; label: string }> = [
  { id: "quiet_demand", label: "Quiet demand" },
  { id: "nearby_users", label: "Nearby users" },
  { id: "cold_weather", label: "Cold weather" },
  { id: "rain", label: "Rain" },
  { id: "time_window", label: "Time window" },
  { id: "preference_match", label: "Preference match" }
];

const preferenceOptions = ["warm drinks", "quick lunch", "books", "gifts", "quiet seating", "fitness"];
const eventScanCadenceOptions: Array<{ id: BusinessEventScanCadence; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "daily", label: "Daily" },
  { id: "twice_daily", label: "Twice daily" },
  { id: "weekly", label: "Weekly" }
];

const toggleListValue = <T extends string>(values: T[] | undefined, value: T) =>
  values?.includes(value) ? values.filter((item) => item !== value) : [...(values || []), value];

const merchantRuleDraftFor = (merchant: Merchant): MerchantRule => ({
  id: `rule-draft-${merchant.id}`,
  merchantId: merchant.id,
  goal: "fill_quiet_hours",
  maxDiscountPercent: 10,
  eligibleProducts: merchant.productHints?.length ? merchant.productHints.slice(0, 3) : ["selected product"],
  validWindows: ["breakfast", "lunch", "afternoon", "evening"],
  dailyRedemptionCap: 20,
  brandTone: "cozy",
  forbiddenClaims: ["free", "guaranteed", "unlimited"],
  autoApproveWithinRules: true,
  triggerConditions: ["nearby_users", "time_window", "preference_match"],
  audiencePreferences: ["quick lunch", "quiet seating"],
  source: "merchant"
});

function MerchantScreen({
  analytics,
  activeOffer,
  eventIntelligence,
  eventScanResult,
  merchant,
  onSaveEventIntelligence,
  onSaveRule,
  onScanEvents
}: {
  analytics?: MerchantAnalytics;
  activeOffer?: GeneratedOffer;
  eventIntelligence?: BusinessEventIntelligenceSettings;
  eventScanResult?: BusinessEventScanResult;
  merchant: Merchant;
  onSaveEventIntelligence: (patch: {
    mode?: BusinessEventIntelligenceSettings["mode"];
    scanCadence?: BusinessEventScanCadence;
    manualDiscountPercent?: number;
    minAutoDiscountPercent?: number;
    maxAutoDiscountPercent?: number;
  }) => Promise<void>;
  onSaveRule: (rule: MerchantRule) => Promise<void>;
  onScanEvents: () => Promise<BusinessEventScanResult>;
}) {
  const { styles } = useThemeKit();
  const rule = useMemo(() => merchant.rules[0] || merchantRuleDraftFor(merchant), [merchant]);
  const hasSavedRule = Boolean(merchant.rules[0]);
  const withBusinessDefaults = (value: MerchantRule): MerchantRule => ({
    ...value,
    triggerConditions: value.triggerConditions || ["quiet_demand", "nearby_users", "preference_match"],
    audiencePreferences: value.audiencePreferences || ["warm drinks", "quick lunch"]
  });
  const [draftRule, setDraftRule] = useState<MerchantRule>(withBusinessDefaults(rule));
  const [scanBusy, setScanBusy] = useState(false);
  const [eventStatus, setEventStatus] = useState<string | undefined>();
  const [savedMessage, setSavedMessage] = useState<string | undefined>();
  const [merchantError, setMerchantError] = useState<string | undefined>();
  const eventSettings = eventIntelligence || {
    merchantId: merchant.id,
    mode: "manual" as const,
    scanCadence: "daily" as const,
    manualDiscountPercent: draftRule.maxDiscountPercent,
    minAutoDiscountPercent: 5,
    maxAutoDiscountPercent: draftRule.maxDiscountPercent,
    scheduledAdjustments: []
  };
  const activeEventAdjustment = eventSettings.scheduledAdjustments.find((adjustment) => adjustment.status === "active");
  const offerEngineRate = activeEventAdjustment?.discountPercent ?? eventSettings.manualDiscountPercent;
  const eventSourceConfigNeeded = eventScanResult?.sourceUrl.startsWith("not_configured://");
  const eventSourceStatus = eventSourceConfigNeeded
    ? "config needed"
    : eventScanResult
      ? "live adapter"
      : "not scanned";
  const ruleGuardrailError =
    draftRule.maxDiscountPercent <= 0
      ? "Campaign max discount must be above 0%."
      : draftRule.dailyRedemptionCap <= 0
        ? "Daily redemption cap must be at least 1."
        : draftRule.eligibleProducts.length === 0
          ? "Add at least one eligible product before saving."
          : undefined;

  useEffect(() => {
    setDraftRule(withBusinessDefaults(rule));
  }, [rule]);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{merchant.name}</Text>
        <Text style={styles.caption}>Merchant rule interface</Text>
        {!hasSavedRule && (
          <Text style={styles.muted}>
            No merchant-supplied campaign rule is saved yet. Fill this in to create real supply-side guardrails.
          </Text>
        )}
        <Text style={styles.ruleLine}>Goal: {rule.goal.replaceAll("_", " ")}</Text>
        <Text style={styles.ruleLine}>Max discount: {rule.maxDiscountPercent}%</Text>
        <Text style={styles.ruleLine}>Eligible products: {rule.eligibleProducts.join(", ")}</Text>
        <Text style={styles.ruleLine}>Valid windows: {rule.validWindows.join(", ")}</Text>
        <Text style={styles.ruleLine}>Source: {rule.source === "demo" ? "Demo connector" : hasSavedRule ? "Merchant supplied" : "Draft only"}</Text>
        <Text style={styles.ruleLine}>Triggers: {(rule.triggerConditions || []).join(", ") || "Not set"}</Text>
        <Text style={styles.ruleLine}>Audience: {(rule.audiencePreferences || []).join(", ") || "All nearby users"}</Text>
        <Text style={styles.ruleLine}>Daily cap: {rule.dailyRedemptionCap}</Text>
        <Text style={styles.ruleLine}>Auto approval: {rule.autoApproveWithinRules ? "within rules" : "manual"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Live Event Intelligence</Text>
        <Text style={styles.caption}>
          Spark scans live local events within the next 7 days. Auto mode schedules bounded discount changes from real event evidence.
        </Text>
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.ruleLine}>Mode</Text>
            <Text style={styles.caption}>{eventSettings.mode === "auto" ? "Spark schedules event-based rates" : "You approve/edit rates manually"}</Text>
          </View>
          <TouchableOpacity
            style={[styles.ruleChip, eventSettings.mode === "auto" && styles.ruleChipActive]}
            onPress={async () => {
              const nextMode = eventSettings.mode === "auto" ? "manual" : "auto";
              try {
                await onSaveEventIntelligence({ mode: nextMode });
                setMerchantError(undefined);
                setEventStatus(nextMode === "auto" ? "Auto mode enabled. Run a scan to schedule event-based rates." : "Manual mode enabled.");
              } catch (caught) {
                setMerchantError(caught instanceof Error ? caught.message : "Could not update event mode.");
              }
            }}
          >
            <Text style={[styles.ruleChipText, eventSettings.mode === "auto" && styles.ruleChipTextActive]}>
              {eventSettings.mode === "auto" ? "Auto on" : "Auto off"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.ruleLine}>Scan frequency</Text>
        <View style={styles.businessChipRow}>
          {eventScanCadenceOptions.map((option) => {
            const active = eventSettings.scanCadence === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.ruleChip, active && styles.ruleChipActive]}
                onPress={async () => {
                  try {
                    await onSaveEventIntelligence({ scanCadence: option.id });
                    setMerchantError(undefined);
                    setEventStatus(`Event scan cadence set to ${option.label}.`);
                  } catch (caught) {
                    setMerchantError(caught instanceof Error ? caught.message : "Could not update event scan cadence.");
                  }
                }}
              >
                <Text style={[styles.ruleChipText, active && styles.ruleChipTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.rulePreview}>
          <Text style={styles.ruleLine}>Offer engine rate: {offerEngineRate}%</Text>
          <Text style={styles.caption}>
            {activeEventAdjustment
              ? `Active event adjustment from ${activeEventAdjustment.eventTitle || "live event intelligence"} is driving the next generated offer.`
              : "Manual merchant rate is driving the next generated offer, bounded by the campaign max discount guardrail."}
          </Text>
        </View>
        <View style={styles.eventRateGrid}>
          <View style={styles.eventRateBox}>
            <Text style={styles.caption}>Manual rate</Text>
            <TextInput
              style={styles.input}
              placeholder="Manual %"
              placeholderTextColor="#8A8A8A"
              keyboardType="numeric"
              value={String(eventSettings.manualDiscountPercent)}
              onChangeText={(text) => {
                const nextRate = Number(text.replace(/[^0-9]/g, "")) || 0;
                setDraftRule({ ...draftRule, maxDiscountPercent: nextRate });
                if (nextRate <= 0) {
                  setMerchantError("Manual offer rate must be above 0%.");
                  return;
                }
                void onSaveEventIntelligence({ manualDiscountPercent: nextRate })
                  .then(() => setMerchantError(undefined))
                  .catch((caught) => {
                    setMerchantError(caught instanceof Error ? caught.message : "Could not save manual rate.");
                  });
              }}
            />
          </View>
          <View style={styles.eventRateBox}>
            <Text style={styles.caption}>Auto bounds</Text>
            <View style={styles.row}>
              <TextInput
                style={styles.inputFlex}
                placeholder="Min %"
                placeholderTextColor="#8A8A8A"
                keyboardType="numeric"
                value={String(eventSettings.minAutoDiscountPercent)}
                onChangeText={(text) => {
                  const nextRate = Number(text.replace(/[^0-9]/g, "")) || 0;
                  if (nextRate > eventSettings.maxAutoDiscountPercent) {
                    setMerchantError("Minimum auto rate cannot be above the maximum auto rate.");
                    return;
                  }
                  void onSaveEventIntelligence({ minAutoDiscountPercent: nextRate })
                    .then(() => setMerchantError(undefined))
                    .catch((caught) => {
                      setMerchantError(caught instanceof Error ? caught.message : "Could not save minimum auto rate.");
                    });
                }}
              />
              <TextInput
                style={styles.inputFlex}
                placeholder="Max %"
                placeholderTextColor="#8A8A8A"
                keyboardType="numeric"
                value={String(eventSettings.maxAutoDiscountPercent)}
                onChangeText={(text) => {
                  const nextRate = Number(text.replace(/[^0-9]/g, "")) || 0;
                  if (nextRate <= 0) {
                    setMerchantError("Maximum auto rate must be above 0%.");
                    return;
                  }
                  if (nextRate < eventSettings.minAutoDiscountPercent) {
                    setMerchantError("Maximum auto rate cannot be below the minimum auto rate.");
                    return;
                  }
                  void onSaveEventIntelligence({ maxAutoDiscountPercent: nextRate })
                    .then(() => setMerchantError(undefined))
                    .catch((caught) => {
                      setMerchantError(caught instanceof Error ? caught.message : "Could not save maximum auto rate.");
                    });
                }}
              />
            </View>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, scanBusy && styles.buttonDisabled]}
          disabled={scanBusy}
          onPress={async () => {
            setScanBusy(true);
            setEventStatus("Scanning live local events...");
            try {
              const result = await onScanEvents();
              setEventStatus(
                result.sourceUrl.startsWith("not_configured://")
                  ? "Event scan complete: city adapter config needed, so no events were invented."
                  : "Live event scan complete."
              );
            } catch (caught) {
              setEventStatus(caught instanceof Error ? caught.message : "Event scan failed.");
            } finally {
              setScanBusy(false);
            }
          }}
        >
          <Text style={styles.primaryButtonText}>{scanBusy ? "Scanning..." : "Scan local events now"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, ruleGuardrailError && styles.buttonDisabled]}
          disabled={Boolean(ruleGuardrailError)}
          onPress={async () => {
            if (ruleGuardrailError) {
              setMerchantError(ruleGuardrailError);
              return;
            }
            try {
              await onSaveEventIntelligence({ manualDiscountPercent: draftRule.maxDiscountPercent });
              await onSaveRule({ ...draftRule, maxDiscountPercent: draftRule.maxDiscountPercent });
              setMerchantError(undefined);
              setSavedMessage(`Manual offer rate set to ${draftRule.maxDiscountPercent}%.`);
            } catch (caught) {
              setMerchantError(caught instanceof Error ? caught.message : "Could not apply manual rate.");
            }
          }}
        >
          <Text style={styles.secondaryButtonText}>Apply manual rate to campaign</Text>
        </TouchableOpacity>
        {eventStatus && <Text style={styles.successText}>{eventStatus}</Text>}
        {merchantError && <Text style={styles.errorText}>{merchantError}</Text>}
        {eventScanResult && (
          <View style={styles.rulePreview}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.listTextWrap}>
                <Text style={styles.ruleLine}>Recommended rate: {eventScanResult.recommendedDiscountPercent}%</Text>
                <Text style={styles.caption}>Source: {eventScanResult.sourceUrl}</Text>
              </View>
              <Text style={styles.statusBadge}>{eventSourceStatus}</Text>
            </View>
            {!eventScanResult.events.length && (
              <Text style={styles.muted}>
                {eventSourceConfigNeeded
                  ? "No city event adapter is configured for this merchant location; Spark keeps the merchant rate instead of inventing events."
                  : "No live events were returned by the configured adapter for the next 7 days."}
              </Text>
            )}
            {eventScanResult.rationale.map((reason) => (
              <Text key={reason} style={styles.bullet}>- {reason}</Text>
            ))}
            {eventScanResult.events.slice(0, 3).map((event) => (
              <Text key={`${event.title}-${event.startsAt}`} style={styles.caption}>
                {event.title} · {new Date(event.startsAt).toLocaleDateString()} · {event.expectedDemandImpact} impact
              </Text>
            ))}
          </View>
        )}
        {eventSettings.scheduledAdjustments.length > 0 && (
          <View style={styles.rulePreview}>
            <Text style={styles.ruleLine}>Scheduled event-based rates</Text>
            {eventSettings.scheduledAdjustments.slice(0, 3).map((adjustment) => (
              <Text key={adjustment.id} style={styles.caption}>
                {adjustment.discountPercent}% · {adjustment.status} · {adjustment.eventTitle || "local event"} until {new Date(adjustment.endsAt).toLocaleDateString()}
              </Text>
            ))}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Business Campaign Builder</Text>
        <Text style={styles.caption}>Set simple guardrails. Spark handles timing, user fit, generated copy and coupon codes.</Text>
        <TextInput
          style={styles.input}
          placeholder="Eligible products, comma separated"
          placeholderTextColor="#8A8A8A"
          value={draftRule.eligibleProducts.join(", ")}
          onChangeText={(text) => setDraftRule({ ...draftRule, eligibleProducts: text.split(",").map((item) => item.trim()).filter(Boolean) })}
        />
        <Text style={styles.ruleLine}>When should Spark create offers?</Text>
        <View style={styles.businessChipRow}>
          {businessTriggerOptions.map((option) => {
            const active = draftRule.triggerConditions?.includes(option.id);

            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.ruleChip, active && styles.ruleChipActive]}
                onPress={() =>
                  setDraftRule({
                    ...draftRule,
                    triggerConditions: toggleListValue(draftRule.triggerConditions, option.id)
                  })
                }
              >
                <Text style={[styles.ruleChipText, active && styles.ruleChipTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.ruleLine}>Which user preferences should match?</Text>
        <View style={styles.businessChipRow}>
          {preferenceOptions.map((preference) => {
            const active = draftRule.audiencePreferences?.includes(preference);

            return (
              <TouchableOpacity
                key={preference}
                style={[styles.ruleChip, active && styles.ruleChipActive]}
                onPress={() =>
                  setDraftRule({
                    ...draftRule,
                    audiencePreferences: toggleListValue(draftRule.audiencePreferences, preference)
                  })
                }
              >
                <Text style={[styles.ruleChipText, active && styles.ruleChipTextActive]}>{preference}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          style={styles.input}
          placeholder="Max discount percent"
          placeholderTextColor="#8A8A8A"
          keyboardType="numeric"
          value={String(draftRule.maxDiscountPercent)}
          onChangeText={(text) => {
            const nextRate = Number(text.replace(/[^0-9]/g, "")) || 0;
            setDraftRule({ ...draftRule, maxDiscountPercent: nextRate });
            if (nextRate <= 0) {
              setMerchantError("Campaign max discount must be above 0%.");
            }
          }}
        />
        <TextInput
          style={styles.input}
          placeholder="Daily redemption cap"
          placeholderTextColor="#8A8A8A"
          keyboardType="numeric"
          value={String(draftRule.dailyRedemptionCap)}
          onChangeText={(text) => {
            const nextCap = Number(text.replace(/[^0-9]/g, "")) || 0;
            setDraftRule({ ...draftRule, dailyRedemptionCap: nextCap });
            if (nextCap <= 0) {
              setMerchantError("Daily redemption cap must be at least 1.");
            }
          }}
        />
        <TextInput
          style={styles.input}
          placeholder="Forbidden claims, comma separated"
          placeholderTextColor="#8A8A8A"
          value={draftRule.forbiddenClaims.join(", ")}
          onChangeText={(text) => setDraftRule({ ...draftRule, forbiddenClaims: text.split(",").map((item) => item.trim()).filter(Boolean) })}
        />
        <View style={styles.rulePreview}>
          <Text style={styles.ruleLine}>
            Preview: Spark can offer up to {draftRule.maxDiscountPercent}% on {draftRule.eligibleProducts[0] || "selected products"}.
          </Text>
          <Text style={styles.caption}>
            It will target {draftRule.audiencePreferences?.join(", ") || "nearby users"} when {draftRule.triggerConditions?.join(", ") || "your triggers"} match.
          </Text>
          <Text style={styles.caption}>Daily cap is {draftRule.dailyRedemptionCap} redemptions. Each accepted offer gets a short expiring coupon code.</Text>
          {ruleGuardrailError && <Text style={styles.errorText}>{ruleGuardrailError}</Text>}
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, ruleGuardrailError && styles.buttonDisabled]}
          disabled={Boolean(ruleGuardrailError)}
          onPress={async () => {
            if (ruleGuardrailError) {
              setMerchantError(ruleGuardrailError);
              return;
            }
            try {
              await onSaveRule(draftRule);
              setMerchantError(undefined);
              setSavedMessage("Merchant rule saved and campaign preview updated.");
            } catch (caught) {
              setMerchantError(caught instanceof Error ? caught.message : "Could not save merchant rule.");
            }
          }}
        >
          <Text style={styles.primaryButtonText}>Save merchant rule</Text>
        </TouchableOpacity>
        {savedMessage && <Text style={styles.successText}>{savedMessage}</Text>}
        {merchantError && <Text style={styles.errorText}>{merchantError}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Active Generated Campaign</Text>
        {activeOffer ? (
          <>
            <Text style={styles.ruleLine}>{activeOffer.title}</Text>
            <Text style={styles.ruleLine}>{activeOffer.discountPercent}% cashback on {activeOffer.product}</Text>
            <Text style={styles.ruleLine}>Coupon code: {activeOffer.couponCode}</Text>
            <Text style={styles.ruleLine}>Channel: {activeOffer.channel.replaceAll("_", " ")}</Text>
          </>
        ) : (
          <Text style={styles.muted}>Waiting for a generated offer.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Performance</Text>
        <Metric label="Impressions" value={analytics?.impressions ?? 0} />
        <Metric label="Accepts" value={analytics?.accepts ?? 0} />
        <Metric label="Declines" value={analytics?.declines ?? 0} />
        <Metric label="Redemptions" value={analytics?.redemptions ?? 0} />
        <Metric label="Accept rate" value={`${Math.round((analytics?.acceptRate ?? 0) * 100)}%`} />
        <Metric label="Checkout conversion" value={`${Math.round((analytics?.redemptionRate ?? 0) * 100)}%`} />
        <Metric
          label="Campaign capacity"
          value={typeof analytics?.currentCampaignRemainingToday === "number" && typeof analytics.currentCampaignDailyCap === "number"
            ? `${analytics.currentCampaignRemainingToday}/${analytics.currentCampaignDailyCap} claims left today`
            : "No generated campaign yet"}
        />
        <Metric label="Quiet-hour lift" value={`${analytics?.quietHourLiftPercent ?? 0}%`} />
        <Text style={styles.caption}>
          Funnel basis: impressions are generated offers, accepts are issued checkout tokens, declines are aggregate dismisses, and redemptions are validated merchant scans.
        </Text>
        <Text style={styles.caption}>
          Lift basis: {analytics?.quietHourLiftBasis?.replaceAll("_", " ") || "not measured"}. Spark will not invent post-campaign lift without a Payone baseline.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Privacy Boundary</Text>
        <Text style={styles.bullet}>- Local: {aiStackValidation.localModel.requested}</Text>
        <Text style={styles.bullet}>- Runtime: {aiStackValidation.localModel.mvpRuntime}</Text>
        <Text style={styles.bullet}>- Cloud: {aiStackValidation.cloudAgent.requested}</Text>
        <Text style={styles.bullet}>- Hermes: {aiStackValidation.cloudAgent.browserLayer}</Text>
        <Text style={styles.bullet}>- Outbound data: {aiStackValidation.cloudAgent.outboundData.join(", ")}</Text>
      </View>
    </>
  );
}

const graphWorld = { width: 1500, height: 1040 };
type GraphClusterId = "index" | "live" | "places" | "routine" | "preferences" | "offers";

const graphClusterMeta: Record<GraphClusterId, { label: string; body: string; center: { x: number; y: number } }> = {
  index: {
    label: "Index",
    body: "Entry point. Spark chooses which cluster matters now.",
    center: { x: 245, y: 180 }
  },
  live: {
    label: "Live Context",
    body: "Weather, time, map-selected area and current situation.",
    center: { x: 760, y: 165 }
  },
  places: {
    label: "Places",
    body: "Nearby real merchants, home and known locations.",
    center: { x: 1220, y: 300 }
  },
  routine: {
    label: "Routine",
    body: "Calendar and repeat movement signals.",
    center: { x: 350, y: 760 }
  },
  preferences: {
    label: "Preferences",
    body: "Local-only habits and preference clues.",
    center: { x: 805, y: 715 }
  },
  offers: {
    label: "Offers",
    body: "Accepted, ignored and generated wallet moments.",
    center: { x: 1220, y: 805 }
  }
};

const graphClusterForNode = (node: LocalKnowledgeGraph["nodes"][number]): GraphClusterId => {
  if (node.id === "current-user") {
    return "index";
  }
  if (node.id.startsWith("live:") || node.type === "context") {
    return "live";
  }
  if (node.type === "place") {
    return "places";
  }
  if (node.type === "schedule" || node.type === "habit") {
    return "routine";
  }
  if (node.type === "preference") {
    return "preferences";
  }
  if (node.type === "offer") {
    return "offers";
  }
  return "index";
};

const graphClusterOrder: GraphClusterId[] = ["index", "live", "places", "routine", "preferences", "offers"];

const graphNodeColor = (type: LocalKnowledgeGraph["nodes"][number]["type"], theme: AppTheme) => {
  const palette: Record<LocalKnowledgeGraph["nodes"][number]["type"], string> = {
    user: theme.primary,
    preference: "#8B5CF6",
    place: "#14B8A6",
    offer: "#F97316",
    habit: "#3B82F6",
    context: "#EC4899",
    schedule: "#A855F7"
  };

  return palette[type] || theme.primary;
};

const graphNodeSymbol = (type: LocalKnowledgeGraph["nodes"][number]["type"]) => {
  const symbols: Record<LocalKnowledgeGraph["nodes"][number]["type"], string> = {
    user: "YOU",
    preference: "PREF",
    place: "PLACE",
    offer: "OFFER",
    habit: "HABIT",
    context: "CTX",
    schedule: "TIME"
  };

  return symbols[type];
};

function KnowledgeGraphScreen({
  graph,
  activeEdgeIndex,
  intent,
  graphPaused,
  onPauseGraph,
  onExportGraph,
  onDeleteGraph
}: {
  graph: LocalKnowledgeGraph;
  activeEdgeIndex: number;
  intent?: LocalIntent;
  graphPaused: boolean;
  onPauseGraph: (paused: boolean) => void | Promise<void>;
  onExportGraph: () => void | Promise<void>;
  onDeleteGraph: () => void | Promise<void>;
}) {
  const { styles, theme } = useThemeKit();
  const activeEdge = graph.edges[activeEdgeIndex % Math.max(graph.edges.length, 1)];
  const [selectedNodeId, setSelectedNodeId] = useState(activeEdge?.to || graph.nodes[0]?.id);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const activeTargetNode = graph.nodes.find((node) => node.id === activeEdge?.to) || graph.nodes.find((node) => node.id === activeEdge?.from);
  const agentCluster = activeTargetNode ? graphClusterForNode(activeTargetNode) : "index";
  const [selectedCluster, setSelectedCluster] = useState<GraphClusterId>(agentCluster);
  const [scale, setScale] = useState(0.58);
  const [translate, setTranslate] = useState({ x: -90, y: -35 });
  const [privacyStatus, setPrivacyStatus] = useState("Local graph controls are ready.");
  const panStart = useRef(translate);
  const selectedEdges = selectedNode
    ? graph.edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
    : [];
  const clusterCounts = useMemo(() => {
    const counts: Record<GraphClusterId, number> = {
      index: 0,
      live: 0,
      places: 0,
      routine: 0,
      preferences: 0,
      offers: 0
    };
    graph.nodes.forEach((node) => {
      counts[graphClusterForNode(node)] += 1;
    });
    return counts;
  }, [graph.nodes]);
  const clusterRouteSummary = useMemo(() => {
    const nodeCluster = new Map(graph.nodes.map((node) => [node.id, graphClusterForNode(node)]));
    const routeCounts = new Map<string, { from: GraphClusterId; to: GraphClusterId; count: number }>();

    graph.edges.forEach((edge) => {
      const from = nodeCluster.get(edge.from);
      const to = nodeCluster.get(edge.to);

      if (!from || !to) {
        return;
      }

      const key = `${from}:${to}`;
      const current = routeCounts.get(key);
      routeCounts.set(key, { from, to, count: (current?.count || 0) + 1 });
    });

    return [...routeCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }, [graph.edges, graph.nodes]);
  const offerOutcomeSummary = useMemo(() => {
    const summary = { accepted: 0, dismissed: 0, redeemed: 0 };
    graph.nodes.forEach((node) => {
      if (node.type !== "offer") {
        return;
      }
      if (node.id.startsWith("offer:accepted:")) {
        summary.accepted += 1;
      } else if (node.id.startsWith("offer:dismissed:")) {
        summary.dismissed += 1;
      } else if (node.id.startsWith("offer:redeemed:")) {
        summary.redeemed += 1;
      }
    });
    return summary;
  }, [graph.nodes]);
  const connectedNodeIds = useMemo(
    () => new Set(selectedEdges.flatMap((edge) => [edge.from, edge.to])),
    [selectedEdges]
  );
  const backdropDots = useMemo(
    () =>
      Array.from({ length: 38 }, (_, index) => ({
        key: `dot-${index}`,
        left: ((index * 23) % 100) * 3.8,
        top: ((index * 37) % 100) * 5.4,
        opacity: 0.12 + ((index % 5) * 0.035)
      })),
    []
  );
  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const grouped = new Map<GraphClusterId, LocalKnowledgeGraph["nodes"]>();
    graph.nodes.forEach((node) => {
      const clusterId = graphClusterForNode(node);
      grouped.set(clusterId, [...(grouped.get(clusterId) || []), node]);
    });

    graphClusterOrder.forEach((clusterId) => {
      const nodes = grouped.get(clusterId) || [];
      const center = graphClusterMeta[clusterId].center;
      nodes.forEach((node, index) => {
        if (node.id === "current-user") {
          map.set(node.id, center);
          return;
        }

        const ring = clusterId === "index" ? 82 : 105 + (index % 2) * 46;
        const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
        map.set(node.id, {
          x: center.x + Math.cos(angle) * ring,
          y: center.y + Math.sin(angle) * ring
        });
      });
    });

    return map;
  }, [graph.nodes]);
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        panStart.current = translate;
      },
      onPanResponderMove: (_, gesture) => {
        setTranslate({
          x: panStart.current.x + gesture.dx,
          y: panStart.current.y + gesture.dy
        });
      }
    }),
    [translate]
  );
  const zoom = (delta: number) => setScale((current) => Math.max(0.42, Math.min(1.45, current + delta)));
  const focusCluster = (clusterId: GraphClusterId) => {
    const center = graphClusterMeta[clusterId].center;
    setSelectedCluster(clusterId);
    setTranslate({
      x: 180 - center.x * scale,
      y: 230 - center.y * scale
    });
  };
  const resetView = () => {
    setScale(0.58);
    setTranslate({ x: -90, y: -35 });
    setSelectedCluster(agentCluster);
  };
  const agentClusterMeta = graphClusterMeta[agentCluster];
  const activeFromNode = graph.nodes.find((node) => node.id === activeEdge?.from);
  const activeToNode = graph.nodes.find((node) => node.id === activeEdge?.to);
  const routeEvidence = [
    graphPaused ? "Graph pause is active: stored nodes are visible for inspection, but Spark will not reuse them for deal discovery." : undefined,
    intent ? `Abstract intent: ${intent.abstractSignal}` : undefined,
    activeEdge ? `Active relation: ${activeEdge.relation.replaceAll("_", " ")}` : undefined,
    `Focused cluster: ${agentClusterMeta.label}`,
    `${clusterCounts[agentCluster]} nodes available in this cluster`
  ].filter(Boolean);

  return (
    <>
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <View>
            <Text style={styles.sectionTitle}>Spark is traversing your graph</Text>
            <Text style={styles.caption}>
              {graphPaused
                ? "Graph use is paused."
                : `Spark is routing through ${agentClusterMeta.label}: ${agentClusterMeta.body}`}
            </Text>
          </View>
          <View style={[styles.sparkFace, graphPaused && styles.buttonDisabled]}>
            <Text style={styles.sparkFaceText}>AI</Text>
          </View>
        </View>
        <Text style={styles.statusBadge}>{graphPaused ? "paused" : "local traversal"}</Text>
        {intent && <Text style={styles.signalPill}>Intent: {intent.abstractSignal}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Local Offer Learning</Text>
        <Text style={styles.caption}>
          These outcome clusters are stored only in the private graph and help Gemma avoid repeating irrelevant offers.
        </Text>
        <View style={styles.metricGrid}>
          <Metric label="Accepted" value={offerOutcomeSummary.accepted} />
          <Metric label="Redeemed" value={offerOutcomeSummary.redeemed} />
          <Metric label="Dismissed" value={offerOutcomeSummary.dismissed} />
        </View>
        <Text style={styles.muted}>
          Merchant analytics stay aggregate; individual outcome nodes remain on this device unless the user exports locally.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Cluster Route Summary</Text>
        <Text style={styles.caption}>
          Spark traverses local graph clusters first, then sends only the abstract intent to cloud deal discovery when allowed.
        </Text>
        {clusterRouteSummary.length ? (
          clusterRouteSummary.map((route) => (
            <Text key={`${route.from}-${route.to}`} style={styles.bullet}>
              - {graphClusterMeta[route.from].label} to {graphClusterMeta[route.to].label}: {route.count} local edge{route.count === 1 ? "" : "s"}
            </Text>
          ))
        ) : (
          <Text style={styles.muted}>No local routes yet. Live context, calendar sync, prompts and offer outcomes will build them on this device.</Text>
        )}
      </View>

      <View style={styles.graphCanvas}>
        {backdropDots.map((dot) => (
          <View
            key={dot.key}
            pointerEvents="none"
            style={[styles.graphBackdropDot, { left: dot.left, top: dot.top, opacity: dot.opacity }]}
          />
        ))}
        <View style={styles.graphToolbar}>
          <Text style={styles.graphHint}>Clustered infinite canvas. Drag to explore, tap clusters or nodes, or follow Spark.</Text>
          <View style={styles.graphControlRow}>
            <TouchableOpacity style={styles.graphZoomButton} onPress={() => zoom(-0.12)}>
              <Text style={styles.graphZoomText}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.graphZoomButton} onPress={resetView}>
              <Text style={styles.graphZoomText}>{Math.round(scale * 100)}%</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.graphZoomButton} onPress={() => focusCluster(agentCluster)}>
              <Text style={styles.graphZoomText}>Spark</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.graphZoomButton} onPress={() => zoom(0.12)}>
              <Text style={styles.graphZoomText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View pointerEvents="none" style={styles.graphLegend}>
          {(["user", "preference", "place", "offer", "habit", "context", "schedule"] as LocalKnowledgeGraph["nodes"][number]["type"][]).map((type) => (
            <View key={type} style={styles.graphLegendItem}>
              <View style={[styles.graphLegendDot, { backgroundColor: graphNodeColor(type, theme) }]} />
              <Text style={styles.graphLegendText}>{type}</Text>
            </View>
          ))}
        </View>
        <View style={styles.graphViewport} {...panResponder.panHandlers}>
          <View
            style={[
              styles.graphWorld,
              {
                width: graphWorld.width,
                height: graphWorld.height,
                transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }]
              }
            ]}
          >
            {graphClusterOrder.map((clusterId) => {
              const meta = graphClusterMeta[clusterId];
              const isAgentCluster = agentCluster === clusterId;
              const isSelectedCluster = selectedCluster === clusterId;

              return (
                <TouchableOpacity
                  key={clusterId}
                  activeOpacity={0.85}
                  style={[
                    styles.graphClusterBubble,
                    {
                      left: meta.center.x - 145,
                      top: meta.center.y - 98,
                      borderColor: isAgentCluster ? theme.primary : isSelectedCluster ? "#8B5CF6" : theme.border
                    },
                    isAgentCluster && styles.graphClusterBubbleActive
                  ]}
                  onPress={() => focusCluster(clusterId)}
                >
                  <Text style={styles.graphClusterTitle}>{meta.label}</Text>
                  <Text style={styles.graphClusterBody}>{meta.body}</Text>
                  <Text style={styles.graphClusterCount}>
                    {clusterCounts[clusterId]} nodes {isAgentCluster ? "· Spark here" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <Svg width={graphWorld.width} height={graphWorld.height} style={styles.graphSvg}>
              {graphClusterOrder
                .filter((clusterId) => clusterId !== "index")
                .map((clusterId) => {
                  const from = graphClusterMeta.index.center;
                  const to = graphClusterMeta[clusterId].center;
                  const isAgentRoute = agentCluster === clusterId;
                  return (
                    <Line
                      key={`index-route-${clusterId}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={isAgentRoute ? theme.primary : theme.graphLine}
                      strokeOpacity={isAgentRoute ? 0.72 : 0.18}
                      strokeWidth={isAgentRoute ? 3.8 : 1.4}
                      strokeLinecap="round"
                    />
                  );
                })}
              {graph.edges.map((edge, index) => {
                const from = nodePositions.get(edge.from);
                const to = nodePositions.get(edge.to);

                if (!from || !to) {
                  return null;
                }

                const isActive = index === activeEdgeIndex % graph.edges.length;
                const isSelected = selectedNodeId === edge.from || selectedNodeId === edge.to;
                return (
                  <Line
                    key={`${edge.from}-${edge.to}-${index}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={isActive ? theme.primary : isSelected ? "#8B5CF6" : theme.graphLine}
                    strokeOpacity={isActive || isSelected ? 0.92 : 0.36}
                    strokeWidth={isActive ? 4 : isSelected ? 2.8 : 1.6}
                    strokeLinecap="round"
                  />
                );
              })}
            </Svg>

            {graph.nodes.map((node) => {
              const position = nodePositions.get(node.id);
              if (!position) {
                return null;
              }
              const color = graphNodeColor(node.type, theme);
              const nodeCluster = graphClusterForNode(node);
              const isActive = activeEdge?.from === node.id || activeEdge?.to === node.id;
              const isSelected = selectedNodeId === node.id;
              const isConnectedToSelection = connectedNodeIds.has(node.id);
              const isInSelectedCluster = selectedCluster === "index" || nodeCluster === selectedCluster;
              const size = Math.max(58, Math.min(96, 54 + node.weight * 34));

              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  key={node.id}
                  style={[
                    styles.graphNode,
                    {
                      left: position.x - size / 2,
                      top: position.y - size / 2,
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      backgroundColor: color,
                      opacity: !isInSelectedCluster
                        ? 0.28
                        : selectedNodeId && !isSelected && !isConnectedToSelection
                          ? 0.52
                          : 1
                    },
                    (isActive || isSelected) && styles.graphNodeActive
                  ]}
                  onPress={() => {
                    setSelectedNodeId(node.id);
                    setSelectedCluster(nodeCluster);
                  }}
                >
                  <Text style={styles.graphNodeType}>{graphNodeSymbol(node.type)}</Text>
                  <Text style={styles.graphNodeText} numberOfLines={2}>{node.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {selectedNode && (
        <View style={styles.graphDetailCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.listTextWrap}>
              <Text style={styles.sectionTitle}>{selectedNode.label}</Text>
              <Text style={styles.caption}>{selectedNode.id}</Text>
            </View>
            <Text style={styles.statusBadge}>{selectedNode.type}</Text>
          </View>
          <Metric label="Weight" value={selectedNode.weight.toFixed(2)} />
          <Metric label="Cluster" value={graphClusterMeta[graphClusterForNode(selectedNode)].label} />
          <Metric label="Connections" value={selectedEdges.length} />
          <Text style={styles.muted}>
            Spark uses this cluster index to choose the next focused search area in real time, while raw graph data stays local.
          </Text>
          {selectedEdges.slice(0, 4).map((edge) => {
            const otherId = edge.from === selectedNode.id ? edge.to : edge.from;
            const other = graph.nodes.find((node) => node.id === otherId);

            return (
              <Text key={`${edge.from}-${edge.to}-${edge.relation}`} style={styles.bullet}>
                - {edge.relation.replaceAll("_", " ")} {other?.label || otherId}
              </Text>
            );
          })}
        </View>
      )}

      {activeEdge && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Live Agent Route</Text>
          <Text style={styles.ruleLine}>
            Spark is travelling through {agentClusterMeta.label} from {activeFromNode?.label || activeEdge.from} to {activeToNode?.label || activeEdge.to}.
          </Text>
          {routeEvidence.map((item) => (
            <Text key={item} style={styles.bullet}>- {item}</Text>
          ))}
          <Text style={styles.caption}>
            This route is selected from local-only graph edges; cloud deal discovery receives only the abstract intent, not raw graph nodes.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Privacy Controls</Text>
        <Text style={styles.muted}>Inspect, pause, export, or delete the local graph that Gemma uses. Export stays on this device and is never posted to the City Wallet API.</Text>
        <Text style={styles.caption}>{privacyStatus}</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.primaryButtonFlex}
            onPress={async () => {
              const nextPaused = !graphPaused;
              await onPauseGraph(nextPaused);
              setPrivacyStatus(nextPaused ? "Private graph use is paused; Spark will not read or write local memory." : "Private graph use is active again.");
            }}
          >
            <Text style={styles.primaryButtonText}>{graphPaused ? "Resume graph" : "Pause graph"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={async () => {
              await onExportGraph();
              setPrivacyStatus("Graph export stayed on this device; no API upload was made.");
            }}
          >
            <Text style={styles.secondaryButtonText}>Export</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={async () => {
            await onDeleteGraph();
            setPrivacyStatus("Local graph deleted from this device.");
          }}
        >
          <Text style={styles.secondaryButtonText}>Delete local graph</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  const { styles } = useThemeKit();

  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  const { styles } = useThemeKit();

  return (
    <View style={styles.cardCentered}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background
  },
  splashScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
    padding: 28
  },
  splashLogo: {
    width: 286,
    height: 286,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent"
  },
  appHeader: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "72%",
    flexShrink: 1
  },
  kicker: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  heroKicker: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    opacity: 0.88,
    textTransform: "uppercase"
  },
  appTitle: {
    color: theme.text,
    fontSize: 21,
    fontWeight: "900"
  },
  balance: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    fontWeight: "800"
  },
  headerActions: {
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0
  },
  profileButton: {
    borderRadius: 999,
    padding: 3,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#FFFFFF",
    borderWidth: 2
  },
  headerAvatarText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900"
  },
  profileMenu: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 22,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    gap: 12
  },
  profileMenuHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  menuGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  menuButton: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  menuButtonText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "900"
  },
  menuModeCard: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 8
  },
  menuModeButton: {
    flex: 1,
    alignItems: "center",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  menuModeButtonActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary
  },
  menuModeButtonTextActive: {
    color: "#FFFFFF"
  },
  themeToggle: {
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  themeToggleText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "900"
  },
  navScroller: {
    flexGrow: 0,
    minHeight: 62,
    maxHeight: 66,
    zIndex: 10,
    elevation: 10,
    backgroundColor: theme.background
  },
  nav: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 7,
    marginHorizontal: 18,
    marginBottom: 8,
    alignItems: "center",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 48
  },
  navButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    minHeight: 36,
    minWidth: 82
  },
  navButtonActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary
  },
  navText: {
    fontSize: 13,
    color: theme.muted,
    fontWeight: "900",
    lineHeight: 16
  },
  navTextActive: {
    color: "#FFFFFF"
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 48,
    gap: 12
  },
  signInBrand: {
    alignItems: "center",
    gap: 6,
    paddingTop: 26,
    paddingBottom: 8
  },
  onboardingLogo: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4
  },
  onboardingContent: {
    padding: 24,
    paddingBottom: 48,
    gap: 14,
    alignItems: "stretch"
  },
  hero: {
    backgroundColor: theme.primary,
    borderRadius: 28,
    padding: 24
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 8
  },
  heroBody: {
    color: "#FFE8EA",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 26,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 10,
    shadowColor: theme.primary,
    shadowOpacity: theme.mode === "dark" ? 0.18 : 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2
  },
  cardCentered: {
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    gap: 12
  },
  profileHeader: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  profileAvatarText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900"
  },
  profileHeaderText: {
    flex: 1
  },
  authToggleRow: {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: 4
  },
  authToggle: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center"
  },
  authToggleActive: {
    backgroundColor: theme.primary
  },
  authToggleText: {
    color: theme.muted,
    fontWeight: "900"
  },
  authToggleTextActive: {
    color: "#FFFFFF"
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.7)",
    borderColor: theme.border,
    borderRadius: 18,
    borderWidth: 1,
    color: theme.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  inputFlex: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderColor: theme.border,
    borderRadius: 18,
    borderWidth: 1,
    color: theme.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  promptInput: {
    backgroundColor: "rgba(255,255,255,0.74)",
    borderColor: theme.primarySoft,
    borderRadius: 22,
    borderWidth: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  buttonDisabled: {
    opacity: 0.45
  },
  googleButton: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center"
  },
  googleButtonText: {
    color: theme.text,
    fontWeight: "900"
  },
  mapShell: {
    borderRadius: 30,
    minHeight: 430,
    overflow: "hidden",
    position: "relative",
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    shadowColor: theme.primary,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 3
  },
  mapFrame: {
    height: 430,
    width: "100%",
    overflow: "hidden",
    backgroundColor: theme.surface,
    position: "relative"
  },
  mapSetupCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: theme.surfaceAlt
  },
  mapSetupTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center"
  },
  mapSetupText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 8,
    textAlign: "center"
  },
  mapSetupButton: {
    backgroundColor: theme.primary,
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  mapSetupButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900"
  },
  mapNative: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.surface
  },
  mapLightningHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4
  },
  currentLocationMarker: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  currentLocationMarkerWeb: {
    position: "absolute",
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    alignItems: "center",
    justifyContent: "center"
  },
  currentLocationMarkerCenter: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6
  },
  mapDragCapture: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5
  },
  currentLocationHalo: {
    position: "absolute",
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,122,255,0.24)",
    borderColor: "rgba(0,122,255,0.34)",
    borderWidth: 1
  },
  currentLocationDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: "#007AFF",
    borderColor: "#FFFFFF",
    borderWidth: 2,
    shadowColor: "#007AFF",
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8
  },
  locationReadout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8
  },
  locationReadoutDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#007AFF",
    shadowColor: "#007AFF",
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5
  },
  locationReadoutText: {
    color: theme.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "800"
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject
  },
  mapOverlayMarker: {
    position: "absolute",
    marginLeft: -24,
    marginTop: -16,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3
  },
  mapOverlayMarkerHome: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderColor: theme.primary
  },
  mapOverlayMarkerUser: {
    backgroundColor: theme.inverse,
    borderColor: "rgba(255,255,255,0.76)"
  },
  mapOverlayMarkerSpark: {
    backgroundColor: theme.primary,
    borderColor: "rgba(255,255,255,0.84)"
  },
  mapOverlayText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900"
  },
  mapOverlayTextHome: {
    color: theme.primary
  },
  mapSimHint: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 7,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: theme.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  mapSimHintText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "800"
  },
  mapQuickTravelRow: {
    flexDirection: "row",
    gap: 8
  },
  mapQuickTravelButton: {
    backgroundColor: theme.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  mapQuickTravelText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900"
  },
  mapStatusPill: {
    position: "absolute",
    left: 14,
    top: 14,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  mapStatusText: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  userMarker: {
    backgroundColor: theme.inverse,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  userMarkerText: {
    color: theme.inverseText,
    fontSize: 11,
    fontWeight: "900"
  },
  homeMarker: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: theme.primary,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  homeMarkerText: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "900"
  },
  sparkMapMarker: {
    alignItems: "center"
  },
  sparkMapMarkerText: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "900"
  },
  sparkMapMarkerFace: {
    backgroundColor: theme.primary,
    borderRadius: 18,
    color: "#FFFFFF",
    fontWeight: "900",
    height: 36,
    overflow: "hidden",
    paddingTop: Platform.OS === "web" ? 10 : 7,
    textAlign: "center",
    width: 36
  },
  dealPreviewCard: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  mapGraphPanel: {
    backgroundColor: theme.mode === "dark" ? "rgba(25,2,6,0.88)" : "rgba(255,255,255,0.9)",
    borderColor: theme.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  },
  mapGraphTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "900"
  },
  mapGraphCount: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "900"
  },
  mapGraphVisual: {
    height: 280,
    overflow: "hidden",
    position: "relative",
    borderRadius: 18,
    backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(255,244,245,0.56)"
  },
  mapGraphSvg: {
    ...StyleSheet.absoluteFillObject
  },
  mapGraphNodeBubble: {
    position: "absolute",
    width: 72,
    minHeight: 34,
    marginLeft: -36,
    marginTop: -17,
    backgroundColor: theme.primarySoft,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  mapGraphNodeText: {
    color: theme.text,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center"
  },
  mapGraphEdgeText: {
    color: theme.caption,
    fontSize: 11,
    fontWeight: "700"
  },
  sparkMapAgent: {
    position: "absolute",
    top: 14,
    right: 12,
    left: 124,
    alignItems: "flex-end",
    zIndex: 20
  },
  sparkBubbleColumn: {
    alignItems: "center",
    marginBottom: 2,
    maxWidth: "100%"
  },
  sparkSpeechBubble: {
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 270,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 10
  },
  sparkBubbleTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent"
  },
  sparkAgentImage: {
    width: 82,
    height: 82
  },
  sparkSpeechText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16
  },
  sparkAgentBody: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderRadius: 40,
    width: 82,
    height: 82,
    padding: 4,
    shadowColor: theme.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6
  },
  popupTextWrap: {
    flex: 1
  },
  popupKicker: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  popupTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "900"
  },
  popupBody: {
    color: theme.muted,
    fontSize: 12,
    marginTop: 2
  },
  popupButton: {
    backgroundColor: theme.primary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  popupButtonText: {
    color: "#FFFFFF",
    fontWeight: "900"
  },
  sparkMiniFace: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  sparkMiniFaceText: {
    color: "#FFFFFF",
    fontWeight: "900"
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "900"
  },
  signalPill: {
    backgroundColor: theme.surfaceAlt,
    color: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
    fontWeight: "800"
  },
  statusBadge: {
    backgroundColor: theme.primarySoft,
    color: theme.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden"
  },
  statusBadgeButton: {
    backgroundColor: theme.primarySoft,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  statusBadgeText: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  inlineControls: {
    gap: 10,
    paddingTop: 4
  },
  muted: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20
  },
  caption: {
    color: theme.caption,
    fontSize: 12,
    lineHeight: 18
  },
  bullet: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20
  },
  primaryButton: {
    backgroundColor: theme.primary,
    borderRadius: 14,
    padding: 15,
    alignItems: "center"
  },
  primaryButtonFlex: {
    flex: 1,
    backgroundColor: theme.primary,
    borderRadius: 14,
    padding: 15,
    alignItems: "center"
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900"
  },
  secondaryButton: {
    borderRadius: 14,
    padding: 15,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface
  },
  secondaryButtonFlex: {
    flex: 1,
    borderRadius: 14,
    padding: 15,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface
  },
  secondaryButtonText: {
    color: theme.text,
    fontWeight: "900"
  },
  savingsHero: {
    backgroundColor: theme.primary,
    borderRadius: 28,
    padding: 20,
    gap: 10
  },
  savingsKicker: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    opacity: 0.86,
    textTransform: "uppercase"
  },
  savingsTotal: {
    color: "#FFFFFF",
    fontSize: 38,
    fontWeight: "900"
  },
  savingsBody: {
    color: "#FFE8EA",
    fontSize: 15,
    lineHeight: 22
  },
  savingsBreakdown: {
    backgroundColor: "rgba(255,255,255,0.13)",
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    padding: 12
  },
  savingsMiniText: {
    color: theme.mode === "dark" ? "#F8FAFC" : theme.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  savingsHeroMiniText: {
    color: "#FFE8EA",
    fontSize: 12,
    fontWeight: "800"
  },
  savingsValue: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 3
  },
  offerCard: {
    backgroundColor: theme.inverse,
    borderRadius: 30,
    padding: 24,
    gap: 14
  },
  channel: {
    alignSelf: "flex-start",
    backgroundColor: theme.primary,
    color: "#FFFFFF",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: "900"
  },
  offerTitle: {
    color: "#FFFFFF",
    fontSize: 31,
    fontWeight: "900"
  },
  merchantName: {
    color: theme.inverseText,
    fontSize: 16,
    fontWeight: "800",
    opacity: 0.86
  },
  offerBody: {
    color: "#EEEEEE",
    fontSize: 16,
    lineHeight: 24
  },
  couponCode: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  factGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  fact: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  factText: {
    color: "#FFFFFF",
    fontWeight: "800"
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  qrWrap: {
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border
  },
  successCard: {
    backgroundColor: theme.successBg,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.successText
  },
  successText: {
    color: theme.successText,
    lineHeight: 20
  },
  errorText: {
    color: theme.primary,
    fontWeight: "800",
    lineHeight: 20
  },
  ruleLine: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 22
  },
  settingRow: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10
  },
  settingBlock: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    gap: 10,
    paddingVertical: 12
  },
  settingValue: {
    color: theme.primary,
    fontWeight: "900"
  },
  ledgerRow: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12
  },
  listTextWrap: {
    flex: 1
  },
  rulePreview: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 16,
    padding: 12,
    gap: 4
  },
  businessChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  eventRateGrid: {
    gap: 10
  },
  eventRateBox: {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  ruleChip: {
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.surface
  },
  ruleChipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary
  },
  ruleChipText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "900"
  },
  ruleChipTextActive: {
    color: "#FFFFFF"
  },
  graphCanvas: {
    height: 560,
    borderRadius: 28,
    backgroundColor: theme.mode === "dark" ? "#070A13" : "#EEF6FF",
    borderColor: theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
    borderWidth: 1,
    overflow: "hidden",
    position: "relative"
  },
  graphBackdropDot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.mode === "dark" ? "#E0E7FF" : "#2563EB"
  },
  graphToolbar: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    zIndex: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  graphHint: {
    color: theme.mode === "dark" ? "#CBD5E1" : "#475569",
    flex: 1,
    fontSize: 11,
    fontWeight: "800"
  },
  graphControlRow: {
    flexDirection: "row",
    gap: 6
  },
  graphLegend: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    zIndex: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  graphLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.mode === "dark" ? "rgba(15,23,42,0.78)" : "rgba(255,255,255,0.82)",
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  graphLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  graphLegendText: {
    color: theme.text,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "capitalize"
  },
  graphZoomButton: {
    minWidth: 38,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.86)",
    borderColor: theme.border,
    borderWidth: 1
  },
  graphZoomText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "900"
  },
  graphViewport: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden"
  },
  graphWorld: {
    position: "absolute",
    left: 0,
    top: 0
  },
  graphClusterBubble: {
    position: "absolute",
    zIndex: 2,
    width: 290,
    minHeight: 152,
    borderRadius: 30,
    borderWidth: 1.5,
    backgroundColor: theme.mode === "dark" ? "rgba(15,23,42,0.78)" : "rgba(255,255,255,0.82)",
    padding: 16,
    gap: 6,
    shadowColor: "#000000",
    shadowOpacity: theme.mode === "dark" ? 0.34 : 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3
  },
  graphClusterBubbleActive: {
    backgroundColor: theme.mode === "dark" ? "rgba(34,20,45,0.9)" : "rgba(255,240,242,0.92)",
    shadowColor: theme.primary,
    shadowOpacity: 0.28,
    elevation: 6
  },
  graphClusterTitle: {
    color: theme.text,
    fontSize: 19,
    fontWeight: "900"
  },
  graphClusterBody: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  graphClusterCount: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2
  },
  graphSvg: {
    position: "absolute",
    zIndex: 1,
    left: 0,
    top: 0
  },
  graphNode: {
    position: "absolute",
    zIndex: 3,
    borderColor: "rgba(255,255,255,0.82)",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    padding: 7,
    shadowColor: "#000000",
    shadowOpacity: theme.mode === "dark" ? 0.42 : 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5
  },
  graphNodeActive: {
    borderColor: "#FFFFFF",
    shadowColor: theme.primary,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8
  },
  graphNodeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center"
  },
  graphNodeType: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginBottom: 2
  },
  graphNodeTextActive: {
    color: "#FFFFFF"
  },
  graphDetailCard: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },
  sparkFace: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  sparkFaceText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900"
  },
  sparkTraveler: {
    position: "absolute",
    alignItems: "center"
  },
  sparkTravelerText: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: "900"
  },
  sparkTravelerFace: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.primary,
    color: "#FFFFFF",
    textAlign: "center",
    textAlignVertical: "center",
    fontWeight: "900",
    overflow: "hidden",
    paddingTop: Platform.OS === "web" ? 12 : 0
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border
  },
  metricGrid: {
    marginTop: 8
  },
  metricLabel: {
    color: theme.muted
  },
  metricValue: {
    color: theme.text,
    fontWeight: "900"
  },
  loading: {
    color: theme.muted,
    textAlign: "center",
    padding: 20
  }
  });
}
