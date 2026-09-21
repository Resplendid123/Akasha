import { describe, expect, it } from "vitest";
import { getVisibleCommandItems } from "./command-items";

describe("getVisibleCommandItems", () => {
  it("does not expose document-writing result actions in read mode", () => {
    const itemIds = getVisibleCommandItems("result", "", true).map(
      (item) => item.id,
    );

    expect(itemIds).not.toContain("result-replace");
    expect(itemIds).not.toContain("result-insert-below");
    expect(itemIds).toEqual([
      "result-copy",
      "result-discard",
      "result-try-again",
    ]);
  });

  it("keeps document-writing result actions in edit mode", () => {
    const itemIds = getVisibleCommandItems("result", "", false).map(
      (item) => item.id,
    );

    expect(itemIds).toContain("result-replace");
    expect(itemIds).toContain("result-insert-below");
  });
});
