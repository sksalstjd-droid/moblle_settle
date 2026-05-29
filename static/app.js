const PALETTE = [
  "#4F86B8", "#3F9870", "#927DBF", "#C99658", "#62ADAD",
  "#BE7D95", "#C97861", "#79BF91", "#B8A340", "#7D9FC2",
];

const STORAGE_KEY = "mobile_settle_flask_state_v1";

let state = {
  names: [],
  payments: [], // { payer, amount }
  targets: {},
  lastPayer: null,
};

const $ = (id) => document.getElementById(id);
let saveButtonTimer = null;
let showAllPayments = false;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.names = Array.isArray(parsed.names) ? parsed.names : [];
    state.payments = Array.isArray(parsed.payments) ? parsed.payments : [];
    state.targets = parsed.targets && typeof parsed.targets === "object" ? parsed.targets : {};
    state.lastPayer = parsed.lastPayer || null;
  } catch {
    state = { names: [], payments: [], targets: {}, lastPayer: null };
  }
}

function normalizeState() {
  state.names.forEach((name) => {
    if (typeof state.targets[name] !== "boolean") {
      state.targets[name] = true;
    }
  });

  Object.keys(state.targets).forEach((name) => {
    if (!state.names.includes(name)) {
      delete state.targets[name];
    }
  });

  state.payments = state.payments.filter((p) => state.names.includes(p.payer));

  if (state.names.length === 0) {
    state.lastPayer = null;
  } else if (!state.names.includes(state.lastPayer)) {
    state.lastPayer = state.names[0];
  }
}

function colorOf(name) {
  const index = state.names.indexOf(name);
  return index >= 0 ? PALETTE[index % PALETTE.length] : "#888888";
}

function won(amount) {
  return `${Math.trunc(amount).toLocaleString("ko-KR")}원`;
}

function parseAmount(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function formatAmountInput() {
  const input = $("amountInput");
  const amount = parseAmount(input.value);
  input.value = amount ? amount.toLocaleString("ko-KR") : "";
  updateSaveButtonText();
}

function getPayerInputName() {
  return $("payerInput").value.trim();
}

function keepQuickInputVisible() {
  window.setTimeout(() => {
    $("quickInputCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

function getTargets() {
  return state.names.filter((name) => state.targets[name] !== false);
}

function getPaidSums() {
  const paid = Object.fromEntries(state.names.map((name) => [name, 0]));
  state.payments.forEach((p) => {
    if (p.payer in paid) paid[p.payer] += Number(p.amount || 0);
  });
  return paid;
}

function calcResult() {
  const targets = getTargets();

  if (targets.length === 0 || state.payments.length === 0) {
    return { total: 0, perHead: 0, transfers: [] };
  }

  const total = state.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const perHead = Math.floor(total / targets.length);

  const paid = Object.fromEntries(state.names.map((name) => [name, 0]));
  const owed = Object.fromEntries(state.names.map((name) => [name, 0]));

  state.payments.forEach((p) => {
    if (p.payer in paid) paid[p.payer] += Number(p.amount || 0);
  });

  targets.forEach((name) => {
    owed[name] += perHead;
  });

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
    if (amount > 0) transfers.push([senders[i][0], receivers[j][0], amount]);

    senders[i][1] -= amount;
    receivers[j][1] -= amount;

    if (senders[i][1] === 0) i += 1;
    if (receivers[j][1] === 0) j += 1;
  }

  return { total, perHead, transfers };
}

function buildCopyText() {
  const { total, perHead, transfers } = calcResult();
  const targets = getTargets();

  const lines = [
    "💸 정산 결과",
    "========================",
    `총액     : ${won(total)}`,
    `1인당    : ${won(perHead)}  (${targets.length}명 기준)`,
    "========================",
  ];

  if (transfers.length) {
    transfers.forEach(([sender, receiver, amount]) => {
      lines.push(`  ${sender}  →  ${receiver}  :  ${won(amount)}`);
    });
  } else {
    lines.push("  정산 내역 없음 🍯");
  }

  return lines.join("\n");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1600);
}

function setTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  $("tabInput").classList.toggle("active", tabName === "input");
  $("tabResult").classList.toggle("active", tabName === "result");
}

function renderSummary() {
  const { total, perHead } = calcResult();
  const targets = getTargets();

  $("summaryTotal").textContent = won(total);
  $("summaryTargetCount").textContent = `${targets.length}명 · ${state.payments.length}건`;
  $("summaryPerHead").textContent = won(perHead);
}

function renderStartOverCard() {
  const card = $("startOverCard");
  const hasRecords = state.names.length > 0 || state.payments.length > 0;

  card.classList.toggle("hidden", !hasRecords);
  $("startOverSummary").textContent = `멤버 ${state.names.length}명 · 결제 ${state.payments.length}건`;
}

function renderPayerButtons() {
  const wrap = $("payerButtons");
  wrap.innerHTML = "";

  if (!state.names.length) {
    wrap.classList.add("empty");
    wrap.innerHTML = `<p class="empty-text">저장된 이름이 여기에 표시됩니다.</p>`;
    return;
  }

  wrap.classList.remove("empty");

  state.names.forEach((name) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = name;
    button.style.borderColor = colorOf(name);
    button.addEventListener("click", () => {
      $("payerInput").value = name;
      $("amountInput").focus();
      updateSaveButtonText();
    });
    wrap.appendChild(button);
  });
}

function renderMembers() {
  const list = $("memberList");
  const paid = getPaidSums();

  $("memberCountBadge").textContent = `${state.names.length}명`;
  list.innerHTML = "";

  if (!state.names.length) {
    list.innerHTML = `<p class="empty-text">멤버를 추가하면 결제 입력을 시작할 수 있어요.</p>`;
    return;
  }

  state.names.forEach((name) => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.style.borderLeftColor = colorOf(name);

    card.innerHTML = `
      <div class="item-title" style="color:${colorOf(name)};">${escapeHtml(name)}</div>
      <div class="item-total">
        <span>총</span>
        <strong>${won(paid[name] || 0)}</strong>
      </div>
      <button class="delete-btn">삭제</button>
    `;

    card.querySelector("button").addEventListener("click", () => {
      if (!confirm(`${name}님을 삭제할까요?\n해당 멤버의 결제 내역도 함께 삭제됩니다.`)) return;
      state.names = state.names.filter((n) => n !== name);
      delete state.targets[name];
      state.payments = state.payments.filter((p) => p.payer !== name);
      if (state.lastPayer === name) state.lastPayer = state.names[0] || null;
      saveAndRender();
    });

    list.appendChild(card);
  });
}

