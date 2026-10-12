import { Alert, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { BarChart, DonutChart } from "@mantine/charts";
import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { localDate } from "../utils/local-date";
import { timeAgo } from "@/lib/time";
import { StatCard } from "./stat-card";
import { AgentOpCategory, IAnalyticsAgents } from "../types/analytics.types";

const CATEGORY_META: Record<AgentOpCategory, { label: string; color: string }> = {
  query: { label: "Knowledge Q&A", color: "grape.6" },
  search: { label: "Search", color: "blue.6" },
  read: { label: "Read", color: "teal.6" },
  write: { label: "Write", color: "orange.6" },
  delete: { label: "Delete", color: "red.6" },
  other: { label: "Other", color: "gray.5" },
};

export function AgentPanel({
  agents,
  rangeFrom,
}: {
  agents: IAnalyticsAgents;
  rangeFrom: string;
}) {
  const { t } = useTranslation();
  const data = agents.daily.map((row) => ({ ...row, day: row.date.slice(5) }));
  const categories = agents.byCategory
    .filter((c) => c.count > 0)
    .map((c) => ({
      name: t(CATEGORY_META[c.category].label),
      value: c.count,
      color: CATEGORY_META[c.category].color,
    }));
  const trackingStartsLate =
    !agents.trackingSince || agents.trackingSince > rangeFrom;

  return (
    <Stack gap="md">
      <Title order={2} size="h4">
        {t("Agents")}
      </Title>

      {trackingStartsLate && (
        <Alert variant="light" icon={<IconInfoCircle size={16} />}>
          {agents.trackingSince
            ? t("Agent operation tracking started on {{date}}", {
                date: localDate(agents.trackingSince),
              })
            : t("No agent operations recorded yet")}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <StatCard
          label={t("Agents")}
          value={agents.totalAgents}
          delta={agents.newAgents}
        />
        <StatCard
          label={t("Active agents")}
          value={agents.activeAgents}
          hint={t("Made at least one call in range")}
        />
        <StatCard label={t("Agent operations")} value={agents.ops} />
        <StatCard
          label={t("Failed API calls")}
          value={agents.failedOps}
          hint={t("MCP tool results are not counted")}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="md">
            {t("Agent operations per day")}
          </Text>
          <BarChart
            h={240}
            data={data}
            dataKey="day"
            type="stacked"
            withLegend
            series={[
              { name: "mcp", label: "MCP", color: "violet.6" },
              { name: "api", label: "API", color: "cyan.5" },
            ]}
          />
        </Paper>

        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="md">
            {t("Operations by type")}
          </Text>
          {categories.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("No data in this range")}
            </Text>
          ) : (
            <SimpleGrid cols={2} spacing="md" style={{ alignItems: "center" }}>
              <DonutChart
                data={categories}
                size={180}
                thickness={28}
                withLabelsLine={false}
                tooltipDataSource="segment"
                mx="auto"
              />
              <Stack gap={6}>
                {categories.map((c) => (
                  <Text key={c.name} size="sm">
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        marginRight: 8,
                        background: `var(--mantine-color-${c.color.replace(".", "-")})`,
                      }}
                    />
                    {c.name}
                    <Text span c="dimmed" ml={6}>
                      {c.value.toLocaleString()} (
                      {((c.value / agents.ops) * 100).toFixed(0)}%)
                    </Text>
                  </Text>
                ))}
              </Stack>
            </SimpleGrid>
          )}
        </Paper>

        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="sm">
            {t("Agent activity")}
          </Text>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Agent")}</Table.Th>
                <Table.Th ta="right">{t("Operations")}</Table.Th>
                <Table.Th ta="right">{t("Last used")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {agents.topAgents.map((a) => {
                const last = a.lastOpAt ?? a.keyLastUsedAt;
                return (
                  <Table.Tr key={a.userId}>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {a.name || t("Untitled")}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">{a.ops.toLocaleString()}</Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" c="dimmed">
                        {last ? timeAgo(new Date(last)) : t("Never")}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>

        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="sm">
            {t("Operations by endpoint")}
          </Text>
          {agents.byOp.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("No data in this range")}
            </Text>
          ) : (
            <BarChart
              h={Math.max(160, agents.byOp.length * 28)}
              orientation="vertical"
              yAxisProps={{ width: 150 }}
              data={agents.byOp}
              dataKey="op"
              series={[
                { name: "count", label: t("Operations"), color: "violet.6" },
              ]}
            />
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
