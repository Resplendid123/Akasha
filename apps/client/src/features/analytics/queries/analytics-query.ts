import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAnalyticsOverview } from "../services/analytics-service";
import { AnalyticsRangeKey } from "../types/analytics.types";

export function useAnalyticsOverviewQuery(
  range: AnalyticsRangeKey,
  spaceId: string | undefined,
) {
  return useQuery({
    queryKey: ["analytics-overview", range, spaceId],
    queryFn: () => getAnalyticsOverview({ range, spaceId }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