function renderPayments() {
  const list = $("paymentList");
  $("paymentCountBadge").textContent = `${state.payments.length}건`;
  list.innerHTML = "";

  if (!state.payments.length) {
    list.innerHTML = `<p class="empty-text">아직 결제 내역이 없어요.</p>`;
    return;
  }

  const recentPayments = state.payments
    .map((payment, index) => ({ payment, index }))
    .slice()
    .reverse();
  const visiblePayments = showAllPayments ? recentPayments : recentPayments.slice(0, 4);

  visiblePayments.forEach(({ payment, index }) => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.style.borderLeftColor = colorOf(payment.payer);

    card.innerHTML = `
      <div class="item-title" style="color:${colorOf(payment.payer)};">${escapeHtml(payment.payer)}</div>
      <div class="item-amount">${won(payment.amount)}</div>
      <button class="delete-btn">삭제</button>
    `;

    card.querySelector("button").addEventListener("click", () => {
      state.payments.splice(index, 1);
      saveAndRender();
    });

    list.appendChild(card);
  });

  if (recentPayments.length > 4) {
    const toggleButton = document.createElement("button");
    toggleButton.className = "payment-more-btn";
    toggleButton.textContent = showAllPayments ? "접기 ▲" : "더보기 ▼";
    toggleButton.addEventListener("click", () => {
      showAllPayments = !showAllPayments;
      renderPayments();
    });
    list.appendChild(toggleButton);
  }
}

