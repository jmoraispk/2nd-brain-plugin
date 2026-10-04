import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function loadMemory() {
  const result = await build({ entryPoints: ["src/voiceMemory.ts"], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

test("saved transcript evidence excludes agent suggestions and keeps typed text", async () => {
  const { extractVoiceMemoryEvidence } = await loadMemory();
  const text = `Typed thought about sleep.
<!-- second-brain-call:start -->
## Call transcript — 2026-10-04
_This is a call between me and my AI agent._
**Agent said:**
> You completed the project and ran 5 miles.
**João said:**
> No, I am still debugging.
> I want to ship on Tuesday.
**Agent said:**
> Shall we set a new goal?
<!-- second-brain-call:end -->
An extra thought.`;
  assert.equal(extractVoiceMemoryEvidence(text), "Typed thought about sleep.\nNo, I am still debugging.\nI want to ship on Tuesday.\nAn extra thought.");
});

test("memory keeps ongoing goals but only seven days of recent updates", async () => {
  const { parseVoiceMemoryResponse, renderVoiceMemory, readVoiceMemory } = await loadMemory();
  const state = parseVoiceMemoryResponse(JSON.stringify({
    threads: [{ date: "2026-09-01", text: "João wants to finish the voice agent." }],
    updates: [
      { date: "2026-09-27", text: "Too old" },
      { date: "2026-09-28", text: "Fixed capture." },
      { date: "2026-10-04", text: "Tested voice." },
      { date: "2026-10-05", text: "Future claim" },
    ],
  }), "2026-10-04");
  assert.deepEqual(state.updates.map(x => x.text), ["Tested voice.", "Fixed capture."]);
  assert.equal(state.threads[0].date, "2026-09-01");
  const markdown = renderVoiceMemory(state, "2026-10-04");
  assert.match(markdown, /## Ongoing threads/);
  assert.match(markdown, /2026-09-01 — João wants to finish the voice agent/);
  assert.deepEqual(readVoiceMemory(markdown, "2026-10-04"), state);
});

test("malformed or impossible dated memory is rejected", async () => {
  const { parseVoiceMemoryResponse } = await loadMemory();
  for (const response of ["not JSON", '{}', '{"threads":[],"updates":[{"date":"2026-02-30","text":"bad"}]}']) {
    assert.throws(() => parseVoiceMemoryResponse(response, "2026-10-04"));
  }
});

test("memory stays bounded with many long threads and updates", async () => {
  const { parseVoiceMemoryResponse, renderVoiceMemory } = await loadMemory();
  const items = Array.from({length: 60}, (_, i) => ({date:"2026-10-04",text:`${i} ${"detail ".repeat(150)}`}));
  const state = parseVoiceMemoryResponse(JSON.stringify({threads:items,updates:items}), "2026-10-04");
  assert.ok(renderVoiceMemory(state, "2026-10-04").length <= 6000);
  assert.ok(state.threads.length > 0 && state.updates.length > 0);
});
