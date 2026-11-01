const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SCHEMA_VERSION,
  createInitialState,
  loadStateFromStorage,
  saveStateToStorage,
  addDefaultPayment,
  storeDefaultPayment,
  updatePayment,
  setCustomParticipants,
  resetPaymentParticipants,
  normalizeStateData,
  calculateSettlement,
  removeMember,
} = require("../static/settlement-core.js");

function makeState(names, payments, targets = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    names,
    payments: payments.map((payment, index) => ({
      id: payment.id || `p${index + 1}`,
      payer: payment.payer,
      amount: payment.amount,
      place: payment.place || "",
      participantMode: payment.participantMode || "default",
      participants: payment.participantMode === "custom" ? payment.participants : null,
    })),
    targets: Object.fromEntries(names.map((name) => [name, targets[name] !== false])),
    lastPayer: names[0] || null,
  };
}

function legacyResult(state) {
  const targets = state.names.filter((name) => state.targets[name] !== false);
  if (targets.length === 0 || state.payments.length === 0) {
    return { total: 0, perHead: 0, transfers: [] };
  }
  const total = state.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const perHead = Math.floor(total / targets.length);
  const remainder = total % targets.length;
  const paid = Object.fromEntries(state.names.map((name) => [name, 0]));
  const owed = Object.fromEntries(state.names.map((name) => [name, 0]));
  state.payments.forEach((payment) => { paid[payment.payer] += payment.amount; });
  targets.forEach((name, index) => { owed[name] = perHead + (index < remainder ? 1 : 0); });
  const senders = [];
  const receivers = [];
  state.names.forEach((name) => {
    const balance = owed[name] - paid[name];
    if (balance > 0) senders.push([name, balance]);
    if (balance < 0) receivers.push([name, -balance]);
  });
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < senders.length && j < receivers.length) {
    const amount = Math.min(senders[i][1], receivers[j][1]);
    transfers.push([senders[i][0], receivers[j][0], amount]);
    senders[i][1] -= amount;
    receivers[j][1] -= amount;
    if (senders[i][1] === 0) i += 1;
    if (receivers[j][1] === 0) j += 1;
  }
  return { total, perHead, transfers };
}

function assertLegacyCompatible(state) {
  const legacy = legacyResult(state);
  const current = calculateSettlement(state);
  assert.deepEqual(
    { total: current.total, perHead: current.perHead, transfers: current.transfers },
    legacy,
  );
}

function assertAccounting(result, names) {
  assert.equal(Object.values(result.paid).reduce((sum, value) => sum + value, 0), result.total);
  assert.equal(Object.values(result.owed).reduce((sum, value) => sum + value, 0), result.total);
  assert.equal(Object.values(result.balances).reduce((sum, value) => sum + value, 0), 0);

  const settled = { ...result.balances };
  result.transfers.forEach(([sender, receiver, amount]) => {
    settled[sender] -= amount;
    settled[receiver] += amount;
  });
  names.forEach((name) => assert.equal(settled[name], 0));
}

test("v2 초기 상태를 만든다", () => {
  assert.deepEqual(createInitialState(), {
    schemaVersion: 2,
    names: [],
    payments: [],
    targets: {},
    lastPayer: null,
  });
});

test("새 멤버를 추가한 v2 상태를 정상적으로 유지한다", () => {
  const state = createInitialState();
  state.names.push("A");
  state.targets.A = true;
  state.lastPayer = "A";
  const normalized = normalizeStateData(state);
  assert.equal(normalized.issues.length, 0);
  assert.deepEqual(normalized.state.names, ["A"]);
  assert.equal(normalized.state.targets.A, true);
  assert.equal(normalized.state.lastPayer, "A");
});

test("사용처 없이 기본 결제를 저장한다", () => {
  const result = addDefaultPayment(createInitialState(), { payer: "A", amount: 1000, place: "" }, { idFactory: () => "p1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.payment, {
    id: "p1",
    payer: "A",
    amount: 1000,
    place: "",
    participantMode: "default",
    participants: null,
  });
  assert.deepEqual(result.state.names, ["A"]);
  assert.equal(result.state.targets.A, true);
});

test("사용처를 저장하고 재로드한다", () => {
  const added = addDefaultPayment(createInitialState(), { payer: "A", amount: 1000, place: "  카페  " }, { idFactory: () => "p1" });
  const reloaded = normalizeStateData(JSON.parse(JSON.stringify(added.state)));
  assert.equal(reloaded.state.payments[0].place, "카페");
});

