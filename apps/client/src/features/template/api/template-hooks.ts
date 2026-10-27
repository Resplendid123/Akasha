import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  createTemplate,
  fetchTemplate,
  listTemplates,
  removeTemplate,
  saveTemplate,
} from "./template-api";
import {
  PageTemplate,
  TemplateDraft,
  TemplateListParams,
} from "./template.types";

export const templateKeys = {
  all: ["page-templates"] as const,
  list: (params: Omit<TemplateListParams, "cursor">) =>
    [...templateKeys.all, "list", params] as const,
  detail: (id: string) => [...templateKeys.all, "detail", id] as const,
};

function errorMessage(err: any, fallback: string) {
  return err?.response?.data?.message ?? fallback;
}

export function useTemplateList(params: Omit<TemplateListParams, "cursor">) {
  return useInfiniteQuery({
    queryKey: templateKeys.list(params),
    queryFn: ({ pageParam }) =>
      listTemplates({ limit: 50, ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasNextPage ? last.meta.nextCursor : undefined,
    placeholderData: keepPreviousData,
    select: (data) => data.pages.flatMap((p) => p.items),
  });
}

export function useTemplate(templateId: string | null | undefined) {
  return useQuery({
    queryKey: templateKeys.detail(templateId ?? ""),
    queryFn: () => fetchTemplate(templateId!),
    enabled: !!templateId,
    staleTime: 30_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: createTemplate,
    onSuccess: (tpl) => {
      qc.setQueryData(templateKeys.detail(tpl.id), tpl);
      qc.invalidateQueries({ queryKey: [...templateKeys.all, "list"] });
    },
    onError: (err) =>
      notifications.show({
        color: "red",
        message: errorMessage(err, t("Failed to create template")),
      }),
  });
}

export function useSaveTemplate(templateId: string) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (draft: TemplateDraft) => saveTemplate(templateId, draft),
    onSuccess: (tpl) => {
      qc.setQueryData(templateKeys.detail(tpl.id), tpl);
      qc.invalidateQueries({ queryKey: [...templateKeys.all, "list"] });
    },
    onError: (err) =>
      notifications.show({
        color: "red",
        message: errorMessage(err, t("Failed to save template")),
      }),
  });
}

export function useRemoveTemplate() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (tpl: Pick<PageTemplate, "id">) => removeTemplate(tpl.id),
    onSuccess: (_res, tpl) => {
      qc.removeQueries({ queryKey: templateKeys.detail(tpl.id) });
      qc.invalidateQueries({ queryKey: [...templateKeys.all, "list"] });
      notifications.show({ message: t("Template deleted") });
    },
    onError: (err) =>
      notifications.show({
        color: "red",
        message: errorMessage(err, t("Failed to delete template")),
      }),
  });
}
