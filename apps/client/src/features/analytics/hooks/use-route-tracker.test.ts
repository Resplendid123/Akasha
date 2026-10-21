import { describe, expect, it } from "vitest";
import { resolveTrackedRoute } from "./use-route-tracker";

describe("resolveTrackedRoute", () => {
  it("maps top-level routes to route names", () => {
    expect(resolveTrackedRoute("/home")).toEqual({ route: "home" });
    expect(resolveTrackedRoute("/ai/chat/abc")).toEqual({ route: "ai" });
    expect(resolveTrackedRoute("/settings/account/profile")).toEqual({
      route: "settings",
    });
  });

  it("extracts space and page slugs from document routes", () => {
    expect(resolveTrackedRoute("/s/eng/p/onboarding-guide-V0FlLfLNli")).toEqual(
      { route: "space.page", spaceSlug: "eng", pageSlugId: "V0FlLfLNli" },
    );
    expect(resolveTrackedRoute("/s/eng")).toEqual({
      route: "space.home",
      spaceSlug: "eng",
    });
    expect(resolveTrackedRoute("/s/eng/graph")).toEqual({
      route: "graph",
      spaceSlug: "eng",
    });
  });

  it("falls back to other for unknown paths", () => {
    expect(resolveTrackedRoute("/somewhere/else")).toEqual({ route: "other" });
  });
});