test("빈 v2 초기 상태에서 첫 결제자를 자동 등록하고 결제를 저장한다", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  };
  const result = storeDefaultPayment(
    storage,
    "v2",
    createInitialState(),
    { payer: "첫결제자", amount: 12000, place: "" },
    { idFactory: () => "first-payment" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.names, ["첫결제자"]);
  assert.equal(result.state.targets["첫결제자"], true);
  assert.equal(result.state.payments[0].id, "first-payment");
  assert.equal(result.state.lastPayer, "첫결제자");
  const reloaded = loadStateFromStorage(storage, "v2");
  assert.deepEqual(reloaded.state, result.state);
});

test("기존 멤버의 추가 결제를 저장한다", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = makeState(["A", "B"], [{ id: "p1", payer: "A", amount: 1000 }]);
  const result = storeDefaultPayment(
    storage,
    "v2",
    state,
    { payer: "B", amount: 2000, place: "카페" },
    { idFactory: () => "p2" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.state.payments.length, 2);
  assert.deepEqual(result.state.payments[1], {
    id: "p2",
    payer: "B",
    amount: 2000,
    place: "카페",
    participantMode: "default",
    participants: null,
  });
});

test("기존 명단에 없는 신규 결제자를 자동 등록해 추가 결제를 저장한다", () => {
  const storage = { getItem: () => null, setItem() {} };
  const state = makeState(["A"], [{ id: "p1", payer: "A", amount: 1000 }]);
  const result = storeDefaultPayment(
    storage,
    "v2",
    state,
    { payer: "B", amount: 3000, place: "" },
    { idFactory: () => "p2" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.names, ["A", "B"]);
  assert.equal(result.state.targets.B, true);
  assert.equal(result.state.payments[1].payer, "B");
});

test("기존 멤버가 모두 명시적으로 제외된 상태에서는 신규 결제자도 저장하지 않는다", () => {
  let writes = 0;
  const storage = { getItem: () => null, setItem: () => { writes += 1; } };
  const state = makeState(["A", "B"], [], { A: false, B: false });
  const before = JSON.stringify(state);
  const result = storeDefaultPayment(
    storage,
    "v2",
    state,
    { payer: "C", amount: 3000, place: "" },
    { idFactory: () => "p1" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-default-participants");
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(state), before);
});

test("결제 저장 실패 시 상태와 입력 후보 데이터를 보존한다", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const state = createInitialState();
  const values = { payer: "A", amount: 5000, place: "식당" };
  const before = JSON.stringify(state);
  const result = storeDefaultPayment(storage, "v2", state, values, { idFactory: () => "p1" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "storage-write-failed");
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(values, { payer: "A", amount: 5000, place: "식당" });
});

test("결제자·금액·사용처를 ID로 수정하고 다른 결제를 보존한다", () => {
  const state = makeState(["A", "B"], [
    { id: "old", payer: "A", amount: 1000 },
    { id: "other", payer: "B", amount: 2000, place: "식당" },
  ]);
  const result = updatePayment(state, "old", { payer: "C", amount: 3333, place: " 카페 " });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.names, ["A", "B", "C"]);
  assert.deepEqual(result.state.payments[0], {
    id: "old",
    payer: "C",
    amount: 3333,
    place: "카페",
    participantMode: "default",
    participants: null,
  });
  assert.deepEqual(result.state.payments[1], state.payments[1]);
  assert.equal(result.state.lastPayer, state.lastPayer);
});

test("수정 결과를 적용하지 않으면 원본은 변경되지 않는다", () => {
  const state = makeState(["A"], [{ id: "p1", payer: "A", amount: 1000, place: "원본" }]);
  const before = JSON.stringify(state);
  updatePayment(state, "p1", { payer: "A", amount: 2000, place: "변경" });
  assert.equal(JSON.stringify(state), before);
});

test("custom 결제의 일반 필드 수정은 부담자 정보를 보존한다", () => {
  const state = makeState(["A", "B", "C"], [
    { id: "p1", payer: "A", amount: 1000, participantMode: "custom", participants: ["B", "C"] },
  ]);
  const result = updatePayment(state, "p1", { payer: "B", amount: 5000, place: "저녁" });
  assert.equal(result.state.payments[0].participantMode, "custom");
  assert.deepEqual(result.state.payments[0].participants, ["B", "C"]);
});

test("표시 순서와 무관하게 고유 ID 결제만 수정한다", () => {
  const state = makeState(["A"], Array.from({ length: 6 }, (_, index) => ({
    id: `p${index + 1}`,
    payer: "A",
    amount: index + 1,
  })));
  const result = updatePayment(state, "p2", { payer: "A", amount: 999, place: "수정" });
  assert.deepEqual(result.state.payments.map((payment) => payment.amount), [1, 999, 3, 4, 5, 6]);
});

test("default 결제를 custom으로 전환하고 멤버 순서로 저장한다", () => {
  const state = makeState(["A", "B", "C"], [{ id: "p1", payer: "A", amount: 1000 }]);
  const result = setCustomParticipants(state, "p1", ["C", "A"]);
  assert.equal(result.ok, true);
  assert.equal(result.state.payments[0].participantMode, "custom");
  assert.deepEqual(result.state.payments[0].participants, ["A", "C"]);
});

test("custom 결제를 기본 정산으로 되돌린다", () => {
  const state = makeState(["A", "B"], [
    { id: "p1", payer: "A", amount: 1000, participantMode: "custom", participants: ["B"] },
  ]);
  const result = resetPaymentParticipants(state, "p1");
  assert.equal(result.state.payments[0].participantMode, "default");
  assert.equal(result.state.payments[0].participants, null);
});

test("custom 설정 결과를 적용하지 않으면 원본은 변경되지 않는다", () => {
  const state = makeState(["A", "B"], [{ id: "p1", payer: "A", amount: 1000 }]);
  const before = JSON.stringify(state);
  setCustomParticipants(state, "p1", ["B"]);
  assert.equal(JSON.stringify(state), before);
});

test("custom 대상자 0명 저장을 차단한다", () => {
  const state = makeState(["A", "B"], [{ id: "p1", payer: "A", amount: 1000 }]);
  const result = setCustomParticipants(state, "p1", []);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-custom-participants");
  assert.equal(state.payments[0].participantMode, "default");
});

test("일반 정산 2명 결과가 기존 계산과 일치한다", () => {
  assertLegacyCompatible(makeState(["A", "B"], [
    { payer: "A", amount: 10000 },
    { payer: "B", amount: 3000 },
  ]));
});

test("일반 정산 3명과 1원 잔여금 결과가 기존 계산과 일치한다", () => {
  assertLegacyCompatible(makeState(["A", "B", "C"], [
    { payer: "C", amount: 10 },
    { payer: "A", amount: 1 },
  ]));
});

test("다수 인원과 여러 기본 결제를 합산한 결과가 기존 계산과 일치한다", () => {
  assertLegacyCompatible(makeState(["A", "B", "C", "D", "E"], [
    { payer: "A", amount: 12001 },
    { payer: "D", amount: 9876 },
    { payer: "E", amount: 4321 },
  ]));
});

test("일부 대상 제외 및 제외된 사람의 대신 결제가 기존 결과와 일치한다", () => {
  assertLegacyCompatible(makeState(["A", "B", "C"], [
    { payer: "C", amount: 10001 },
    { payer: "A", amount: 5000 },
  ], { C: false }));
});

test("특정 결제만 예외 부담자를 사용한다", () => {
  const state = makeState(["A", "B", "C"], [
    { payer: "A", amount: 30000 },
    { payer: "B", amount: 10000, participantMode: "custom", participants: ["A", "B"] },
  ]);
  const result = calculateSettlement(state);
  assert.deepEqual(result.defaultOwed, { A: 10000, B: 10000, C: 10000 });
  assert.deepEqual(result.customOwed, { A: 5000, B: 5000, C: 0 });
  assert.deepEqual(result.owed, { A: 15000, B: 15000, C: 10000 });
  assert.deepEqual(result.transfers, [["B", "A", 5000], ["C", "A", 10000]]);
  assertAccounting(result, state.names);
});

test("여러 예외 결제와 기본 결제를 함께 계산한다", () => {
  const state = makeState(["A", "B", "C", "D"], [
    { payer: "A", amount: 8000 },
    { payer: "B", amount: 5001, participantMode: "custom", participants: ["B", "D"] },
    { payer: "D", amount: 3002, participantMode: "custom", participants: ["A", "C", "D"] },
  ]);
  const result = calculateSettlement(state);
  assert.equal(result.paymentDetails.length, 3);
  assertAccounting(result, state.names);
});

test("결제자가 부담자에서 제외될 수 있다", () => {
  const state = makeState(["A", "B", "C"], [
    { payer: "A", amount: 9000, participantMode: "custom", participants: ["B", "C"] },
  ]);
  const result = calculateSettlement(state);
  assert.deepEqual(result.owed, { A: 0, B: 4500, C: 4500 });
  assert.deepEqual(result.transfers, [["B", "A", 4500], ["C", "A", 4500]]);
});

test("전역 대상자를 변경해도 custom 결제는 유지된다", () => {
  const state = makeState(["A", "B", "C"], [
    { payer: "A", amount: 5, participantMode: "custom", participants: ["A", "C"] },
  ], { A: false, B: true, C: false });
  const result = calculateSettlement(state);
  assert.deepEqual(result.owed, { A: 3, B: 0, C: 2 });
});

test("예외 대상자 선택 순서와 무관하게 멤버 순서로 1원을 배분한다", () => {
  const first = makeState(["A", "B", "C"], [
    { payer: "C", amount: 5, participantMode: "custom", participants: ["C", "A"] },
  ]);
  const second = makeState(["A", "B", "C"], [
    { payer: "C", amount: 5, participantMode: "custom", participants: ["A", "C"] },
  ]);
  assert.deepEqual(calculateSettlement(first).owed, { A: 3, B: 0, C: 2 });
  assert.deepEqual(calculateSettlement(second).owed, { A: 3, B: 0, C: 2 });
});

test("custom 부담자가 0명이면 정상 결제로 받아들이지 않는다", () => {
  const state = makeState(["A", "B"], [
    { payer: "A", amount: 1000, participantMode: "custom", participants: [] },
  ]);
  const normalized = normalizeStateData(state, { idFactory: () => "new-id" });
  assert.equal(normalized.state.payments.length, 0);
  assert.ok(normalized.issues.some((issue) => issue.code === "empty-custom-participants"));
});

test("전역 대상자가 0명인 기본 결제를 오류로 보고한다", () => {
  const state = makeState(["A", "B"], [{ payer: "A", amount: 1000 }], { A: false, B: false });
  const result = calculateSettlement(state);
  assert.ok(result.errors.some((error) => error.code === "empty-default-participants"));
  assert.deepEqual(result.transfers, []);
});

test("v2 상태는 JSON 저장 후 재로드해도 ID와 데이터가 유지된다", () => {
  const state = makeState(["A", "B"], [
    { id: "stable-id", payer: "A", amount: 1234, place: "카페" },
  ]);
  const loaded = normalizeStateData(JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.issues.length, 0);
  assert.deepEqual(loaded.state, state);
});

test("v2 상태를 storage에 저장하고 다시 로드한다", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = makeState(["A", "B"], [{ id: "stable", payer: "B", amount: 777 }]);
  assert.equal(saveStateToStorage(storage, "v2", state).ok, true);
  const loaded = loadStateFromStorage(storage, "v2");
  assert.equal(loaded.fatal, false);
  assert.deepEqual(loaded.state, state);
});

