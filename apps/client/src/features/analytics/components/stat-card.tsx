import { Paper, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface StatCardProps {
  label: string;
  value: number;
  delta?: number;
  hint?: string;
  format?: (value: number) => string;
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  format,
}: StatCardProps) {
  const { t } = useTranslation();

  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed" fw={500}>
        {label}
      </Text>
      <Text fz={26} fw={700} mt={4}>
        {format ? format(value) : value.toLocaleString()}
      </Text>
      {delta !== undefined && (
        <Text size="xs" c={delta > 0 ? "teal" : "dimmed"} mt={2}>
          {t("+{{count}} in range", { count: delta })}
        </Text>
      )}
      {hint && (
        <Text size="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      )}
    </Paper>
  );
}
