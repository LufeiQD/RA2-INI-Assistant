import test from "node:test";
import assert from "node:assert/strict";
import {
    isLikelySectionReference,
    splitIniValueTokens,
    stripIniInlineComment,
    uniqueValues,
} from "../utils/indexParsing";

test("stripIniInlineComment removes semicolon comment", () => {
    assert.equal(stripIniInlineComment("A,B ; note"), "A,B");
});

test("stripIniInlineComment removes hash comment", () => {
    assert.equal(stripIniInlineComment("Value # note"), "Value");
});

test("splitIniValueTokens splits and trims csv", () => {
    assert.deepEqual(splitIniValueTokens("A, B ,C"), ["A", "B", "C"]);
});

test("isLikelySectionReference filters numeric values", () => {
    assert.equal(isLikelySectionReference("123"), false);
    assert.equal(isLikelySectionReference("E1"), true);
});

test("isLikelySectionReference filters space-containing values", () => {
    assert.equal(isLikelySectionReference("Power Plant"), false);
});

test("uniqueValues preserves first-seen order", () => {
    assert.deepEqual(uniqueValues(["A", "B", "A", "C", "B"]), ["A", "B", "C"]);
});
