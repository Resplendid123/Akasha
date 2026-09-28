import {
  ActionIcon,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Switch,
  Text,
} from "@mantine/core";
import HistoryList from "@/features/page-history/components/history-list";
import classes from "./css/history.module.css";
import { useAtom, useAtomValue } from "jotai";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  diffCountsAtom,
  diffStateAtom,
  highlightChangesAtom,
} from "@/features/page-history/atoms/history-atoms";
import HistoryView from "@/features/page-history/components/history-view";
import { useRef } from "react";
import { IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useDiffNavigation,
  useHistoryReset,
} from "@/features/page-history/hooks";

interface Props {
  pageId: string;
}

export default function HistoryModalBody({ pageId }: Props) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const activeHistoryId = useAtomValue(activeHistoryIdAtom);
  const activeHistoryPrevId = useAtomValue(activeHistoryPrevIdAtom);
  const [highlightChanges, setHighlightChanges] = useAtom(highlightChangesAtom);
  const diffCounts = useAtomValue(diffCountsAtom);
  const diffState = useAtomValue(diffStateAtom);

  useHistoryReset(pageId);
  const { currentChangeIndex, handlePrevChange, handleNextChange } =
    useDiffNavigation(scrollViewportRef);

  return (
    <div className={classes.sidebarFlex}>
      <nav className={classes.sidebar}>
        <div className={classes.sidebarMain}>
          <HistoryList pageId={pageId} />
        </div>
      </nav>

      <div style={{ position: "relative", flex: 1 }}>
        <ScrollArea
          h="min(650px, calc(100dvh - 120px))"
          w="100%"
          scrollbarSize={5}
          viewportRef={scrollViewportRef}
        >
          <div className={classes.sidebarRightSection}>
            {activeHistoryId &&
              (diffState === "computing" ||
                diffState === "loadingPrevious") && (
                <div className={classes.diffProgressBar}>
                  <Loader size={14} />
                  <Text size="sm" c="dimmed">
                    {diffState === "loadingPrevious"
                      ? t("Loading previous version...")
                      : t("Analyzing changes...")}
                  </Text>
                </div>
              )}
            {activeHistoryId && diffState === "error" && (
              <div className={classes.diffProgressBar}>
                <Text size="sm" c="red">
                  {t(
                    "Unable to analyze changes. The document is still available.",
                  )}
                </Text>
              </div>
            )}
            {activeHistoryId && diffState === "tooLarge" && (
              <div className={classes.diffProgressBar}>
                <Text size="sm" c="dimmed">
                  {t(
                    "This version is too large for detailed change highlighting.",
                  )}
                </Text>
              </div>
            )}
            {activeHistoryId && <HistoryView />}
          </div>
        </ScrollArea>

        {activeHistoryId && activeHistoryPrevId && (
          <Paper
            shadow="md"
            radius="xl"
            px="md"
            py="xs"
            style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
            }}
          >
            <Group gap="md" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Switch
                  label={t("Highlight changes")}
                  checked={highlightChanges}
                  disabled={
                    diffState === "computing" ||
                    diffState === "loadingPrevious" ||
                    diffState === "error" ||
                    diffState === "tooLarge"
                  }
                  onChange={(e) => setHighlightChanges(e.currentTarget.checked)}
                  styles={{
                    label: { userSelect: "none", whiteSpace: "nowrap" },
                  }}
                />
                {(diffState === "computing" ||
                  diffState === "loadingPrevious") && <Loader size={14} />}
              </Group>
              {highlightChanges && diffCounts && diffCounts.total > 0 && (
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {currentChangeIndex} of {diffCounts.total}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={handlePrevChange}
                  >
                    <IconChevronUp size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={handleNextChange}
                  >
                    <IconChevronDown size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
          </Paper>
        )}
      </div>
    </div>
  );
}
