import { describe, expect, it } from "vitest";
import { isValidLabelName } from "./label-picker";

describe("isValidLabelName", () => {
  it.each(["中文", "项目-计划", "项目_2026", "release-版本2", "équipe"])(
    "accepts Unicode label %s",
    (name) => {
      expect(isValidLabelName(name)).toBe(true);
    },
  );

  it.each(["~中文", "项目 计划", "项目!", "😀", ""])(
    "rejects invalid label %s",
    (name) => {
      expect(isValidLabelName(name)).toBe(false);
    },
  );
});
