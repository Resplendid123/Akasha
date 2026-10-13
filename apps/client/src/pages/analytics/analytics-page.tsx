import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAtomValue } from "jotai";
import {
  Alert,
  Container,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { localDate } from "@/features/analytics/utils/local-date";
import { getAppName } from "@/lib/config";
import useUserRole from "@/hooks/use-user-role";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { SpaceSelect } from "@/features/space/components/sidebar/space-select";
import { ISpace } from "@/features/space/types/space.types";
import { useAnalyticsOverviewQuery } from "@/features/analytics/queries/analytics-query";
import { AnalyticsRangeKey } from "@/features/analytics/types/analytics.types";
import { StatCard } from "@/features/analytics/components/stat-card";
import { TrendCharts } from "@/features/analytics/components/trend-charts";
import { Rankings } from "@/features/analytics/components/rankings";
import { AgentPanel } from "@/features/analytics/components/agent-panel";

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const currentUser = useAtomValue(currentUserAtom);
  const { isAdmin } = useUserRole();
  const [range, setRange] = useState<AnalyticsRangeKey>("30d");
  const [space, setSpace] = useState<ISpace | null>(null);
  const { data, isLoading, isError } = useAnalyticsOverviewQuery(
    range,
    space?.id,
  );

  if (currentUser && !isAdmin) return <Navigate to="/home" replace />;

  const cards = data?.cards;
  const isWorkspace = data?.scope === "workspace";
  const trackingStartsLate =
    data?.trackingSince && data.trackingSince > data.range.from;

  return (
    <>
      <Helmet>
        <title>
          {t("User analytics")} - {getAppName()}
        </title>
      </Helmet>
      <Container size="xl" py="xl">
        <Group justify="space-between" mb="lg" wrap="wrap" gap="sm">
          <Title order={1} size="h3">
            {t("User analytics")}
          </Title>
          <Group gap="sm" wrap="wrap">
            <SpaceSelect
              value={space?.slug}
              clearable
              width={280}
              onChange={(value) => setSpace(value ?? null)}
            />
            <SegmentedControl
              value={range}
              onChange={(value) => setRange(value as AnalyticsRangeKey)}
              data={[
                { label: t("Last 7 days"), value: "7d" },
                { label: t("Last 30 days"), value: "30d" },
                { label: t("Last 90 days"), value: "90d" },
              ]}
            />
          </Group>
        </Group>

        {isLoading && (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        )}

        {isError && <Text c="red">{t("Failed to load analytics")}</Text>}

        {data && cards && (
          <Stack gap="lg">
            {trackingStartsLate && (
              <Alert variant="light" icon={<IconInfoCircle size={16} />}>
                {t("Page view tracking started on {{date}}", {
                  date: localDate(data.trackingSince!),
                })}
              </Alert>
            )}
            {space && (
              <Text size="sm" c="dimmed">
                {t(
                  "Showing metrics for {{name}}. Users, spaces and AI Q&A are workspace-wide and hidden here.",
                  { name: space.name },
                )}
              </Text>
            )}

            <SimpleGrid cols={{ base: 2, sm: 3, lg: isWorkspace ? 6 : 4 }}>
              <StatCard label={t("Page views (PV)")} value={cards.pv} />
              <StatCard label={t("Unique visitors (UV)")} value={cards.uv} />
              {isWorkspace && (
                <StatCard
                  label={t("Users")}
                  value={cards.totalUsers!}
                  delta={cards.newUsers}
                />
              )}
              {isWorkspace && (
                <StatCard
                  label={t("Public spaces")}
                  value={cards.totalSpaces!}
                  delta={cards.newSpaces}
                />
              )}
              <StatCard
                label={t("Pages")}
                value={cards.totalPages}
                delta={cards.newPages}
              />
              {isWorkspace ? (
                <StatCard
                  label={t("AI questions")}
                  value={cards.aiQuestions!}
                  hint={t("{{count}} askers", { count: cards.aiAskers })}
                />
              ) : (
                <StatCard label={t("Page edits")} value={cards.pageEdits} />
              )}
            </SimpleGrid>

            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <StatCard
                label={t("Avg. DAU")}
                value={cards.avgDau}
                hint={t("Daily active users, averaged over the range")}
              />
              <StatCard
                label={t("WAU")}
                value={cards.wau}
                hint={t("Active in the last 7 days")}
              />
              <StatCard
                label={t("MAU")}
                value={cards.mau}
                hint={t("Active in the last 30 days")}
              />
              <StatCard
                label={t("Stickiness")}
                value={cards.stickiness}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                hint={t("Average DAU / MAU")}
              />
            </SimpleGrid>

            <TrendCharts daily={data.series.daily} isWorkspace={isWorkspace} />
            <Rankings rankings={data.rankings} />
            {data.agents && (
              <AgentPanel agents={data.agents} rangeFrom={data.range.from} />
            )}
          </Stack>
        )}
      </Container>
    </>
  );
}
