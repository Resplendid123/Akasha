import "@/features/editor/styles/index.css";
import { useRef, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Group,
  Loader,
  Menu,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useHotkeys, useWindowEvent } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronRight,
  IconDots,
  IconMoodSmile,
  IconTrash,
} from "@tabler/icons-react";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAppName } from "@/lib/config.ts";
import EmojiPicker from "@/components/ui/emoji-picker";
import { templateExtensions } from "@/features/editor/extensions/extensions";
import { EditorBubbleMenu } from "@/features/editor/components/bubble-menu/bubble-menu";
import { EditorLinkMenu } from "@/features/editor/components/link/link-menu";
import TableMenu from "@/features/editor/components/table/table-menu.tsx";
import CalloutMenu from "@/features/editor/components/callout/callout-menu.tsx";
import { TransclusionLookupProvider } from "@/features/editor/components/transclusion/transclusion-lookup-context";
import {
  useRemoveTemplate,
  useSaveTemplate,
  useTemplate,
} from "../api/template-hooks";
import {
  PageTemplate,
  TemplateAvailability,
  TemplateDraft,
} from "../api/template.types";
import { TemplateAvailabilityPicker } from "../components/template-availability-picker";
import { TemplateCreator } from "../components/template-creator";
import { isAvailabilityEmpty } from "../lib/availability";
import { SaveState, useAutosave } from "../lib/use-autosave";
import classes from "./template-workbench.module.css";

const AUTOSAVE_DELAY = 1200;
const DIRTY_KINDS = ["meta", "body"] as const;

export default function TemplateWorkbench() {
  const { templateId } = useParams<{ templateId: string }>();
  const { t } = useTranslation();
  const { data: template, isLoading, isError } = useTemplate(templateId);

  if (isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }
  if (isError || !template) {
    return <Notice text={t("Template not found")} />;
  }
  if (!template.canManage) {
    return (
      <Notice text={t("You don't have permission to edit this template")} />
    );
  }

  // key：切换模板时重建编辑器与本地草稿
  return <Workbench key={template.id} template={template} />;
}

function Notice({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className={classes.notice}>
      <Text c="dimmed">{text}</Text>
      <Anchor component={Link} to="/templates" size="sm" mt="xs">
        {t("Back to templates")}
      </Anchor>
    </div>
  );
}

