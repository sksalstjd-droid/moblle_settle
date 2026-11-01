(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SettlementCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 2;

  function createInitialState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      names: [],
      payments: [],
      targets: {},
      lastPayer: null,
    };
  }

  function createPaymentId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `payment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadStateFromStorage(storage, key, options = {}) {
    let raw;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return {
        state: createInitialState(),
        raw: null,
        found: false,
        issues: [{ code: "storage-read-failed", message: "브라우저 저장소를 읽지 못했습니다.", error }],
        fatal: true,
      };
    }

    if (raw === null) {
      return { state: createInitialState(), raw: null, found: false, issues: [], fatal: false };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        state: createInitialState(),
        raw,
        found: true,
        issues: [{ code: "invalid-json", message: "저장 데이터 JSON을 읽지 못했습니다.", error }],
        fatal: true,
      };
    }

    return { ...normalizeStateData(parsed, options), raw, found: true };
  }

  function saveStateToStorage(storage, key, state) {
    try {
      storage.setItem(key, JSON.stringify(state));
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function classifyQuickEntry(values = {}) {
    const payer = typeof values.payer === "string" ? values.payer.trim() : "";
    const amountText = typeof values.amount === "string" ? values.amount.trim() : String(values.amount ?? "").trim();
    const place = typeof values.place === "string" ? values.place.trim() : "";

    if (!payer) return { ok: false, reason: "invalid-payer", field: "payer" };
    if (!amountText) {
      if (place) return { ok: false, reason: "missing-amount", field: "amount" };
      return { ok: true, action: "add-member", payer };
    }

    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(amountText)) {
      return { ok: false, reason: "invalid-amount", field: "amount" };
    }
    const amount = Number(amountText.replace(/,/g, ""));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return { ok: false, reason: "invalid-amount", field: "amount" };
    }
    return { ok: true, action: "save-payment", payer, amount, place };
  }

  function addMemberToState(state, memberName) {
    const name = typeof memberName === "string" ? memberName.trim() : "";
    if (!name) return { ok: false, reason: "invalid-member" };
    if (state.names.includes(name)) return { ok: false, reason: "duplicate-member" };

    const candidate = {
      ...state,
      names: [...state.names, name],
      targets: { ...state.targets, [name]: true },
    };
    const normalized = normalizeStateData(candidate);
    if (normalized.fatal || normalized.issues.length > 0) {
      return { ok: false, reason: "invalid-created-state", issues: normalized.issues };
    }
    return { ok: true, state: normalized.state, member: name };
  }

  function storeMemberAddition(storage, key, state, memberName) {
    const added = addMemberToState(state, memberName);
    if (!added.ok) return { ...added, state };
    const saved = saveStateToStorage(storage, key, added.state);
    if (!saved.ok) return { ok: false, reason: "storage-write-failed", error: saved.error, state };
    return added;
  }

  function addDefaultPayment(state, values, options = {}) {
    const payer = typeof values.payer === "string" ? values.payer.trim() : "";
    const amount = Number(values.amount);
    if (!payer) return { ok: false, reason: "invalid-payer" };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: "invalid-amount" };

    const hasExistingMembers = state.names.length > 0;
    const hasExistingTargets = state.names.some((name) => state.targets[name] !== false);
    if (hasExistingMembers && !hasExistingTargets) {
      return { ok: false, reason: "empty-default-participants" };
    }

    const isNewPayer = !state.names.includes(payer);
    const names = isNewPayer ? [...state.names, payer] : state.names.slice();
    const targets = { ...state.targets };
    if (isNewPayer || typeof targets[payer] !== "boolean") targets[payer] = true;
    if (!names.some((name) => targets[name] !== false)) {
      return { ok: false, reason: "empty-default-participants" };
    }
    const usedIds = new Set(state.payments.map((payment) => payment.id));
    const idFactory = options.idFactory || createPaymentId;
    let id = String(idFactory());
    while (!id || usedIds.has(id)) id = String(idFactory());

    const payment = {
      id,
      payer,
      amount,
      place: typeof values.place === "string" ? values.place.trim() : "",
      participantMode: "default",
      participants: null,
    };
    return {
      ok: true,
      payment,
      state: {
        ...state,
        names,
        targets,
        payments: [...state.payments, payment],
        lastPayer: payer,
      },
    };
  }

  function storeDefaultPayment(storage, key, state, values, options = {}) {
    const created = addDefaultPayment(state, values, options);
    if (!created.ok) return { ...created, state };

    const normalized = normalizeStateData(created.state, options);
    if (normalized.fatal || normalized.issues.length > 0) {
      return { ok: false, reason: "invalid-created-state", issues: normalized.issues, state };
    }

    const saved = saveStateToStorage(storage, key, normalized.state);
    if (!saved.ok) {
      return { ok: false, reason: "storage-write-failed", error: saved.error, state };
    }

    return { ok: true, payment: created.payment, state: normalized.state };
  }

  function updatePayment(state, paymentId, values) {
    const payment = state.payments.find((item) => item.id === paymentId);
    if (!payment) return { ok: false, reason: "missing-payment" };
    const payer = typeof values.payer === "string" ? values.payer.trim() : "";
    const amount = Number(values.amount);
    if (!payer) return { ok: false, reason: "invalid-payer" };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: "invalid-amount" };

    const isNewPayer = !state.names.includes(payer);
    const names = isNewPayer ? [...state.names, payer] : state.names.slice();
    const targets = { ...state.targets };
    if (isNewPayer || typeof targets[payer] !== "boolean") targets[payer] = true;
    const updatedPayment = {
      ...payment,
      payer,
      amount,
      place: typeof values.place === "string" ? values.place.trim() : "",
    };
    return {
      ok: true,
      payment: updatedPayment,
      state: {
        ...state,
        names,
        targets,
        payments: state.payments.map((item) => item.id === paymentId ? updatedPayment : item),
      },
    };
  }

  function setCustomParticipants(state, paymentId, participantNames) {
    const payment = state.payments.find((item) => item.id === paymentId);
    if (!payment) return { ok: false, reason: "missing-payment" };
    const requested = new Set(Array.isArray(participantNames) ? participantNames : []);
    const participants = state.names.filter((name) => requested.has(name));
    const activeTargets = state.names.filter((name) => state.targets[name] !== false);
    const activeParticipants = participants.filter((name) => state.targets[name] !== false);
    if (activeParticipants.length === 0) return { ok: false, reason: "empty-custom-participants" };
    const isDefaultSet = activeParticipants.length === activeTargets.length
      && activeParticipants.every((name) => activeTargets.includes(name));
    const updatedPayment = isDefaultSet
      ? { ...payment, participantMode: "default", participants: null }
      : { ...payment, participantMode: "custom", participants };
    return {
      ok: true,
      payment: updatedPayment,
      state: {
        ...state,
        payments: state.payments.map((item) => item.id === paymentId ? updatedPayment : item),
      },
    };
  }

  function setGlobalTargets(state, targetNames) {
    const requested = new Set(Array.isArray(targetNames) ? targetNames : []);
    const targets = Object.fromEntries(state.names.map((name) => [name, requested.has(name)]));
    if (state.names.length && !state.names.some((name) => targets[name])) {
      return { ok: false, reason: "empty-global-targets", blockingPayments: [] };
    }

    const blockingPayments = state.payments.filter((payment) => (
      payment.participantMode === "custom"
      && !state.names.some((name) => targets[name] && payment.participants.includes(name))
    ));
    if (blockingPayments.length) {
      return { ok: false, reason: "empty-custom-participants", blockingPayments };
    }
    return { ok: true, state: { ...state, targets }, blockingPayments: [] };
  }

  function resetPaymentParticipants(state, paymentId) {
    const payment = state.payments.find((item) => item.id === paymentId);
    if (!payment) return { ok: false, reason: "missing-payment" };
    const updatedPayment = { ...payment, participantMode: "default", participants: null };
    return {
      ok: true,
      payment: updatedPayment,
      state: {
        ...state,
        payments: state.payments.map((item) => item.id === paymentId ? updatedPayment : item),
      },
    };
  }

  function addIssue(issues, code, message, detail = {}) {
    issues.push({ code, message, ...detail });
  }

  function normalizeStateData(input, options = {}) {
    const idFactory = options.idFactory || createPaymentId;
    const issues = [];

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {
        state: createInitialState(),
        issues: [{ code: "invalid-root", message: "저장 데이터의 최상위 구조가 올바르지 않습니다." }],
        fatal: true,
      };
    }

    if (input.schemaVersion !== SCHEMA_VERSION) {
      return {
        state: createInitialState(),
        issues: [{ code: "unsupported-schema", message: "지원하지 않는 저장 데이터 버전입니다." }],
        fatal: true,
      };
    }

    const names = [];
    const seenNames = new Set();
    const sourceNames = Array.isArray(input.names) ? input.names : [];
    if (!Array.isArray(input.names)) {
      addIssue(issues, "invalid-names", "멤버 목록이 올바르지 않아 빈 목록으로 복구했습니다.");
    }

    sourceNames.forEach((rawName, index) => {
      if (typeof rawName !== "string" || !rawName.trim()) {
        addIssue(issues, "invalid-name", "유효하지 않은 멤버를 제외했습니다.", { index });
        return;
      }
      const name = rawName.trim();
      if (seenNames.has(name)) {
        addIssue(issues, "duplicate-name", "중복 멤버를 한 명으로 정리했습니다.", { name });
        return;
      }
      seenNames.add(name);
      names.push(name);
    });

    const targets = {};
    const sourceTargets = input.targets && typeof input.targets === "object" && !Array.isArray(input.targets)
      ? input.targets
      : {};
    if (sourceTargets !== input.targets) {
      addIssue(issues, "invalid-targets", "기본 정산 대상자 설정을 복구했습니다.");
    }
    names.forEach((name) => {
      targets[name] = typeof sourceTargets[name] === "boolean" ? sourceTargets[name] : true;
    });

    const payments = [];
    const seenIds = new Set();
    const sourcePayments = Array.isArray(input.payments) ? input.payments : [];
    if (!Array.isArray(input.payments)) {
      addIssue(issues, "invalid-payments", "결제 목록이 올바르지 않아 빈 목록으로 복구했습니다.");
    }

    function nextUniqueId() {
      let id = String(idFactory());
      while (!id || seenIds.has(id)) id = String(idFactory());
      return id;
    }

    sourcePayments.forEach((rawPayment, index) => {
      if (!rawPayment || typeof rawPayment !== "object" || Array.isArray(rawPayment)) {
        addIssue(issues, "invalid-payment", "유효하지 않은 결제를 제외했습니다.", { index });
        return;
      }

      const payer = typeof rawPayment.payer === "string" ? rawPayment.payer.trim() : "";
      if (!seenNames.has(payer)) {
        addIssue(issues, "invalid-payer", "등록되지 않은 결제자의 결제를 제외했습니다.", { index, payer });
        return;
      }

      const amount = Number(rawPayment.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        addIssue(issues, "invalid-amount", "금액이 올바르지 않은 결제를 제외했습니다.", { index, payer });
        return;
      }

      let id = typeof rawPayment.id === "string" ? rawPayment.id.trim() : "";
      if (!id || seenIds.has(id)) {
        const previousId = id;
        id = nextUniqueId();
        addIssue(issues, previousId ? "duplicate-payment-id" : "missing-payment-id", "결제 ID를 새로 발급했습니다.", { index, id });
      }
      seenIds.add(id);

      let participantMode = rawPayment.participantMode;
      if (participantMode !== "default" && participantMode !== "custom") {
        participantMode = "default";
        addIssue(issues, "invalid-participant-mode", "잘못된 정산 방식을 기본 정산으로 복구했습니다.", { index, id });
      }

      let participants = null;
      if (participantMode === "custom") {
        const sourceParticipants = Array.isArray(rawPayment.participants) ? rawPayment.participants : [];
        const selected = new Set();
        sourceParticipants.forEach((rawName) => {
          if (typeof rawName === "string" && seenNames.has(rawName.trim())) selected.add(rawName.trim());
        });
        participants = names.filter((name) => selected.has(name));

        const activeParticipants = participants.filter((name) => targets[name] !== false);
        if (activeParticipants.length === 0) {
          addIssue(issues, "empty-custom-participants", "전역 정산 대상자 중 부담자가 없는 예외 결제입니다.", { index, id });
        }
        if (participants.length !== sourceParticipants.length) {
          addIssue(issues, "invalid-custom-participants", "예외 결제의 부담자 목록을 정리했습니다.", { index, id });
        }
      }

      payments.push({
        id,
        payer,
        amount,
        place: typeof rawPayment.place === "string" ? rawPayment.place.trim() : "",
        participantMode,
        participants,
      });
    });

    const lastPayer = typeof input.lastPayer === "string" && seenNames.has(input.lastPayer.trim())
      ? input.lastPayer.trim()
      : input.lastPayer === null && Object.prototype.hasOwnProperty.call(input, "lastPayer")
        ? null
        : names[0] || null;

    return {
      state: { schemaVersion: SCHEMA_VERSION, names, payments, targets, lastPayer },
      issues,
      fatal: false,
    };
  }

  function calculateSettlement(inputState) {
    const normalized = normalizeStateData(inputState);
    const state = normalized.state;
    const names = state.names;
    const paid = Object.fromEntries(names.map((name) => [name, 0]));
    const defaultOwed = Object.fromEntries(names.map((name) => [name, 0]));
    const customOwed = Object.fromEntries(names.map((name) => [name, 0]));
    const paymentDetails = [];
    const errors = normalized.fatal
      ? normalized.issues.map((issue) => ({ code: issue.code, message: issue.message }))
      : [];

    state.payments.forEach((payment) => {
      paid[payment.payer] += payment.amount;
    });

    const defaultPayments = state.payments.filter((payment) => payment.participantMode === "default");
    const defaultTotal = defaultPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const defaultTargets = names.filter((name) => state.targets[name] !== false);
    const perHead = defaultTargets.length ? Math.floor(defaultTotal / defaultTargets.length) : 0;

    if (defaultTotal > 0 && defaultTargets.length === 0) {
      errors.push({ code: "empty-default-participants", message: "기본 결제의 정산 대상자가 없습니다." });
    } else if (defaultTotal > 0) {
      const remainder = defaultTotal % defaultTargets.length;
      defaultTargets.forEach((name, index) => {
        defaultOwed[name] += perHead + (index < remainder ? 1 : 0);
      });
      paymentDetails.push({
        type: "default-group",
        paymentIds: defaultPayments.map((payment) => payment.id),
        amount: defaultTotal,
        participants: defaultTargets.slice(),
        perHead,
        remainder,
      });
    }

    state.payments
      .filter((payment) => payment.participantMode === "custom")
      .forEach((payment) => {
        const participants = names.filter((name) => (
          state.targets[name] !== false && payment.participants.includes(name)
        ));
        if (participants.length === 0) {
          errors.push({ code: "empty-custom-participants", paymentId: payment.id, message: "예외 결제의 정산 대상자가 없습니다." });
          return;
        }
        const customPerHead = Math.floor(payment.amount / participants.length);
        const remainder = payment.amount % participants.length;
        participants.forEach((name, index) => {
          customOwed[name] += customPerHead + (index < remainder ? 1 : 0);
        });
        paymentDetails.push({
          type: "custom-payment",
          paymentId: payment.id,
          amount: payment.amount,
          participants: participants.slice(),
          perHead: customPerHead,
          remainder,
        });
      });

    const owed = Object.fromEntries(names.map((name) => [name, defaultOwed[name] + customOwed[name]]));
    const balances = Object.fromEntries(names.map((name) => [name, owed[name] - paid[name]]));
    const transfers = [];

    if (errors.length === 0) {
      const senders = [];
      const receivers = [];
      names.forEach((name) => {
        if (balances[name] > 0) senders.push([name, balances[name]]);
        if (balances[name] < 0) receivers.push([name, -balances[name]]);
      });

      let senderIndex = 0;
      let receiverIndex = 0;
      while (senderIndex < senders.length && receiverIndex < receivers.length) {
        const amount = Math.min(senders[senderIndex][1], receivers[receiverIndex][1]);
        if (amount > 0) transfers.push([senders[senderIndex][0], receivers[receiverIndex][0], amount]);
        senders[senderIndex][1] -= amount;
        receivers[receiverIndex][1] -= amount;
        if (senders[senderIndex][1] === 0) senderIndex += 1;
        if (receivers[receiverIndex][1] === 0) receiverIndex += 1;
      }
    }

    return {
      total: state.payments.reduce((sum, payment) => sum + payment.amount, 0),
      defaultTotal,
      perHead,
      paid,
      defaultOwed,
      customOwed,
      owed,
      balances,
      transfers,
      paymentDetails,
      errors,
    };
  }

  function removeMember(state, name) {
    if (!state.names.includes(name)) return { ok: false, reason: "missing-member", blockingPayments: [] };

    const blockingPayments = state.payments.filter((payment) => (
      payment.payer !== name
      && payment.participantMode === "custom"
      && !state.names.some((member) => (
        member !== name
        && state.targets[member] !== false
        && payment.participants.includes(member)
      ))
    ));
    if (blockingPayments.length) return { ok: false, reason: "empty-custom-participants", blockingPayments };

    const next = {
      ...state,
      names: state.names.filter((member) => member !== name),
      targets: Object.fromEntries(Object.entries(state.targets).filter(([member]) => member !== name)),
      payments: state.payments
        .filter((payment) => payment.payer !== name)
        .map((payment) => payment.participantMode === "custom"
          ? { ...payment, participants: payment.participants.filter((participant) => participant !== name) }
          : { ...payment }),
      lastPayer: state.lastPayer === name ? state.names.find((member) => member !== name) || null : state.lastPayer,
    };
    return { ok: true, state: next, blockingPayments: [] };
  }

  return {
    SCHEMA_VERSION,
    createInitialState,
    createPaymentId,
    loadStateFromStorage,
    saveStateToStorage,
    classifyQuickEntry,
    addMemberToState,
    storeMemberAddition,
    addDefaultPayment,
    storeDefaultPayment,
    updatePayment,
    setCustomParticipants,
    resetPaymentParticipants,
    setGlobalTargets,
    normalizeStateData,
    calculateSettlement,
    removeMember,
  };
});