function renderTargets() {
  const list = $("targetList");
  const targets = getTargets();

  $("targetCountBadge").textContent = `${targets.length}명`;
  list.innerHTML = "";

  if (!state.names.length) {
    list.innerHTML = `<p class="empty-text">멤버를 먼저 추가하세요.</p>`;
    return;
  }

  state.names.forEach((name) => {
    const label = document.createElement("label");
    label.className = "target-card";

    const checked = state.targets[name] !== false;

    label.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""} />
      <span style="color:${checked ? colorOf(name) : "#6b7280"};">${escapeHtml(name)}</span>
    `;

    label.querySelector("input").addEventListener("change", (event) => {
      state.targets[name] = event.target.checked;
      saveAndRender();
    });

    list.appendChild(label);
  });
}

function renderResult() {
  const list = $("resultList");
  const { transfers } = calcResult();
  const targets = getTargets();

  list.innerHTML = "";

  if (!state.payments.length || !targets.length) {
    list.innerHTML = `<div class="notice">결제 내역과 정산 대상자를 확인해주세요.</div>`;
    $("copyResultBtn").style.display = "none";
    return;
  }

  $("copyResultBtn").style.display = "block";

  if (!transfers.length) {
    list.innerHTML = `<div class="success">🍯 정산 내역 없음 — 모두 딱 맞게 냈어요!</div>`;
    return;
  }

  transfers.forEach(([sender, receiver, amount]) => {
    const card = document.createElement("div");
    card.className = "transfer-row";

    card.innerHTML = `
      <div class="transfer-names">
        <span style="color:${colorOf(sender)};">${escapeHtml(sender)}</span>
        <span style="color:#9ca3af;">→</span>
        <span style="color:${colorOf(receiver)};">${escapeHtml(receiver)}</span>
      </div>
      <div class="transfer-amount">${won(amount)}</div>
    `;

    list.appendChild(card);
  });
}

function render() {
  normalizeState();
  renderStartOverCard();
  renderSummary();
  renderPayerButtons();
  renderMembers();
  renderPayments();
  renderTargets();
  renderResult();
  updateSaveButtonText();
}

function saveAndRender() {
  normalizeState();
  saveState();
  render();
}

function addPayment() {
  const name = getPayerInputName();
  const amount = parseAmount($("amountInput").value);

  if (!name) {
    showToast("이름을 입력해주세요.");
    return;
  }

  if (amount <= 0) {
    showToast("금액을 입력해주세요.");
    return;
  }

  if (!state.names.includes(name)) {
    state.names.push(name);
    state.targets[name] = true;
  } else if (typeof state.targets[name] !== "boolean") {
    state.targets[name] = true;
  }

  state.payments.push({
    payer: name,
    amount,
  });

  state.lastPayer = name;
  $("amountInput").value = "";
  saveAndRender();
  $("amountInput").focus({ preventScroll: true });
  showSaveSuccess(`${name} · ${won(amount)} 저장됨`);
}

function clearPaymentsOnly() {
  if (!confirm("결제내역만 삭제할까요? 멤버 명단은 유지됩니다.")) return;

  state.payments = [];
  showAllPayments = false;
  saveAndRender();
}

function resetAll() {
  if (!confirm("전체 새로 시작할까요? 멤버와 결제내역이 모두 삭제됩니다.")) return;

  const scrollY = window.scrollY;
  state = { names: [], payments: [], targets: {}, lastPayer: null };
  showAllPayments = false;
  saveAndRender();

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, behavior: "auto" });
    $("amountInput").focus({ preventScroll: true });
  });
}

function showSaveSuccess(message) {
  const button = $("savePaymentBtn");

  window.clearTimeout(saveButtonTimer);

  button.textContent = `✓ ${message}`;

  saveButtonTimer = window.setTimeout(updateSaveButtonText, 1200);
}

function updateSaveButtonText() {
  const button = $("savePaymentBtn");
  if (!button) return;

  const name = getPayerInputName();
  const amount = parseAmount($("amountInput").value);

  if (name && amount > 0) {
    button.textContent = `➕ ${name} · ${won(amount)} 저장`;
  } else {
    button.textContent = "결제 저장";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  $("payerInput").addEventListener("focus", () => {
    keepQuickInputVisible();
    $("payerInput").value = "";
    updateSaveButtonText();
  });
  $("payerInput").addEventListener("input", updateSaveButtonText);
  $("payerInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPayment();
  });

  $("amountInput").addEventListener("input", formatAmountInput);
  $("amountInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPayment();
  });

  $("savePaymentBtn").addEventListener("click", addPayment);
  $("clearPaymentsBtn").addEventListener("click", clearPaymentsOnly);

  $("selectAllBtn").addEventListener("click", () => {
    state.names.forEach((name) => {
      state.targets[name] = true;
    });
    saveAndRender();
  });

  $("clearAllBtn").addEventListener("click", () => {
    state.names.forEach((name) => {
      state.targets[name] = false;
    });
    saveAndRender();
  });

  $("copyResultBtn").addEventListener("click", async () => {
    const text = buildCopyText();

    try {
      await navigator.clipboard.writeText(text);
      showToast("정산 결과를 복사했어요.");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      showToast(ok ? "정산 결과를 복사했어요." : "복사에 실패했어요.");
    }
  });

  $("resetBtn").addEventListener("click", resetAll);
}

loadState();
normalizeState();
bindEvents();
saveState();
render();
