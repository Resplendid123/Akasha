import { MantineProvider } from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RecentPageVisits } from "./recent-page-visits";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/time", () => ({
  timeAgo: () => "5 minutes ago",
}));

describe("RecentPageVisits", () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("presents recent pages as keyboard-selectable search actions", () => {
    const now = new Date();
    render(
      <MantineProvider>
        <MemoryRouter>
          <Spotlight.Root forceOpened query="" onQueryChange={() => undefined}>
            <Spotlight.ActionsList>
              <RecentPageVisits
                isLoading={false}
                isError={false}
                showSpace
                items={[
                  {
                    id: "visit-1",
                    pageId: "page-1",
                    lastVisitedAt: now.toISOString(),
                    page: {
                      title: "Launch plan",
                      icon: null,
                      slugId: "abc123",
                    },
                    space: {
                      id: "space-1",
                      name: "Product",
                      slug: "product",
                      logo: null,
                    },
                  },
                ]}
              />
            </Spotlight.ActionsList>
          </Spotlight.Root>
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByText("Recently viewed")).toBeTruthy();
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Launch plan")).toBeTruthy();
    expect(screen.getByText("Product")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Launch plan/ }).getAttribute("href"),
    ).toContain("/s/product/p/");
  });

  it("shows a deliberate empty state instead of a search prompt", () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <Spotlight.Root forceOpened query="" onQueryChange={() => undefined}>
            <Spotlight.ActionsList>
              <RecentPageVisits
                isLoading={false}
                isError={false}
                showSpace
                items={[]}
              />
            </Spotlight.ActionsList>
          </Spotlight.Root>
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByText("No recently viewed pages")).toBeTruthy();
    expect(
      screen.getByText("Pages you open will appear here for 30 days."),
    ).toBeTruthy();
  });
});
