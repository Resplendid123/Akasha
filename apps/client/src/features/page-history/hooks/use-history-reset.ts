import { useAtom } from "jotai";
import { useEffect } from "react";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  diffCountsAtom,
  diffStateAtom,
} from "@/features/page-history/atoms/history-atoms";

export function useHistoryReset(pageId: string) {
  const [, setActiveHistoryId] = useAtom(activeHistoryIdAtom);
  const [, setActiveHistoryPrevId] = useAtom(activeHistoryPrevIdAtom);
  const [, setDiffCounts] = useAtom(diffCountsAtom);
  const [, setDiffState] = useAtom(diffStateAtom);

  useEffect(() => {
    setActiveHistoryId("");
    setActiveHistoryPrevId("");
    // @ts-ignore
    setDiffCounts(null);
    setDiffState("idle");
  }, [
    pageId,
    setActiveHistoryId,
    setActiveHistoryPrevId,
    setDiffCounts,
    setDiffState,
  ]);
}