test("storage 저장 실패와 JSON 파싱 오류를 명확히 반환한다", () => {
  const failingStorage = {
    getItem: () => "{broken-json",
    setItem: () => { throw new Error("quota"); },
  };
  assert.equal(saveStateToStorage(failingStorage, "v2", createInitialState()).ok, false);
  const loaded = loadStateFromStorage(failingStorage, "v2");
  assert.equal(loaded.fatal, true);
  assert.equal(loaded.raw, "{broken-json");
  assert.equal(loaded.issues[0].code, "invalid-json");
});

test("잘못된 결제와 중복 ID를 복구하면서 문제를 보고한다", () => {
  const state = makeState(["A", "B"], [
    { id: "same", payer: "A", amount: 1000 },
    { id: "same", payer: "B", amount: 2000 },
    { id: "bad", payer: "없는사람", amount: 3000 },
    { id: "bad-amount", payer: "A", amount: -1 },
  ]);
  let nextId = 0;
  const normalized = normalizeStateData(state, { idFactory: () => `repaired-${++nextId}` });
  assert.equal(normalized.state.payments.length, 2);
  assert.deepEqual(normalized.state.payments.map((payment) => payment.id), ["same", "repaired-1"]);
  assert.ok(normalized.issues.some((issue) => issue.code === "duplicate-payment-id"));
  assert.ok(normalized.issues.some((issue) => issue.code === "invalid-payer"));
  assert.ok(normalized.issues.some((issue) => issue.code === "invalid-amount"));
});

