import {
  usePageHistoryDiffQuery,
  usePageHistoryQuery,
} from "@/features/page-history/queries/page-history-query";
import { HistoryEditor } from "@/features/page-history/components/history-editor";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
} from "@/features/page-history/atoms/history-atoms";

function HistoryView() {
  const { t } = useTranslation();
  const historyId = useAtomValue(activeHistoryIdAtom);
  const prevHistoryId = useAtomValue(activeHistoryPrevIdAtom);

  const {
    data,
    isLoading: isLoadingCurrent,
    isError: isErrorCurrent,
  } = usePageHistoryQuery(historyId);
  const {
    data: diffData,
    isLoading: isLoadingDiff,
    isError: isErrorDiff,
  } = usePageHistoryDiffQuery(historyId, !!prevHistoryId);
  const shouldLoadPrevious =
    isErrorDiff ||
    diffData?.status === "failed" ||
    (diffData?.status === "ready" && diffData.fromHistoryId !== prevHistoryId);
  const {
    data: prevData,
    isLoading: isLoadingPrev,
    isError: isErrorPrev,
  } = usePageHistoryQuery(prevHistoryId, shouldLoadPrevious);

  if (isLoadingCurrent) {
    return <></>;
  }

  if (isErrorCurrent || !data) {
    return <div>{t("Error fetching page data.")}</div>;
  }

  return (
    <div>
      <HistoryEditor
        content={data.content}
        title={data.title}
        previousContent={!isErrorPrev ? prevData?.content : undefined}
        prevHistoryId={prevHistoryId}
        persistedDiff={diffData}
        isDiffLoading={isLoadingDiff}
        isPreviousLoading={isLoadingPrev}
        isPreviousError={isErrorPrev}
      />
    </div>
  );
}

export default HistoryView;