function Workbench({ template }: { template: PageTemplate }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const save = useSaveTemplate(template.id);
  const removeTemplate = useRemoveTemplate();

  const [title, setTitle] = useState(template.title ?? "");
  const [description, setDescription] = useState(template.description ?? "");
  const [icon, setIcon] = useState<string | null>(template.icon);
  const [availability, setAvailability] = useState<TemplateAvailability>({
    allSpaces: template.allSpaces,
    spaceIds: template.spaceIds,
  });
  const latest = useRef({ title, description, icon, availability });
  latest.current = { title, description, icon, availability };
  const editorRef = useRef<Editor | null>(null);

  const { saveState, markDirty, flush, discard, hasUnsaved } = useAutosave(
    DIRTY_KINDS,
    {
      delay: AUTOSAVE_DELAY,
      buildDraft: ({ meta, body }) => {
        const current = latest.current;
        // 标题为空或没选空间时不保存，等用户填好
        if (
          meta &&
          (!current.title.trim() ||
            isAvailabilityEmpty(current.availability, template.otherSpaceCount))
        ) {
          return null;
        }
        const draft: TemplateDraft = {};
        if (meta) {
          draft.title = current.title.trim();
          draft.description = current.description.trim() || null;
          draft.icon = current.icon;
          draft.allSpaces = current.availability.allSpaces;
          draft.spaceIds = current.availability.spaceIds;
        }
        if (body && editorRef.current)
          draft.content = editorRef.current.getJSON();
        return draft;
      },
      save: (draft) => save.mutateAsync(draft),
    },
  );

  const editor = useEditor({
    extensions: templateExtensions,
    content: template.content ?? "",
    immediatelyRender: true,
    editorProps: {
      attributes: { "aria-label": t("Template content") },
    },
    onUpdate: () => markDirty("body"),
  });
  editorRef.current = editor;

  useHotkeys([["mod+s", () => void flush()]], [], true);

  useWindowEvent("beforeunload", (e) => {
    if (hasUnsaved()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t("Delete template"),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            "Delete “{{title}}”? Pages already created from it are not affected.",
            { title: title || t("Untitled") },
          )}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => {
        discard();
        removeTemplate.mutate(template, {
          onSuccess: () => navigate("/templates"),
        });
      },
    });

  return (
    <>
      <Helmet>
        <title>
          {title || t("Untitled template")} - {getAppName()}
        </title>
      </Helmet>

      <header className={classes.toolbar}>
        <nav className={classes.crumbs} aria-label={t("Breadcrumb")}>
          <Anchor component={Link} to="/templates" size="sm" c="dimmed">
            {t("Templates")}
          </Anchor>
          <IconChevronRight
            size={14}
            className={classes.crumbSep}
            aria-hidden
          />
          <Text size="sm" truncate className={classes.crumbCurrent}>
            {icon ? `${icon} ` : ""}
            {title || t("Untitled template")}
          </Text>
        </nav>

        <Group gap="sm" wrap="nowrap">
          <SaveIndicator
            state={saveState}
            blocker={
              !title.trim()
                ? t("Enter a name to save")
                : isAvailabilityEmpty(availability, template.otherSpaceCount)
                  ? t("Select at least one space to save")
                  : null
            }
          />
          <Menu position="bottom-end" shadow="md" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={t("More actions")}
              >
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={confirmDelete}
              >
                {t("Delete template")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </header>

      <div className={classes.canvas}>
        <div className={classes.metaBlock}>
          <div className={classes.iconRow}>
            <EmojiPicker
              onEmojiSelect={(emoji) => {
                setIcon(emoji.native);
                markDirty("meta");
              }}
              removeEmojiAction={() => {
                setIcon(null);
                markDirty("meta");
              }}
              readOnly={false}
              icon={
                icon ? (
                  <span className={classes.iconGlyph}>{icon}</span>
                ) : (
                  <Group gap={4} wrap="nowrap" className={classes.addIcon}>
                    <IconMoodSmile size={16} />
                    <span>{t("Add icon")}</span>
                  </Group>
                )
              }
              actionIconProps={{
                size: icon ? "xl" : "auto",
                variant: "subtle",
                c: "gray",
              }}
            />
          </div>
          <input
            className={classes.titleInput}
            value={title}
            maxLength={200}
            placeholder={t("Untitled template")}
            aria-label={t("Template name")}
            aria-invalid={!title.trim() || undefined}
            onChange={(e) => {
              setTitle(e.currentTarget.value);
              markDirty("meta");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
          />
          <Textarea
            variant="unstyled"
            autosize
            minRows={1}
            maxLength={1000}
            placeholder={t(
              "Add a short description so others know when to use it",
            )}
            aria-label={t("Description")}
            value={description}
            onChange={(e) => {
              setDescription(e.currentTarget.value);
              markDirty("meta");
            }}
            classNames={{ input: classes.descriptionInput }}
          />
          <div className={classes.metaRow}>
            <TemplateCreator template={template} size="sm" />
            <span className={classes.metaDot} aria-hidden>
              ·
            </span>
            <Text size="sm" c="dimmed">
              {t("Available in")}
            </Text>
            <TemplateAvailabilityPicker
              size="xs"
              value={availability}
              otherSpaceCount={template.otherSpaceCount}
              onChange={(next) => {
                setAvailability(next);
                markDirty("meta");
              }}
            />
          </div>
          <div className={classes.hint}>
            {t("Type / to insert blocks. Changes are saved automatically.")}
          </div>
        </div>

        <TransclusionLookupProvider>
          <div className="editor-container" style={{ position: "relative" }}>
            <EditorContent editor={editor} />
            {editor && (
              <>
                <EditorBubbleMenu editor={editor} templateMode />
                <EditorLinkMenu editor={editor} />
                <TableMenu editor={editor} />
                <CalloutMenu editor={editor} />
              </>
            )}
          </div>
        </TransclusionLookupProvider>
        <div style={{ paddingBottom: "20vh" }} />
      </div>
    </>
  );
}

function SaveIndicator({
  state,
  blocker,
}: {
  state: SaveState;
  /** 阻止保存的原因（如缺标题） */
  blocker: string | null;
}) {
  const { t } = useTranslation();
  let content: React.ReactNode = null;

  if (blocker) {
    content = (
      <Text size="xs" c="orange" className={classes.status}>
        {blocker}
      </Text>
    );
  } else if (state === "saving" || state === "pending") {
    content = (
      <Group gap={4} className={classes.status} wrap="nowrap">
        <Loader size={10} color="gray" />
        <Text size="xs" c="dimmed">
          {t("Saving…")}
        </Text>
      </Group>
    );
  } else if (state === "saved") {
    content = (
      <Group gap={4} className={classes.status} wrap="nowrap">
        <IconCheck size={12} color="var(--mantine-color-green-filled)" />
        <Text size="xs" c="dimmed">
          {t("Saved")}
        </Text>
      </Group>
    );
  } else if (state === "error") {
    content = (
      <Tooltip label={t("Press Mod+S to retry")} withArrow>
        <Group gap={4} className={classes.status} wrap="nowrap">
          <IconAlertCircle size={12} color="var(--mantine-color-red-filled)" />
          <Text size="xs" c="red">
            {t("Save failed")}
          </Text>
        </Group>
      </Tooltip>
    );
  }

  return (
    <div aria-live="polite" className={classes.statusSlot}>
      {content}
    </div>
  );
}
