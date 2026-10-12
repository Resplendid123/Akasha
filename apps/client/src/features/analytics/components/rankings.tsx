import { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Anchor,
  Group,
  Paper,
  SimpleGrid,
  Table,
  Text,
} from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { AvatarIconType } from "@/features/attachments/types/attachment.types";
import { buildPageUrl } from "@/features/page/page.utils";
import { getSpaceUrl } from "@/lib/config";
import { IAnalyticsOverview } from "../types/analytics.types";

const ROUTE_LABELS: Record<string, string> = {
  home: "Home",
  ai: "AI Q&A",
  spaces: "Spaces",
  favorites: "Favorites",
  "space.home": "Space home",
  "space.page": "Document page",
  "space.trash": "Trash",
  graph: "Knowledge graph",
  "knowledge.admin": "Knowledge admin",
  labels: "Labels",
  templates: "Templates",
  settings: "Settings",
  analytics: "User analytics",
  other: "Other",
};

function RankCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} size="sm" mb="sm">
        {title}
      </Text>
      {empty ? (
        <Text size="sm" c="dimmed">
          {t("No data in this range")}
        </Text>
      ) : (
        children
      )}
    </Paper>
  );
}

function Num({ children }: { children: ReactNode }) {
  return (
    <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>
      {children}
    </Table.Td>
  );
}

export function Rankings({
  rankings,
}: {
  rankings: IAnalyticsOverview["rankings"];
}) {
  const { t } = useTranslation();
  const { topSpaces, topPages, topUsers, routeBreakdown } = rankings;

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      {topSpaces && (
        <RankCard title={t("Top spaces")} empty={topSpaces.length === 0}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Space")}</Table.Th>
                <Table.Th ta="right">PV</Table.Th>
                <Table.Th ta="right">UV</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {topSpaces.map((s) => (
                <Table.Tr key={s.spaceId}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <CustomAvatar
                        name={s.name ?? ""}
                        avatarUrl={s.logo ?? undefined}
                        type={AvatarIconType.SPACE_ICON}
                        color="initials"
                        variant="filled"
                        size={20}
                      />
                      <Anchor
                        component={Link}
                        to={getSpaceUrl(s.slug)}
                        size="sm"
                        lineClamp={1}
                      >
                        {s.name || t("Untitled")}
                      </Anchor>
                    </Group>
                  </Table.Td>
                  <Num>{s.pv.toLocaleString()}</Num>
                  <Num>{s.uv.toLocaleString()}</Num>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </RankCard>
      )}

      <RankCard title={t("Top pages")} empty={topPages.length === 0}>
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Page")}</Table.Th>
              <Table.Th ta="right">PV</Table.Th>
              <Table.Th ta="right">UV</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {topPages.map((p) => (
              <Table.Tr key={p.pageId}>
                <Table.Td>
                  <Anchor
                    component={Link}
                    to={buildPageUrl(p.spaceSlug, p.slugId, p.title ?? undefined)}
                    size="sm"
                    lineClamp={1}
                  >
                    {p.icon ? `${p.icon} ` : ""}
                    {p.title || t("Untitled")}
                  </Anchor>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {p.spaceName}
                  </Text>
                </Table.Td>
                <Num>{p.pv.toLocaleString()}</Num>
                <Num>{p.uv.toLocaleString()}</Num>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </RankCard>

      <RankCard title={t("Most active users")} empty={topUsers.length === 0}>
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("User")}</Table.Th>
              <Table.Th ta="right">PV</Table.Th>
              <Table.Th ta="right">{t("Page edits")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {topUsers.map((u) => (
              <Table.Tr key={u.userId}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <CustomAvatar
                      name={u.name ?? u.email}
                      avatarUrl={u.avatarUrl ?? undefined}
                      size={24}
                    />
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" lineClamp={1}>
                        {u.name || u.email}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {u.email}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Num>{u.pv.toLocaleString()}</Num>
                <Num>{u.edits.toLocaleString()}</Num>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </RankCard>

      {routeBreakdown && (
        <RankCard
          title={t("Page views by section")}
          empty={routeBreakdown.length === 0}
        >
          <BarChart
            h={Math.max(160, routeBreakdown.length * 32)}
            orientation="vertical"
            yAxisProps={{ width: 110 }}
            data={routeBreakdown.map((r) => ({
              section: t(ROUTE_LABELS[r.route] ?? r.route),
              pv: r.pv,
            }))}
            dataKey="section"
            series={[{ name: "pv", label: "PV", color: "blue.6" }]}
          />
        </RankCard>
      )}
    </SimpleGrid>
  );
}
