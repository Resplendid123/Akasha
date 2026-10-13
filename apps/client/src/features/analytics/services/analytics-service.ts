import api from "@/lib/api-client";
import {
  AnalyticsRangeKey,
  IAnalyticsOverview,
  ITrackPageView,
} from "../types/analytics.types";

export async function trackPageView(data: ITrackPageView): Promise<void> {
  await api.post("/analytics/track", data);
}

export async function getAnalyticsOverview(params: {
  range: AnalyticsRangeKey;
  spaceId?: string;
}): Promise<IAnalyticsOverview> {
  const response = await api.get<IAnalyticsOverview>("/analytics/overview", {
    params,
  });
  return response.data;
}
