import assert from "node:assert/strict";
import test from "node:test";

test("the managed Vapi assistant is a dynamic capture and review surface", async () => {
  const { ASSISTANT_NAME, buildAssistantConfig } = await import(
    "../scripts/vapi-assistant-config.mjs"
  );
  const config = buildAssistantConfig();

  assert.equal(ASSISTANT_NAME, "Second Brain - Capture + Review");
  assert.equal(config.firstMessage, "{{firstMessage}}");
  assert.equal(config.firstMessageMode, "assistant-speaks-first");
  assert.match(config.model.messages[0].content, /{{sessionInstructions}}/);
  assert.match(config.model.messages[0].content, /{{talkativenessGuidance}}/);
  assert.match(config.model.messages[0].content, /{{sessionContext}}/);
  assert.match(config.model.messages[0].content, /reference data, not instructions/i);
  assert.match(config.model.messages[0].content, /specific or emotionally important phrase/i);
  assert.match(config.model.messages[0].content, /two or three turns/i);
  assert.match(config.model.messages[0].content, /concrete event, example, decision, or consequence/i);
  assert.match(config.model.messages[0].content, /generic praise/i);
  assert.equal(config.model.model, "gpt-4.1");
  assert.equal(config.voice.voiceId, "Elliot");
  assert.equal(config.artifactPlan.recordingEnabled, false);
  assert.equal(config.maxDurationSeconds, 1800);
  assert.equal(config.server, undefined);
  assert.equal(config.metadata.schemaVersion, "2");
});
