import AsyncStorage from "@react-native-async-storage/async-storage";
import { getRuntimeConfig } from "../config/runtimeConfig";
import { CalendarEvent, ContextState, GeoPoint, LocalIntent, LocalKnowledgeGraph, Merchant, RoutineTrigger } from "../types";

export const graphStorageKeyForOwner = (ownerId = "guest") =>
  `city-wallet.local-knowledge-graph.${ownerId.replace(/[^a-z0-9_-]/gi, "_")}`;

const starterGraph: LocalKnowledgeGraph = {
  nodes: [
    { id: "current-user", type: "user", label: "You", weight: 1 }
  ],
  edges: []
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

const parseModelJson = <T>(content: string): T => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }

    throw new Error("Local Gemma runtime returned text that was not valid JSON.");
  }
};

const removeLegacySeededGraphData = (graph: LocalKnowledgeGraph): LocalKnowledgeGraph => {
  const legacyIds = new Set(["warm-drinks", "short-breaks", "city-center", "accepted-local"]);
  const withoutLegacy = {
    nodes: graph.nodes.filter((node) => !legacyIds.has(node.id)),
    edges: graph.edges.filter((edge) => !legacyIds.has(edge.from) && !legacyIds.has(edge.to))
  };
  // Old live pipeline created a new `context-context-*` node every tick — drop those fakes
  const snapshotNoise = new Set(
    withoutLegacy.nodes
      .filter((node) => /^context-context-\d+$/.test(node.id))
      .map((node) => node.id)
  );
  return {
    nodes: withoutLegacy.nodes.filter((node) => !snapshotNoise.has(node.id)),
    edges: withoutLegacy.edges.filter((edge) => !snapshotNoise.has(edge.from) && !snapshotNoise.has(edge.to))
  };
};

export const loadLocalKnowledgeGraph = async (ownerId = "guest"): Promise<LocalKnowledgeGraph> => {
  const graphStorageKey = graphStorageKeyForOwner(ownerId);
  const serializedGraph = await AsyncStorage.getItem(graphStorageKey);

  if (!serializedGraph) {
    await saveLocalKnowledgeGraph(starterGraph, ownerId);
    return starterGraph;
  }

  const graph = removeLegacySeededGraphData(JSON.parse(serializedGraph) as LocalKnowledgeGraph);
  await saveLocalKnowledgeGraph(graph, ownerId);
  return graph;
};

export const saveLocalKnowledgeGraph = (graph: LocalKnowledgeGraph, ownerId = "guest") =>
  AsyncStorage.setItem(graphStorageKeyForOwner(ownerId), JSON.stringify(graph));

export const addHomeLocationToGraph = (graph: LocalKnowledgeGraph, home: GeoPoint): LocalKnowledgeGraph => {
  const homeNode = {
    id: "home-location",
    type: "place" as const,
    label: `Home (${home.latitude.toFixed(4)}, ${home.longitude.toFixed(4)})`,
    weight: 1
  };
  const existingHome = graph.nodes.some((node) => node.id === homeNode.id);
  const existingHomeEdge = graph.edges.some((edge) => edge.from === "current-user" && edge.to === homeNode.id && edge.relation === "visited");

  return {
    nodes: existingHome
      ? graph.nodes.map((node) => (node.id === homeNode.id ? homeNode : node))
      : [...graph.nodes, homeNode],
    edges: existingHomeEdge
      ? graph.edges
      : [...graph.edges, { from: "current-user", to: homeNode.id, relation: "visited", weight: 1 }]
  };
};

export const recordManualPromptInGraph = (graph: LocalKnowledgeGraph, prompt: string): LocalKnowledgeGraph => {
  const normalizedPrompt = prompt.trim();
  const promptId = `prompt-${Date.now()}`;

  return {
    nodes: [
      ...graph.nodes,
      {
        id: promptId,
        type: "context",
        label: normalizedPrompt.length > 48 ? `${normalizedPrompt.slice(0, 45)}...` : normalizedPrompt,
        weight: 0.72
      }
    ],
    edges: [...graph.edges, { from: "current-user", to: promptId, relation: "during", weight: 0.72 }]
  };
};

