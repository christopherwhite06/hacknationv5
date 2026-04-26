import { GeneratedOffer, MerchantAnalytics, RedemptionToken } from "../types";
import { getRuntimeConfig } from "../config/runtimeConfig";
import { fetchMerchantAnalytics, validateRedemptionWithApi } from "./cityWalletApi";

export const issueRedemptionToken = async (offer: GeneratedOffer, userId?: string): Promise<RedemptionToken> => {
  const config = getRuntimeConfig();
  const response = await fetch(`${config.cityWalletApiUrl}/redemptions/issue`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      offerId: offer.id,
      merchantId: offer.merchantId,
      userId: userId || config.userId,
      couponCode: offer.couponCode,
      cashbackCents: offer.cashbackCents
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Redemption issue API ${response.status}: ${body}`);
  }

  return response.json() as Promise<RedemptionToken>;
};

export const validateRedemptionToken = async (
  token: RedemptionToken,
  merchantId: string
): Promise<RedemptionToken> => validateRedemptionWithApi(token.id, merchantId, token.qrPayload);

export const loadMerchantAnalytics = (merchantId: string): Promise<MerchantAnalytics> =>
  fetchMerchantAnalytics(merchantId);
