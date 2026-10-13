import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseAll,
  expandAll,
  groupPresets,
  initialOpenIds,
  rangeError,
  toggleOpen,
} from "./src/pages/syntheticList.ts";

describe("groupPresets", () => {
  it("keeps the fixed group order and hides an empty group and an unknown category", () => {
    const groups = groupPresets([
      { slug: "cod", category: "games" },
      { slug: "voice", category: "voice" },
      { slug: "desk", category: "enterprise" },
      { slug: "other", category: "satellite" },
      { slug: "bare", category: null },
    ]);
    assert.deepEqual(groups.map((group) => group.category), ["voice", "enterprise", "games"]);
    assert.deepEqual(groups.map((group) => group.name), ["Voice", "Enterprise apps", "Games"]);
    assert.equal(groups.some((group) => group.category === "video"), false);
    assert.equal(groups.some((group) => group.items.some((item) => item.slug === "other")), false);
  });
});

describe("open rows", () => {
  const ids = ["a", "b", "c"];

  it("opens the first preset only before the session has a saved choice", () => {
    assert.deepEqual(initialOpenIds(ids, null), ["a"]);
    assert.deepEqual(initialOpenIds(ids, []), []);
    assert.deepEqual(initialOpenIds(ids, ["c", "missing"]), ["c"]);
  });

  it("toggles one row without closing the others, and expand all opens every id", () => {
    const opened = toggleOpen(["a"], "b");
    assert.deepEqual(opened, ["a", "b"]);
    assert.deepEqual(toggleOpen(opened, "a"), ["b"]);
    assert.deepEqual(expandAll(ids), ids);
    assert.deepEqual(collapseAll(), []);
  });
});

describe("rangeError", () => {
  it("accepts the inclusive limits and rejects values outside them", () => {
    assert.equal(rangeError(1, 1, 300), "");
    assert.equal(rangeError(300, 1, 300), "");
    assert.match(rangeError(0, 1, 300), /1 to 300/);
    assert.match(rangeError(Number.NaN, 1, 300), /1 to 300/);
  });
});
