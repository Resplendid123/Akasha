import { useState } from "react";
import { Group, Switch, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import useUserRole from "@/hooks/use-user-role";

/** 工作区设置：是否允许普通成员在自己有建页权限的空间里创建模板。 */
export default function MemberTemplateSetting() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [pending, setPending] = useState(false);
  const enabled = workspace?.settings?.templates?.allowMemberTemplates === true;

  const toggle = async (value: boolean) => {
    setPending(true);
    try {
      setWorkspace(await updateWorkspace({ allowMemberTemplates: value }));
    } catch (err: any) {
      notifications.show({
        color: "red",
        message: err?.response?.data?.message ?? t("Failed to update setting"),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Members can create templates")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Members can create templates — for all spaces, or for spaces where they can create pages — and manage the ones they created.",
          )}
        </Text>
      </div>
      <Switch
        checked={enabled}
        disabled={!isAdmin || pending}
        onChange={(e) => toggle(e.currentTarget.checked)}
        aria-label={t("Members can create templates")}
      />
    </Group>
  );
}
