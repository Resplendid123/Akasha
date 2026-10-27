import { ReactNode } from "react";
import { Text } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { PageTemplate, TemplateOutlineItem } from "../api/template.types";
import classes from "./template-card.module.css";

// 按文本长度画骨架条，空文本给一个默认宽度
const barWidth = (text: string, base: number) =>
  `${Math.min(88, Math.max(22, text ? text.length * 4 + 18 : base))}%`;

function OutlineLine({ item }: { item: TemplateOutlineItem }) {
  switch (item.kind) {
    case "heading":
      return (
        <div
          className={classes.lineHeading}
          data-level={Math.min(item.level, 3)}
        >
          {item.text || (
            <span className={classes.bar} style={{ width: "40%" }} />
          )}
        </div>
      );
    case "bullet":
    case "task":
      return (
        <div className={classes.lineItem}>
          <span
            className={item.kind === "task" ? classes.checkbox : classes.dot}
          />
          <span
            className={classes.bar}
            style={{ width: barWidth(item.text, 45) }}
          />
        </div>
      );
    case "block":
      return <div className={classes.blockStub} />;
    default:
      return (
        <span
          className={classes.bar}
          style={{ width: barWidth(item.text, 70) }}
        />
      );
  }
}

/** 纸张式缩略图：用正文结构概要画出页面骨架。 */
export function TemplateThumbnail({
  template,
  compact = false,
}: {
  template: Pick<PageTemplate, "icon" | "outline">;
  compact?: boolean;
}) {
  const outline = template.outline ?? [];
  return (
    <div
      className={classes.thumb}
      data-compact={compact || undefined}
      aria-hidden
    >
      <div className={classes.paper}>
        <span className={classes.paperIcon}>
          {template.icon || (
            <IconFileText size={compact ? 16 : 20} stroke={1.5} />
          )}
        </span>
        {outline.length === 0 ? (
          <>
            <span className={classes.bar} style={{ width: "60%" }} />
            <span className={classes.bar} style={{ width: "80%" }} />
            <span className={classes.bar} style={{ width: "40%" }} />
          </>
        ) : (
          outline.map((item, i) => <OutlineLine key={i} item={item} />)
        )}
      </div>
    </div>
  );
}

interface TemplateCardProps {
  template: PageTemplate;
  scopeLabel: string;
  onClick: () => void;
  /** 鼠标悬停时右上角显示的操作 */
  actions?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  ariaLabel?: string;
}

export function TemplateCard({
  template,
  scopeLabel,
  onClick,
  actions,
  footer,
  compact,
  ariaLabel,
}: TemplateCardProps) {
  const { t } = useTranslation();
  return (
    <div className={classes.card} data-compact={compact || undefined}>
      <button
        type="button"
        className={classes.hit}
        onClick={onClick}
        aria-label={ariaLabel ?? template.title}
      >
        <TemplateThumbnail template={template} compact={compact} />
        <div className={classes.meta}>
          <Text size="sm" fw={600} truncate>
            {template.title || t("Untitled")}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            lineClamp={compact ? 1 : 2}
            className={classes.desc}
          >
            {template.description ||
              (compact ? scopeLabel : t("No description"))}
          </Text>
          {footer ??
            (!compact && template.description && (
              <Text size="xs" c="dimmed" mt={6} className={classes.scope}>
                {scopeLabel}
              </Text>
            ))}
        </div>
      </button>
      {actions && <div className={classes.actions}>{actions}</div>}
    </div>
  );
}
