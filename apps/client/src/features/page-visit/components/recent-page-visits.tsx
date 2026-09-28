import { Group, Skeleton, Stack, Text, VisuallyHidden } from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { IconClock, IconHistory } from "@tabler/icons-react";
import { isToday, isYesterday } from "date-fns";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildPageUrl } from "@/features/page/page.utils";
import { getPageIcon } from "@/lib";
import { timeAgo } from "@/lib/time";
import { IRecentPageVisit } from "../types/page-visit.types";
import classes from "./recent-page-visits.module.css";

interface RecentPageVisitsProps {
  items: IRecentPageVisit[];
  isLoading: boolean;
  isError: boolean;
  showSpace: boolean;
}

type VisitGroup = "Today" | "Yesterday" | "Earlier";

function groupVisits(items: IRecentPageVisit[]) {
  const groups: Record<VisitGroup, IRecentPageVisit[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };

  items.forEach((item) => {
    const date = new Date(item.lastVisitedAt);
    if (isToday(date)) groups.Today.push(item);
    else if (isYesterday(date)) groups.Yesterday.push(item);
    else groups.Earlier.push(item);
  });

  return groups;
}

export function RecentPageVisits({
  items,
  isLoading,
  isError,
  showSpace,
}: RecentPageVisitsProps) {
  const { t } = useTranslation();
  const groups = groupVisits(items);

  return (
    <>
      <div className={classes.header}>
        <div className={classes.headerTitle}>
          <IconHistory size={17} stroke={1.8} />
          <Text size="sm" fw={600}>
            {t("Recently viewed")}
          </Text>
        </div>
        <Text size="xs" fw={500} className={classes.retention}>
          {t("Last 30 days")}
        </Text>
      </div>

      {isLoading ? (
        <Stack gap="xs" className={classes.skeleton}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Group key={index} gap="sm" wrap="nowrap">
              <Skeleton height={32} width={32} radius="md" />
              <div style={{ flex: 1 }}>
                <Skeleton height={11} width={`${70 - index * 4}%`} mb={7} />
                <Skeleton height={8} width="28%" />
              </div>
            </Group>
          ))}
        </Stack>
      ) : isError || items.length === 0 ? (
        <div className={classes.empty}>
          <IconClock className={classes.emptyIcon} size={48} stroke={1.4} />
          <Text fw={600} size="sm">
            {isError
              ? t("Failed to load recently viewed pages")
              : t("No recently viewed pages")}
          </Text>
          {!isError && (
            <Text c="dimmed" size="xs" maw={300} mt={5}>
              {t("Pages you open will appear here for 30 days.")}
            </Text>
          )}
        </div>
      ) : (
        (Object.entries(groups) as [VisitGroup, IRecentPageVisit[]][]).map(
          ([label, visits]) =>
            visits.length > 0 && (
              <Spotlight.ActionsGroup key={label} label={t(label)}>
                <VisuallyHidden>{t(label)}</VisuallyHidden>
                {visits.map((visit) => (
                  <Spotlight.Action
                    key={visit.id}
                    component={Link}
                    // @ts-ignore Mantine's polymorphic Link types do not expose `to`.
                    to={buildPageUrl(
                      visit.space.slug,
                      visit.page.slugId,
                      visit.page.title || undefined,
                    )}
                  >
                    <Group wrap="nowrap" gap="sm" w="100%">
                      <div className={classes.iconTile}>
                        {getPageIcon(visit.page.icon || undefined)}
                      </div>
                      <div className={classes.content}>
                        <Text
                          size="sm"
                          fw={500}
                          lineClamp={1}
                          className={classes.title}
                        >
                          {visit.page.title || t("Untitled")}
                        </Text>
                        {showSpace && (
                          <Text
                            size="xs"
                            lineClamp={1}
                            className={classes.meta}
                          >
                            {visit.space.name}
                          </Text>
                        )}
                      </div>
                      <Text size="xs" className={classes.time}>
                        {timeAgo(new Date(visit.lastVisitedAt))}
                      </Text>
                    </Group>
                  </Spotlight.Action>
                ))}
              </Spotlight.ActionsGroup>
            ),
        )
      )}
    </>
  );
}
