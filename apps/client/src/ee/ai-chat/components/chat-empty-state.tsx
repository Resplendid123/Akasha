import {
  IconSparkles,
  IconSearch,
  IconFileText,
  IconArrowsSplit2,
  IconRoute,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import ChatInput from "./chat-input";
import type { ChatAttachment, PageMention } from "../types/ai-chat.types";
import classes from "../styles/ai-chat.module.css";

type Suggestion = {
  icon: React.ReactNode;
  // i18n key. Doubles as the prompt sent to the model, so it must be
  // translated: an English prompt pins the answer to English.
  label: string;
};

const SUGGESTIONS: Suggestion[] = [
  {
    icon: <IconSearch size={16} />,
    label: "Find answers across the knowledge base",
  },
  {
    icon: <IconArrowsSplit2 size={16} />,
    label: "Compare concepts across pages",
  },
  {
    icon: <IconFileText size={16} />,
    label: "Summarize a knowledge topic",
  },
  {
    icon: <IconRoute size={16} />,
    label: "Explain a process or procedure",
  },
];

type Props = {
  isStreaming: boolean;
  onSend: (
    content: string,
    mentions: PageMention[],
    attachments: ChatAttachment[],
  ) => void;
  onStop: () => void;
};

export default function ChatEmptyState({ isStreaming, onSend, onStop }: Props) {
  const { t } = useTranslation();

  const handleSuggestionClick = (label: string) => {
    onSend(t(label), [], []);
  };

  return (
    <div className={classes.emptyState}>
      <IconSparkles size={48} stroke={1.5} className={classes.emptyStateIcon} />
      <div className={classes.emptyStateBrand}>{t("Akasha Knowledge")}</div>
      <h1 className={classes.emptyStateTitle}>
        {t("What would you like to know?")}
      </h1>

      <div className={classes.emptyStateInput}>
        <ChatInput
          isStreaming={isStreaming}
          onSend={onSend}
          onStop={onStop}
          placeholder={t("Ask the knowledge base... Use @ to mention pages")}
          autofocus
        />
      </div>

      <div className={classes.suggestionsSection}>
        <h2 className={classes.suggestionsLabel}>{t("Get started")}</h2>
        <div className={classes.suggestionsGrid}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              className={classes.suggestionCard}
              onClick={() => handleSuggestionClick(s.label)}
            >
              <span className={classes.suggestionIcon}>{s.icon}</span>
              <span className={classes.suggestionText}>{t(s.label)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