test("멤버 삭제는 결제자 내역을 삭제하고 custom 참조를 정리한다", () => {
  const state = makeState(["A", "B", "C"], [
    { payer: "B", amount: 1000 },
    { payer: "A", amount: 2000, participantMode: "custom", participants: ["B", "C"] },
  ]);
  state.lastPayer = "B";
  const result = removeMember(state, "B");
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.names, ["A", "C"]);
  assert.equal(result.state.payments.length, 1);
  assert.deepEqual(result.state.payments[0].participants, ["C"]);
  assert.equal(result.state.lastPayer, "A");
});

test("유일한 custom 부담자 삭제는 아무 상태도 바꾸지 않고 차단한다", () => {
  const state = makeState(["A", "B"], [
    { payer: "A", amount: 2000, participantMode: "custom", participants: ["B"] },
  ]);
  const before = JSON.stringify(state);
  const result = removeMember(state, "B");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-custom-participants");
  assert.equal(result.blockingPayments[0].id, "p1");
  assert.equal(JSON.stringify(state), before);
});

test("전체 초기 상태는 다시 정상 계산할 수 있다", () => {
  const result = calculateSettlement(createInitialState());
  assert.equal(result.total, 0);
  assert.deepEqual(result.transfers, []);
  assert.deepEqual(result.errors, []);
});
