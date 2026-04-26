const readRequiredEnv = (key: string) => {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const getRuntimeConfig = () => ({
  cityWalletApiUrl: readRequiredEnv("EXPO_PUBLIC_CITY_WALLET_API_URL"),
  hermesAgentUrl: readRequiredEnv("EXPO_PUBLIC_HERMES_AGENT_URL"),
  geminiApiKey: readRequiredEnv("EXPO_PUBLIC_GEMINI_API_KEY"),
  localGemmaUrl: readRequiredEnv("EXPO_PUBLIC_LOCAL_GEMMA_URL"),
  localGemmaModel: readRequiredEnv("EXPO_PUBLIC_LOCAL_GEMMA_MODEL"),
  userId: readRequiredEnv("EXPO_PUBLIC_CITY_WALLET_USER_ID")
});
