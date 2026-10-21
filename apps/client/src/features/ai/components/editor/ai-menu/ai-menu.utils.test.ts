import { describe, expect, it } from "vitest";
import { isFocusWithinAiMenu } from "./ai-menu.utils";

describe("isFocusWithinAiMenu", () => {
  it("keeps the AI menu open when its prompt receives focus", () => {
    const container = document.createElement("div");
    const input = document.createElement("input");
    container.appendChild(input);

    expect(isFocusWithinAiMenu(input, container)).toBe(true);
  });

  it("allows the AI menu to close when focus moves elsewhere", () => {
    const container = document.createElement("div");
    const outsideButton = document.createElement("button");

    expect(isFocusWithinAiMenu(outsideButton, container)).toBe(false);
    expect(isFocusWithinAiMenu(null, container)).toBe(false);
  });
});
