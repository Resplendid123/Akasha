import { SegmentedControl, Text, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ISpace } from "@/features/space/types/space.types.ts";
import { useUpdateSpaceMutation } from "@/features/space/queries/space-query.ts";
import type { KnowledgeIndexMode } from "@/features/page/services/page-service.ts";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row.tsx";

type SpaceKnowledgeSettingsProps = {
  space: ISpace;
  readOnly?: boolean;
};

export default function SpaceKnowledgeSettings({
  space,
  readOnly,
}: SpaceKnowledgeSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateSpaceMutation = useUpdateSpaceMutation();
  const savedMode: KnowledgeIndexMode =
    space.settings?.knowledge?.indexMode ?? "compiled";
  const [indexMode, setIndexMode] = useState<KnowledgeIndexMode>(savedMode);

  useEffect(() => {
    setIndexMode(savedMode);
  }, [savedMode]);

  const handleChange = async (value: string) => {
    if (value !== "compiled" && value !== "original") return;
    const previous = indexMode;
    setIndexMode(value);
    try {
      await updateSpaceMutation.mutateAsync({
        spaceId: space.id,
        knowledgeIndexMode: value,
      });
      // Pages that follow the space now resolve to a different mode.
      await queryClient.invalidateQueries({
        queryKey: ["page-compile-status"],
      });
    } catch {
      // The mutation shows the error notification.
      setIndexMode(previous);
    }
  };

  return (
    <div>
      <Title order={3} my="md" size="h6" fw={600}>
        {t("Knowledge publishing")}
      </Title>

      <ResponsiveSettingsRow>
        <ResponsiveSettingsContent>
          <Text size="sm" c="dimmed">
            {t(
              "Pages in this space use this mode unless a page sets its own publish mode.",
            )}
          </Text>
        </ResponsiveSettingsContent>
        <ResponsiveSettingsControl>
          <SegmentedControl
            size="xs"
            value={indexMode}
            data={[
              { value: "compiled", label: t("Smart compilation") },
              { value: "original", label: t("Original text indexing") },
            ]}
            onChange={handleChange}
            disabled={readOnly || updateSpaceMutation.isPending}
            aria-label={t("Default publish mode")}
          />
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>
    </div>
  );
}
