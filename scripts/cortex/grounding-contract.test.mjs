import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";

const BUS_PATH = resolve(".data/cortex-state-bus.json");

test("state-bus fail-closes missing provenance as ungrounded metadata", async () => {
  const hadBus = existsSync(BUS_PATH);
  const previous = hadBus ? readFileSync(BUS_PATH, "utf-8") : null;
  const bus = await import("./state-bus.mjs");

  try {
    bus.pushEvent("grounding-test", "internal_state", { value: 1 });
    const last = bus.recentEvents(1)[0];
    assert.equal(last.data.grounding_status, "ungrounded");
    assert.equal(last.data.confidence_basis, "none");
    assert.deepEqual(last.data.provenance_chain, []);
    assert.ok(last.data.observed_at);
    assert.ok(last.data.expires_at);
  } finally {
    if (hadBus) writeFileSync(BUS_PATH, previous);
    else if (existsSync(BUS_PATH)) unlinkSync(BUS_PATH);
  }
});

test("free-energy publishes blind unknown state when samples are zero", async () => {
  const freeEnergy = await import("./free-energy.mjs");
  const events = [];
  const fakeBus = {
    subscribe() {},
    broadcast(event) { events.push(event); },
  };

  freeEnergy._resetState();
  freeEnergy.register(fakeBus);
  freeEnergy._flush();
  freeEnergy._resetState();

  assert.equal(events.at(-1).data.samples, 0);
  assert.equal(events.at(-1).data.status, "unknown");
  assert.equal(events.at(-1).data.regime, "blind");
  assert.equal(events.at(-1).data.grounding_status, "blind");
  assert.equal(events.at(-1).data.value, null);
});

test("affect-state suppresses strong satisfaction without fresh grounded outcome", async () => {
  const affect = await import("./affect-state.mjs");
  const handlers = new Map();
  const broadcasts = [];
  const fakeBus = {
    subscribe(type, handler) { handlers.set(type, handler); },
    broadcast(event) { broadcasts.push(event); },
  };

  affect._resetState();
  affect.register(fakeBus);
  const botResult = handlers.get("bot_result");
  for (let i = 0; i < 12; i += 1) {
    botResult({ at: new Date().toISOString(), data: { success: true, grounding_status: "ungrounded" } });
  }
  affect._flush();
  affect._resetState();

  const reported = broadcasts.at(-1).data;
  assert.equal(reported.grounding_status, "ungrounded");
  assert.equal(reported.confidence_basis, "no_fresh_positive_outcome");
  assert.ok(reported.satisfaction < 0.9);
  assert.notEqual(reported.intensity, "strong");
});

test("affect-state failed outcomes lower satisfaction reproducibly", async () => {
  const affect = await import("./affect-state.mjs");
  const handlers = new Map();
  const fakeBus = {
    subscribe(type, handler) { handlers.set(type, handler); },
    broadcast() {},
  };

  affect._resetState();
  affect.register(fakeBus);
  const start = affect.getState().satisfaction;
  const handsResult = handlers.get("hands_result");
  for (let i = 0; i < 5; i += 1) {
    handsResult({ at: new Date().toISOString(), data: { success: false, grounding_status: "grounded" } });
  }
  const end = affect.getState().satisfaction;
  affect._resetState();

  assert.ok(end <= start - 0.2);
});

test("working-memory downgrades ungrounded strong affect instead of admitting it as strong", async () => {
  const workingMemory = await import("./working-memory.mjs");
  const handlers = new Map();
  const fakeBus = {
    subscribe(type, handler) { handlers.set(type, handler); },
    broadcast() {},
  };

  workingMemory._resetState();
  workingMemory.register(fakeBus);
  handlers.get("affect_state")({
    at: new Date().toISOString(),
    data: {
      satisfaction: 0.975,
      dominant: "satisfaction",
      intensity: "strong",
      grounding_status: "ungrounded",
      confidence_basis: "none",
      provenance_chain: [],
    },
  });
  const slots = workingMemory.getCurrentSlots();
  workingMemory._resetState();

  assert.equal(slots.length, 1);
  assert.equal(slots[0].kind, "affect_ungrounded");
  assert.equal(slots[0].raw_salience, 3);
  assert.equal(slots[0].grounding_status, "ungrounded");
});