const LIVE_BUNDLE = "live:observed-signals" as const;

export const recordLiveContextInGraph = (
  graph: LocalKnowledgeGraph,
  context: ContextState,
  merchants: Merchant[]
): LocalKnowledgeGraph => {
  const upsert = (list: LocalKnowledgeGraph["nodes"], node: LocalKnowledgeGraph["nodes"][number]) => {
    const i = list.findIndex((n) => n.id === node.id);
    if (i >= 0) {
      const next = list.slice();
      next[i] = node;
      return next;
    }
    return [...list, node];
  };
  let nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const edgeKeys = new Set(edges.map((edge) => `${edge.from}:${edge.to}:${edge.relation}`));
  const addEdge = (edge: LocalKnowledgeGraph["edges"][number]) => {
    const key = `${edge.from}:${edge.to}:${edge.relation}`;
    if (!edgeKeys.has(key)) {
      edges.push(edge);
      edgeKeys.add(key);
    }
  };
  const locationSignal = context.signals.find((signal) => signal.category === "location");
  const weatherSignal = context.signals.find((signal) => signal.category === "weather");
  const timeSignal = context.signals.find((signal) => signal.category === "time");

  nodes = upsert(nodes, {
    id: LIVE_BUNDLE,
    type: "context",
    label: context.compositeState?.trim() || "Live context (this device, last pipeline run)",
    weight: 0.68
  });
  addEdge({ from: "current-user", to: LIVE_BUNDLE, relation: "during", weight: 0.68 });

  if (locationSignal?.category === "location") {
    const lat = locationSignal.userPosition.latitude;
    const lon = locationSignal.userPosition.longitude;
    const placeId = "live:observed-position" as const;
    nodes = upsert(nodes, {
      id: placeId,
      type: "place",
      label: `Observed position (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
      weight: 0.78
    });
    addEdge({ from: "current-user", to: placeId, relation: "visited", weight: 0.78 });
    addEdge({ from: LIVE_BUNDLE, to: placeId, relation: "near", weight: 0.7 });
  }

  if (weatherSignal?.category === "weather") {
    const weatherId = "live:observed-weather" as const;
    nodes = upsert(nodes, {
      id: weatherId,
      type: "context",
      label: `Weather: ${weatherSignal.condition}, ${Math.round(weatherSignal.temperatureC)}C`,
      weight: 0.6
    });
    addEdge({ from: LIVE_BUNDLE, to: weatherId, relation: "during", weight: 0.6 });
  }

  if (timeSignal?.category === "time") {
    const timeId = "live:observed-time" as const;
    nodes = upsert(nodes, {
      id: timeId,
      type: "habit",
      label: `Time: ${timeSignal.dayOfWeek} ${timeSignal.window}`,
      weight: 0.58
    });
    addEdge({ from: LIVE_BUNDLE, to: timeId, relation: "during", weight: 0.58 });
  }

  merchants.slice(0, 5).forEach((merchant) => {
    const merchantNodeId = `merchant-${merchant.id}`;
    nodes = upsert(nodes, {
      id: merchantNodeId,
      type: "place",
      label: `${merchant.name} (nearby)`,
      weight: 0.72
    });
    addEdge({ from: LIVE_BUNDLE, to: merchantNodeId, relation: "near", weight: 0.72 });
  });

  return { nodes, edges };
};

const eventWindow = (startsAt: string): RoutineTrigger["timeOfDay"] => {
  const hour = new Date(startsAt).getHours();

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

export const addCalendarEventsToGraph = (
  graph: LocalKnowledgeGraph,
  events: CalendarEvent[]
): { graph: LocalKnowledgeGraph; triggers: RoutineTrigger[] } => {
  const existingNodeIds = new Set(graph.nodes.map((node) => node.id));
  const existingEdges = new Set(graph.edges.map((edge) => `${edge.from}:${edge.to}:${edge.relation}`));
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];

  events.forEach((event) => {
    const scheduleNodeId = `calendar-${event.id}`;
    const placeNodeId = event.locationName ? `place-${event.locationName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;

    if (!existingNodeIds.has(scheduleNodeId)) {
      nodes.push({
        id: scheduleNodeId,
        type: "schedule",
        label: `${event.title} (${eventWindow(event.startsAt)})`,
        weight: 0.72
      });
      existingNodeIds.add(scheduleNodeId);
    }

    const scheduledEdgeId = `current-user:${scheduleNodeId}:scheduled`;
    if (!existingEdges.has(scheduledEdgeId)) {
      edges.push({ from: "current-user", to: scheduleNodeId, relation: "scheduled", weight: 0.72 });
      existingEdges.add(scheduledEdgeId);
    }

    if (placeNodeId && event.locationName && !existingNodeIds.has(placeNodeId)) {
      nodes.push({
        id: placeNodeId,
        type: "place",
        label: event.locationName,
        weight: 0.66
      });
      existingNodeIds.add(placeNodeId);
    }

    if (placeNodeId) {
      const nearEdgeId = `${scheduleNodeId}:${placeNodeId}:near`;
      if (!existingEdges.has(nearEdgeId)) {
        edges.push({ from: scheduleNodeId, to: placeNodeId, relation: "near", weight: 0.66 });
        existingEdges.add(nearEdgeId);
      }
    }
  });

  return {
    graph: { nodes, edges },
    triggers: events.map((event) => ({
      id: `trigger-${event.id}`,
      sourceEventId: event.id,
      question: `Do you want Spark to find a useful deal for "${event.title}"?`,
      timeOfDay: eventWindow(event.startsAt),
      locationName: event.locationName,
      location: event.location,
      radiusM: event.location ? 250 : undefined
    }))
  };
};

export const inferLocalIntent = async (context: ContextState, graph: LocalKnowledgeGraph): Promise<LocalIntent> => {
  const config = getRuntimeConfig();
  const response = await fetch(`${config.localGemmaUrl}/api/chat`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.localGemmaModel,
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content:
            "You are the on-device City Wallet intent model. Return only valid JSON matching LocalIntent. Keep private graph details local and output only an abstract intent."
        },
        {
          role: "user",
          content: JSON.stringify({
            context,
            localKnowledgeGraph: graph,
            requiredShape: {
              intent: "string",
              urgency: "string",
              tone: "cozy | premium | playful | direct",
              merchantCategory: "cafe | restaurant | retail | culture",
              productHints: ["string"],
              confidence: 0.0,
              privacyBudget: "abstract_intent_allowed",
              abstractSignal: "string",
              evidence: ["string"]
            }
          })
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Local Gemma runtime ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  const content = payload.message?.content;

  if (!content) {
    throw new Error("Local Gemma runtime returned an empty response.");
  }

  return parseModelJson<LocalIntent>(content);
};

export const inferLocalIntentForQuestion = async (
  question: string,
  context: ContextState,
  graph: LocalKnowledgeGraph
): Promise<LocalIntent> => {
  const intent = await inferLocalIntent(
    {
      ...context,
      compositeState: `${context.compositeState}; user confirmed prompt: ${question}`,
      visibleReasons: [`User asked Spark: ${question}`, ...context.visibleReasons]
    },
    graph
  );

  return {
    ...intent,
    intent: `${intent.intent}; ${question}`,
    urgency: "user_confirmed",
    abstractSignal: `${intent.abstractSignal}; confirmed routine task`
  };
};

export const recordOfferOutcomeLocally = (
  graph: LocalKnowledgeGraph,
  offerId: string,
  outcome: "accepted" | "dismissed" | "redeemed"
): LocalKnowledgeGraph => {
  const nodeId = `offer:${outcome}:${offerId}`;
  const relation = outcome === "dismissed" ? "ignored" : outcome === "redeemed" ? "redeemed" : "accepted";
  const weight = outcome === "dismissed" ? 0.4 : outcome === "accepted" ? 0.82 : 1;

  if (graph.nodes.some((node) => node.id === nodeId)) {
    return graph;
  }

  return {
    nodes: [...graph.nodes, { id: nodeId, type: "offer", label: `${outcome} ${offerId}`, weight }],
    edges: [...graph.edges, { from: "current-user", to: nodeId, relation, weight }]
  };
};
