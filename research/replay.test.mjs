import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stream, replay, readDataset } from "./replay.mts";

test("replay is deterministic and teacher baseline accounts for every call", () => {
  const frames = stream(7, "sudden");
  assert.deepEqual(stream(7, "sudden"), frames);
  assert.deepEqual(replay(frames, "adaptive_audits", 7), replay(frames, "adaptive_audits", 7));
  const baseline = replay(frames, "teacher_only", 7);
  assert.equal(baseline.costVsTeacher, 1); assert.equal(baseline.teacherCalls, frames.length);
  assert.equal(baseline.accuracy, baseline.teacherAccuracy);
});
test("changing scorer truth cannot alter routing, spending or lifecycle", () => {
  const frames = stream(2, "sudden");
  const changed = frames.map(f => ({ ...f, truth: "never-output" }));
  const original = replay(frames, "adaptive_audits", 2), relabeled = replay(changed, "adaptive_audits", 2);
  for (const key of ["teacherCalls", "fastCalls", "auditCalls", "costUnits", "promotions", "demotions", "reflexShare", "firstPostShiftDemotionDelay"])
    assert.equal(original[key], relabeled[key]);
  assert.equal(relabeled.accuracy, 0);
});
test("replay audits obey the cap and all policies report finite costs", () => {
  const frames = stream(3, "stable");
  for (const p of ["teacher_only", "fast_only", "confidence_only", "no_audits", "fixed_audits", "adaptive_audits"]) {
    const r = replay(frames, p, 3);
    assert.ok(Number.isFinite(r.costUnits)); assert.ok(r.accuracy >= 0 && r.accuracy <= 1);
    assert.ok(r.auditCalls <= Math.floor(frames.length * r.reflexShare * 0.12));
  }
});
test("recorded dataset validation rejects invalid context, order and missing accounting", () => {
  const dir = mkdtempSync(join(tmpdir(), "reflexes-test-"));
  const path = join(dir, "data.json");
  try {
    const value = { schemaVersion: 1, kind: "recorded", costUnit: "USD", node: "support.intent", revision: "models-prompt-v1", records: stream(1, "stable", 2) };
    writeFileSync(path, JSON.stringify(value)); assert.equal(readDataset(path).records.length, 2);
    const baseline = replay(readDataset(path).records, "teacher_only", 1, 0.12, null);
    assert.equal(baseline.postShiftAccuracy, null);
    value.records[1].seq = 0;
    writeFileSync(path, JSON.stringify(value)); assert.throws(() => readDataset(path), /frame/);
    value.records[1].seq = 1; delete value.records[0].teacherCost;
    writeFileSync(path, JSON.stringify(value)); assert.throws(() => readDataset(path), /frame/);
  } finally { rmSync(dir, { recursive: true }); }
});
