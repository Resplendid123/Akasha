import api from "@/lib/api-client";
import { IRecentPageVisit } from "../types/page-visit.types";

export async function recordPageVisit(pageId: string): Promise<void> {
  await api.post("/page-visits", { pageId });
}

export async function getRecentPageVisits(params: {
  spaceId?: string;
  limit?: number;
}): Promise<IRecentPageVisit[]> {
  const response = await api.post<{ items: IRecentPageVisit[] }>(
    "/page-visits/recent",
    params,
  );
  return response.data.items;
}
