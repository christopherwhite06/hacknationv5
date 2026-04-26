import AsyncStorage from "@react-native-async-storage/async-storage";
import { AgentDealInsight, BrowserSkill, ContextState, LocalIntent } from "../types";

const browserSkillsKeyForOwner = (ownerId = "signed-out") =>
  `city-wallet.browser-skills.${ownerId.replace(/[^a-z0-9_-]/gi, "_")}`;

const normalizeHints = (hints?: Array<string | null | undefined> | null) =>
  [...new Set((hints || []).map((hint) => hint?.trim().toLowerCase()).filter(Boolean) as string[])].slice(0, 8);

const parseHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
};

export const loadBrowserSkills = async (ownerId: string): Promise<BrowserSkill[]> => {
  const serialized = await AsyncStorage.getItem(browserSkillsKeyForOwner(ownerId));
  if (!serialized) {
    return [];
  }

  const parsed = JSON.parse(serialized) as unknown;
  if (!Array.isArray(parsed)) {
    await saveBrowserSkills(ownerId, []);
    return [];
  }

  return parsed
    .filter((skill): skill is BrowserSkill => {
      const candidate = skill as Partial<BrowserSkill>;
      return Boolean(candidate.origin && candidate.host && candidate.instruction);
    })
    .map((skill) => ({
      ...skill,
      productHints: normalizeHints(skill.productHints),
      successCount: Number.isFinite(Number(skill.successCount)) ? Number(skill.successCount) : 1
    }));
};

export const saveBrowserSkills = (ownerId: string, skills: BrowserSkill[]) =>
  AsyncStorage.setItem(browserSkillsKeyForOwner(ownerId), JSON.stringify(skills.slice(0, 40)));

export const loadRelevantBrowserSkills = async (
  ownerId: string,
  intent: LocalIntent
): Promise<BrowserSkill[]> => {
  const skills = await loadBrowserSkills(ownerId);
  const hints = normalizeHints(intent.productHints);

  return skills
    .filter((skill) => {
      const categoryMatches = skill.merchantCategory === intent.merchantCategory;
      const hintMatches = normalizeHints(skill.productHints).some((hint) => hints.includes(hint));
      return categoryMatches || hintMatches;
    })
    .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt))
    .slice(0, 5);
};

export const learnBrowserSkillFromDeal = async (
  ownerId: string,
  intent: LocalIntent,
  context: ContextState,
  insight: AgentDealInsight
): Promise<BrowserSkill[]> => {
  if (insight.source !== "gemini_hermes") {
    return loadBrowserSkills(ownerId);
  }

  const url = parseHttpUrl(insight.sourceUrl);
  if (!url) {
    return loadBrowserSkills(ownerId);
  }

  const now = new Date().toISOString();
  const skills = await loadBrowserSkills(ownerId);
  const existingIndex = skills.findIndex((skill) => skill.origin === url.origin);
  const productHints = normalizeHints([insight.suggestedProduct, ...(intent.productHints || [])]);
  const pathHint = url.pathname && url.pathname !== "/" ? url.pathname : undefined;
  const instruction = [
    `For ${url.host}, start from ${url.origin}${pathHint || ""}.`,
    `Look for current ${productHints.slice(0, 3).join(", ") || intent.merchantCategory} offers, menu/product pages, prices, and terms.`,
    `This skill was learned from a previous successful Hermes result in ${context.city}; verify live page content every time.`
  ].join(" ");

  const learned: BrowserSkill = {
    id: `skill-${url.host.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    origin: url.origin,
    host: url.host,
    pathHint,
    merchantCategory: intent.merchantCategory,
    productHints,
    learnedFromUrl: insight.sourceUrl,
    instruction,
    successCount: existingIndex >= 0 ? skills[existingIndex].successCount + 1 : 1,
    createdAt: existingIndex >= 0 ? skills[existingIndex].createdAt : now,
    lastUsedAt: now
  };

  const next = existingIndex >= 0
    ? skills.map((skill, index) => (index === existingIndex ? learned : skill))
    : [learned, ...skills];

  await saveBrowserSkills(ownerId, next);
  return next;
};
