import {
  useInfiniteQuery,
  useQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  searchPagePaged,
  searchAttachments,
} from "@/features/search/services/search-service";
import {
  IAttachmentSearch,
  IPageSearch,
  IPageSearchParams,
} from "@/features/search/types/search.types";

export type UnifiedSearchResult = IPageSearch | IAttachmentSearch;

export interface UseUnifiedSearchParams extends IPageSearchParams {
  contentType?: string;
}

export const PAGE_SEARCH_PAGE_SIZE = 50;

export function useUnifiedSearch(
  params: UseUnifiedSearchParams,
  enabled: boolean = true,
): UseQueryResult<IAttachmentSearch[], Error> {
  const isAttachmentSearch = params.contentType === "attachment";

  return useQuery({
    queryKey: ["unified-search", "attachment", params],
    queryFn: async () => {
      // Remove contentType from backend params since it's only used for frontend routing
      const { contentType, ...backendParams } = params;
      return await searchAttachments(backendParams);
    },
    enabled: !!params.query && enabled && isAttachmentSearch,
  });
}

// 页面搜索分页加载：每页 50 条，首次请求即返回权限过滤后的总数
export function usePageSearchInfinite(
  params: UseUnifiedSearchParams,
  enabled: boolean = true,
) {
  const isPageSearch = params.contentType !== "attachment";

  return useInfiniteQuery({
    queryKey: ["unified-search", "page", params],
    queryFn: async ({ pageParam }) => {
      const { contentType, ...backendParams } = params;
      return await searchPagePaged({
        ...backendParams,
        limit: PAGE_SEARCH_PAGE_SIZE,
        offset: pageParam,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return lastPage.items.length > 0 && loaded < lastPage.total
        ? loaded
        : undefined;
    },
    enabled: !!params.query && enabled && isPageSearch,
  });
}
