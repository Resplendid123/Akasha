import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { PageTemplate } from "../api/template.types";

/** 创建人头像 + 名字（可选附带更新时间）。 */
export function TemplateCreator({
  template,
  withUpdated = false,
  size = "xs",
}: {
  template: Pick<PageTemplate, "creator" | "updatedAt">;
  withUpdated?: boolean;
  size?: "xs" | "sm";
}) {
  const { t } = useTranslation();
  const updated = useTimeAgo(template.updatedAt);
  const name = template.creator?.name || t("Unknown user");

  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <CustomAvatar
        avatarUrl={template.creator?.avatarUrl ?? undefined}
        name={name}
        size={size === "xs" ? 18 : 22}
      />
      <Text size={size} c="dimmed" truncate>
        {withUpdated
          ? t("{{name}} · updated {{time}}", { name, time: updated })
          : name}
      </Text>
    </Group>
  );
}
