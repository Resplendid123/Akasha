import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { useWorkspaceMemberQuery } from "@/features/workspace/queries/workspace-query.ts";
import { getUserRoleLabel } from "@/features/workspace/types/user-role-data.ts";
import { formattedDate } from "@/lib/time.ts";

interface WorkspaceMemberDetailsModalProps {
  userId: string | null;
  opened: boolean;
  onClose: () => void;
}

function formatDate(value: string | null) {
  return value ? formattedDate(new Date(value)) : "-";
}

export default function WorkspaceMemberDetailsModal({
  userId,
  opened,
  onClose,
}: WorkspaceMemberDetailsModalProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } =
    useWorkspaceMemberQuery(userId ?? "", opened && !!userId);
  const notFound = error?.["response"]?.status === 404;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Member details")}
      size="640"
      centered
    >
      <Divider size="xs" mb="md" />

      {isLoading ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : isError || !data ? (
        <Alert
          color={notFound ? "yellow" : "red"}
          title={t(
            notFound
              ? "Workspace member not found"
              : "Failed to load member details",
          )}
        >
          {!notFound && (
            <Button variant="light" size="xs" onClick={() => refetch()}>
              {t("Retry")}
            </Button>
          )}
        </Alert>
      ) : (
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start">
            <Group wrap="nowrap">
              <CustomAvatar
                avatarUrl={data.user.avatarUrl}
                name={data.user.name}
                size="lg"
              />
              <div>
                <Title order={2} size="h4">
                  {data.user.name}
                </Title>
                <Text size="sm" c="dimmed">
                  {data.user.email}
                </Text>
              </div>
            </Group>
            <Group gap="xs">
              <Badge variant="light">
                {t(getUserRoleLabel(data.user.role))}
              </Badge>
              <Badge
                variant="light"
                color={data.user.deactivatedAt ? "orange" : "blue"}
              >
                {t(data.user.deactivatedAt ? "Deactivated" : "Active")}
              </Badge>
            </Group>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <DetailItem
              label={t("Created")}
              value={formatDate(data.user.createdAt)}
            />
            <DetailItem
              label={t("Last login")}
              value={formatDate(data.user.lastLoginAt)}
            />
            <DetailItem label={t("Language")} value={data.user.locale || "-"} />
            <DetailItem label={t("Timezone")} value={data.user.timezone || "-"} />
          </SimpleGrid>

          <Divider />

          <div>
            <Title order={3} size="h5" mb="sm">
              {t("Groups")}
            </Title>
            {data.groups.length === 0 ? (
              <Text c="dimmed" size="sm">
                {t("No groups")}
              </Text>
            ) : (
              <Stack gap="xs">
                {data.groups.map((group) => (
                  <Group key={group.id} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="sm" fw={500}>
                        {group.name}
                      </Text>
                      {group.description && (
                        <Text size="xs" c="dimmed">
                          {group.description}
                        </Text>
                      )}
                    </div>
                    <Group gap="xs">
                      {group.isDefault && (
                        <Badge variant="light">{t("Default")}</Badge>
                      )}
                      {group.isExternal && (
                        <Badge variant="light">{t("External")}</Badge>
                      )}
                    </Group>
                  </Group>
                ))}
              </Stack>
            )}
          </div>
        </Stack>
      )}
    </Modal>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{value}</Text>
    </div>
  );
}
