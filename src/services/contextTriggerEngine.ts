import { ContextState, GeneratedOffer, Merchant } from "../types";

export type ContextTriggerDecision = {
  shouldNotify: boolean;
  title: string;
  body: string;
  reasons: string[];
};

export const evaluateContextTrigger = (
  context: ContextState,
  merchant: Merchant,
  offer: GeneratedOffer
): ContextTriggerDecision => {
  const quietDemand = context.compositeState.includes("nearby merchant quiet");
  const browsing = context.compositeState.includes("browsing");
  const relevantTime = merchant.rules.some((rule) => offer.ruleId === rule.id);
  const hasDealEvidence = Boolean(offer.generationEvidence.dealSource);
  const shouldNotify = quietDemand && browsing && relevantTime && hasDealEvidence;
  const reasons = [
    ...context.visibleReasons.slice(0, 3),
    `Merchant rule: ${offer.generationEvidence.merchantRule}`,
    `Deal source: ${offer.generationEvidence.dealSource}`
  ];

  return {
    shouldNotify,
    title: `Spark found ${offer.discountPercent}% cashback nearby`,
    body: `${offer.product} at ${merchant.name}. ${offer.firstThreeSecondFacts.slice(1, 3).join(" · ")}`,
    reasons
  };
};
