import { AgentDealInsight, ContextState, GeneratedOffer, LocalIntent, Merchant } from "../types";
import { getRuntimeConfig } from "../config/runtimeConfig";

export const generateOffer = async (
  context: ContextState,
  intent: LocalIntent,
  merchant: Merchant,
  dealInsight: AgentDealInsight
): Promise<GeneratedOffer> => {
  const config = getRuntimeConfig();
  const response = await fetch(`${config.cityWalletApiUrl}/offers/generate`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      context,
      localIntent: intent,
      merchant,
      dealInsight,
      generationMode: "dynamic_genui"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Offer generation API ${response.status}: ${body}`);
  }

  return response.json() as Promise<GeneratedOffer>;
};
