import test from "node:test";
import assert from "node:assert/strict";
import { buildInheritanceChain, parseSectionHeader } from "../utils/sectionParser";

test("parseSectionHeader supports plain section", () => {
    const parsed = parseSectionHeader("[E1]");
    assert.deepEqual(parsed, { name: "E1" });
});

test("parseSectionHeader supports bracket inheritance", () => {
    const parsed = parseSectionHeader("[E1]:[BaseInfantry]");
    assert.deepEqual(parsed, { name: "E1", parent: "BaseInfantry" });
});

test("parseSectionHeader supports colon inheritance", () => {
    const parsed = parseSectionHeader("[E1:BaseInfantry]");
    assert.deepEqual(parsed, { name: "E1", parent: "BaseInfantry" });
});

test("parseSectionHeader ignores invalid line", () => {
    const parsed = parseSectionHeader("Primary=M60");
    assert.equal(parsed, undefined);
});

test("buildInheritanceChain returns non-cycle chain", () => {
    const parentMap = new Map<string, string>([
        ["E1", "BaseInfantry"],
        ["BaseInfantry", "Actor"],
    ]);

    const result = buildInheritanceChain("E1", parentMap);
    assert.deepEqual(result, {
        chain: ["E1", "BaseInfantry", "Actor"],
        cycle: false,
    });
});

test("buildInheritanceChain detects cycle", () => {
    const parentMap = new Map<string, string>([
        ["A", "B"],
        ["B", "C"],
        ["C", "A"],
    ]);

    const result = buildInheritanceChain("A", parentMap);
    assert.equal(result.cycle, true);
    assert.deepEqual(result.chain, ["A", "B", "C", "A"]);
});
