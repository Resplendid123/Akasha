import { useQuery } from "@tanstack/react-query";
import { getRecentPageVisits } from "../services/page-visit-service";

export const RECENT_PAGE_VISITS_QUERY_KEY = "recent-page-visits";

export function useRecentPageVisitsQuery(
  spaceId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [RECENT_PAGE_VISITS_QUERY_KEY, spaceId],
    queryFn: () => getRecentPageVisits({ spaceId, limit: 15 }),
    enabled,
    staleTime: 30_000,
  });
}
