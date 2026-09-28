import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PageEditModeProvider } from "../page-edit-mode-context";
import { PageEditModeControls } from "./page-edit-mode-toggle";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderControls() {
  return render(
    <MantineProvider>
      <PageEditModeProvider>
        <PageEditModeControls size="xs" />
      </PageEditModeProvider>
    </MantineProvider>,
  );
}

describe("PageEditModeControls", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("shows Save only in edit mode and returns to read mode when clicked", () => {
    renderControls();

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves from Ctrl+S while editing", () => {
    renderControls();
    fireEvent.click(screen.getByText("Edit"));

    const event = fireEvent.keyDown(document.documentElement, {
      key: "s",
      ctrlKey: true,
    });

    expect(event).toBe(false);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
