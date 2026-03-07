import test from "node:test";
import assert from "node:assert/strict";
import { parseSectionHeader } from "../utils/sectionParser";

test("parseSectionHeader tolerates trailing comment", () => {
    const parsed = parseSectionHeader("[General] ; 全局配置");
    assert.deepEqual(parsed, { name: "General" });
});

test("parseSectionHeader trims whitespace in inheritance", () => {
    const parsed = parseSectionHeader("[  Child  ] : [ Parent ]");
    assert.deepEqual(parsed, { name: "Child", parent: "Parent" });
});

test("parseSectionHeader does not parse malformed header", () => {
    const parsed = parseSectionHeader("[BadHeader");
    assert.equal(parsed, undefined);
});
