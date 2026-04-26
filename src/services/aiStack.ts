import { BrowserAgentMode, BrowserSkill, ContextState, AgentDealInsight, AiStackValidation, LocalIntent } from "../types";
import { getRuntimeConfig } from "../config/runtimeConfig";

export const aiStackValidation: AiStackValidation = {
  localModel: {
    requested: "Gemma 4 E4B on-device",
    mvpRuntime: "Required local Gemma runtime at EXPO_PUBLIC_LOCAL_GEMMA_URL",
    status: "adapter_ready",
    privacyBoundary: "Raw activity, habit, preference, and location graph stays on the phone."
  },
  cloudAgent: {
    requested: "Gemini 3.1 Pro Preview with Hermes Agent browser",
    browserLayer: "Required Hermes Agent endpoint at EXPO_PUBLIC_HERMES_AGENT_URL",
    status: "adapter_ready",
    outboundData: ["abstract intent", "coarse city area", "merchant category", "non-personal context", "local browser skills for public sites"]
  }
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

    throw new Error("Local Gemma browser agent returned text that was not valid JSON.");
  }
};

const discoverDealInsightWithGemma = async (
  intent: LocalIntent,
  context: ContextState
): Promise<AgentDealInsight> => {
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
            "You are Spark's private local browser-agent substitute. Do not browse or invent live web facts. Return only valid JSON matching AgentDealInsight, using the local abstract intent and context."
        },
        {
          role: "user",
          content: JSON.stringify({
            abstractIntent: intent.abstractSignal,
            merchantCategory: intent.merchantCategory,
            productHints: intent.productHints,
            city: context.city,
            compositeState: context.compositeState,
            visibleContextReasons: context.visibleReasons,
            requiredShape: {
              source: "gemma_local",
              summary: "string",
              suggestedProduct: "string",
              marketAnchorPriceEur: 0,
              confidence: 0.0,
              sourceUrl: "local://gemma4/browser-agent",
              localEventTieIn: "string optional"
            }
          })
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Local Gemma browser agent ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  const content = payload.message?.content;

  if (!content) {
    throw new Error("Local Gemma browser agent returned an empty response.");
  }

  const insight = parseModelJson<AgentDealInsight>(content);
  const price = Number(insight.marketAnchorPriceEur);
  const confidence = Number(insight.confidence);

  if (!insight.summary || !insight.suggestedProduct || !Number.isFinite(price) || !Number.isFinite(confidence)) {
    throw new Error("Local Gemma browser agent response did not match the required deal insight schema.");
  }

  return {
    source: "gemma_local",
    summary: insight.summary,
    suggestedProduct: insight.suggestedProduct,
    marketAnchorPriceEur: price,
    confidence,
    sourceUrl: "local://gemma4/browser-agent",
    localEventTieIn: insight.localEventTieIn
  };
};

export const discoverDealInsight = async (
  intent: LocalIntent,
  context: ContextState,
  browserAgentMode: BrowserAgentMode = "gemini-2.5-pro",
  browserSkills: BrowserSkill[] = []
): Promise<AgentDealInsight> => {
  if (browserAgentMode === "gemma") {
    return discoverDealInsightWithGemma(intent, context);
  }

  const config = getRuntimeConfig();
  const response = await fetch(`${config.hermesAgentUrl}/hermes/tasks`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.geminiApiKey}`
    },
    body: JSON.stringify({
      model: browserAgentMode,
      browser: "hermes-agent",
      task:
        "Find current public internet deals, merchant pages, menus, product prices, event signals, whether the place appears open now, and grounded busy/popularity signals relevant to this abstract city-wallet intent. Include deals even when the business is not a signed-up City Wallet merchant. Return strict JSON matching AgentDealInsight.",
      input: {
        abstractIntent: intent.abstractSignal,
        merchantCategory: intent.merchantCategory,
        productHints: intent.productHints,
        city: context.city,
        compositeState: context.compositeState,
        visibleContextReasons: context.visibleReasons,
        browserSkills: browserSkills.map((skill) => ({
          host: skill.host,
          origin: skill.origin,
          pathHint: skill.pathHint,
          instruction: skill.instruction,
          successCount: skill.successCount,
          lastUsedAt: skill.lastUsedAt
        }))
      },
      privacy:
        "Do not request or infer private user graph, precise movement trail, name, or raw behavioral history. Use abstract intent and local browser skills for public-site navigation only. Verify live page content every time."
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hermes Agent ${response.status}: ${body}`);
  }

  return response.json() as Promise<AgentDealInsight>;
};
