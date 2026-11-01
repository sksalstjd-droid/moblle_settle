const PALETTE = [
  "#4F86B8", "#3F9870", "#927DBF", "#C99658", "#62ADAD",
  "#BE7D95", "#C97861", "#79BF91", "#B8A340", "#7D9FC2",
];

const STORAGE_KEY = "mobile_settle_flask_state_v2";
const RECOVERY_KEY_PREFIX = `${STORAGE_KEY}_recovery_`;
const {
  createInitialState,
  createPaymentId,
  classifyQuickEntry,
  loadStateFromStorage,
  saveStateToStorage,
  storeDefaultPayment,
  storeMemberAddition,
  updatePayment,
  setCustomParticipants,
  setGlobalTargets,
  normalizeStateData,
  calculateSettlement,
  removeMember,
} = SettlementCore;
const {
  buildShareModel,
  buildCopyText: buildReportCopyText,
  createPngReport,
  shareFile,
  requestDownload,
} = ShareReport;

let state = createInitialState();

const $ = (id) => document.getElementById(id);
let saveButtonTimer = null;
let showAllPayments = false;
let startupStorageMessage = "";
let editingPaymentId = null;
let exceptionEditingPaymentId = null;
let preparedShare = null;
let quickInputFocused = false;
let quickVisibilityFrame = null;
let quickSavedPayer = null;

function saveState() {
  const result = saveStateToStorage(localStorage, STORAGE_KEY, state);
  if (!result.ok) {
    showToast("저장하지 못했어요. 브라우저 저장 공간을 확인해주세요.");
    return false;
  }
  return true;
}

function preserveInvalidStorage(raw) {
  try {
    localStorage.setItem(`${RECOVERY_KEY_PREFIX}${Date.now()}`, raw);
    return true;
  } catch {
    return false;
  }
}

function loadState() {
  const loaded = loadStateFromStorage(localStorage, STORAGE_KEY);
  state = loaded.state;
  if (!loaded.fatal && loaded.issues.length === 0) return;

  if (loaded.raw !== null) {
    const preserved = preserveInvalidStorage(loaded.raw);
    startupStorageMessage = preserved
      ? `저장 데이터 오류 ${loaded.issues.length}건을 복구하고 원본을 보관했어요.`
      : `저장 데이터 오류 ${loaded.issues.length}건을 복구했지만 원본을 보관하지 못했어요.`;
  } else {
    startupStorageMessage = "브라우저 저장소를 읽지 못해 임시 상태로 시작했어요.";
  }
}

function normalizeState() {
  state = normalizeStateData(state).state;
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
  const raw = input.value.trim();
  if (!raw) {
    input.value = "";
  } else if (/^[\d,]+$/.test(raw)) {
    const digits = raw.replace(/\D/g, "");
    input.value = digits ? Number(digits).toLocaleString("ko-KR") : "";
  }
  clearQuickInputError(input);
  updateSaveButtonText();
}

function getPayerInputName() {
  return $("payerInput").value.trim();
}

function keepQuickInputVisible() {
  quickInputFocused = true;
  scheduleQuickInputVisibility();
  window.setTimeout(scheduleQuickInputVisibility, 240);
}

function scheduleQuickInputVisibility() {
  if (!quickInputFocused || quickVisibilityFrame !== null) return;
  quickVisibilityFrame = window.requestAnimationFrame(() => {
    quickVisibilityFrame = null;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
    const screenHeight = window.screen ? window.screen.availHeight : 0;
    const keyboardOpen = layoutHeight - viewport.height > 80
      || (screenHeight - viewport.height > 180 && quickInputFocused);
    if (!keyboardOpen) return;

    const group = $("quickEntryForm");
    const rect = group.getBoundingClientRect();
    const visibleTop = viewport.offsetTop + 8;
    const visibleBottom = viewport.offsetTop + viewport.height - 8;
    if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return;

    const pageTop = window.scrollY + rect.top - visibleTop;
    window.scrollTo({ top: Math.max(0, pageTop), behavior: "auto" });
  });
}

function clearQuickInputError(input) {
  if (!input) return;
  input.classList.remove("input-error");
  input.removeAttribute("aria-invalid");
  $("quickInputFeedback").textContent = "";
}

function showQuickInputError(input, message) {
  document.querySelectorAll(".quick-input-fields input.input-error").forEach((field) => {
    field.classList.remove("input-error");
    field.removeAttribute("aria-invalid");
  });
  const feedback = $("quickInputFeedback");
  feedback.textContent = message;
  input.classList.remove("input-error");
  void input.offsetWidth;
  input.classList.add("input-error");
  input.setAttribute("aria-invalid", "true");
  input.focus({ preventScroll: true });
  scheduleQuickInputVisibility();
}

function showQuickInputNotice(message) {
  $("quickInputFeedback").textContent = message;
}

function addQuickMember(name) {
  const result = storeMemberAddition(localStorage, STORAGE_KEY, state, name);
  if (!result.ok) {
    if (result.reason === "duplicate-member") {
      showQuickInputNotice("이미 등록된 멤버예요. 결제를 추가하려면 금액을 입력하세요.");
    } else if (result.reason === "storage-write-failed") {
      showQuickInputNotice("멤버를 저장하지 못했어요. 입력 내용을 그대로 두었습니다.");
    } else {
      showQuickInputNotice("이름을 확인해주세요.");
    }
    return false;
  }

  state = result.state;
  render();
  $("payerInput").value = "";
  $("amountInput").value = "";
  $("placeInput").value = "";
  updateSaveButtonText();
  showToast(`${name} 멤버 추가됨`);
  $("payerInput").focus({ preventScroll: true });
  return true;
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
  return calculateSettlement(state);
}

function buildCopyText() {
  return buildReportCopyText(state, calcResult());
}

function shareFingerprint() {
  return JSON.stringify({ names: state.names, payments: state.payments, targets: state.targets });
}

function invalidateShareImage() {
  if (preparedShare?.url) URL.revokeObjectURL(preparedShare.url);
  preparedShare = null;
  const panel = $("sharePanel");
  if (panel) panel.hidden = true;
  const preview = $("sharePreview");
  if (preview) preview.removeAttribute("src");
}

function shareFileName() {
  const date = new Date();
  const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value) => String(value).padStart(2, "0"))
    .join("");
  return `settlement-${stamp}.png`;
}

async function prepareShareImage() {
  const calculation = calcResult();
  const model = buildShareModel(state, calculation);
  if (!model.ok || !state.payments.length) {
    showToast("정산 오류를 해결한 뒤 이미지를 만들어주세요.");
    return;
  }

  const button = $("createPngBtn");
  button.disabled = true;
  button.textContent = "PNG 만드는 중…";
  $("sharePanel").hidden = false;
  $("shareStatus").textContent = "공유 이미지를 만들고 있어요.";

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const report = await createPngReport(model);
    invalidateShareImage();
    const fileName = shareFileName();
    const file = new File([report.blob], fileName, { type: "image/png" });
    const url = URL.createObjectURL(report.blob);
    preparedShare = { ...report, file, fileName, url, fingerprint: shareFingerprint() };
    $("sharePreview").src = url;
    $("sharePanel").hidden = false;

    let canShareFile = false;
    try {
      canShareFile = typeof navigator.canShare === "function"
        && typeof navigator.share === "function"
        && navigator.canShare({ files: [file] });
    } catch {
      canShareFile = false;
    }
    $("sharePngBtn").hidden = !canShareFile;
    $("shareStatus").textContent = canShareFile
      ? "이미지가 준비됐어요. 공유하거나 PNG로 저장할 수 있어요."
      : "이 브라우저는 파일 공유를 지원하지 않아 PNG 저장을 제공합니다.";
  } catch (error) {
    invalidateShareImage();
    $("sharePanel").hidden = false;
    $("shareStatus").textContent = "PNG 생성에 실패했어요. 다시 시도해주세요.";
    showToast("PNG 생성에 실패했어요.");
  } finally {
    button.disabled = false;
    button.textContent = "PNG 공유 이미지 만들기";
  }
}

function hasFreshShareImage() {
  if (preparedShare && preparedShare.fingerprint === shareFingerprint()) return true;
  invalidateShareImage();
  showToast("정산 내용이 바뀌었어요. PNG를 다시 만들어주세요.");
  return false;
}

async function sharePreparedImage() {
  if (!hasFreshShareImage()) return;
  const result = await shareFile(navigator, preparedShare.file);
  if (result.status === "shared") {
    showToast("공유 메뉴로 이미지를 전달했어요.");
  } else if (result.status === "canceled") {
    showToast("공유를 취소했어요.");
  } else if (result.status === "unsupported") {
    showToast("파일 공유를 지원하지 않아 PNG 저장을 이용해주세요.");
  } else {
    showToast("이미지 공유에 실패했어요.");
  }
}

function downloadPreparedImage() {
  if (!hasFreshShareImage()) return;
  const result = requestDownload(document, preparedShare.url, preparedShare.fileName);
  $("shareStatus").textContent = result.status === "requested"
    ? "PNG 저장을 요청했어요. 저장되지 않으면 이미지를 길게 눌러주세요."
    : "자동 저장을 완료하지 못했어요. 이미지를 길게 눌러 저장해주세요.";
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

function renderSummary(calculation) {
  const { total, perHead } = calculation;
  const targets = getTargets();
  const customCount = state.payments.filter((payment) => payment.participantMode === "custom").length;

  if (customCount === 0) {
    $("summaryPrimaryLabel").textContent = "1인당";
    $("summaryPerHead").textContent = won(perHead);
    $("summarySecondaryLabel").textContent = "총액";
    $("summaryTotal").textContent = won(total);
    $("summaryTargetCount").textContent = `${targets.length}명 · ${state.payments.length}건`;
    return;
  }

  $("summaryPrimaryLabel").textContent = "총 결제액";
  $("summaryPerHead").textContent = won(total);
  $("summarySecondaryLabel").textContent = "정산";
  $("summaryTotal").textContent = "맞춤 포함";
  $("summaryTargetCount").textContent = `${state.payments.length}건 · 예외 ${customCount}건`;
}

function renderStartOverCard() {
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
      quickSavedPayer = null;
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
      const result = removeMember(state, name);
      if (!result.ok) {
        if (result.reason === "empty-custom-participants") {
          const payment = result.blockingPayments[0];
          const label = payment.place || `${payment.payer} · ${won(payment.amount)}`;
          showToast(`삭제할 수 없어요. 예외 결제 '${label}'의 유일한 부담자예요.`);
        }
        return;
      }
      state = result.state;
      if (!state.payments.some((payment) => payment.id === editingPaymentId)) editingPaymentId = null;
      if (!state.payments.some((payment) => payment.id === exceptionEditingPaymentId)) {
        exceptionEditingPaymentId = null;
      }
      saveAndRender();
    });

    list.appendChild(card);
  });
}

function startPaymentEdit(paymentId) {
  editingPaymentId = paymentId;
  renderPayments();
  window.setTimeout(() => {
    const input = document.querySelector(`[data-edit-payment-id="${CSS.escape(paymentId)}"] .payment-edit-name`);
    if (input) input.focus();
  }, 0);
}

function cancelPaymentEdit() {
  editingPaymentId = null;
  renderPayments();
}

function savePaymentEdit(paymentId, panel) {
  const payer = panel.querySelector(".payment-edit-name").value.trim();
  const amount = parseAmount(panel.querySelector(".payment-edit-amount").value);
  const place = panel.querySelector(".payment-edit-place").value.trim();
  const result = updatePayment(state, paymentId, { payer, amount, place });

  if (!result.ok) {
    showToast(result.reason === "invalid-payer" ? "이름을 입력해주세요." : "금액을 입력해주세요.");
    return;
  }

  state = result.state;
  editingPaymentId = null;
  saveAndRender();
  showToast("결제 내역을 수정했어요.");
}

function createPaymentEditPanel(payment) {
  const panel = document.createElement("div");
  panel.className = "payment-edit-panel";
  panel.dataset.editPaymentId = payment.id;

  const fields = document.createElement("div");
  fields.className = "payment-edit-fields";

  const nameInput = document.createElement("input");
  nameInput.className = "payment-edit-input payment-edit-name";
  nameInput.value = payment.payer;
  nameInput.placeholder = "결제자";

  const amountInput = document.createElement("input");
  amountInput.className = "payment-edit-input payment-edit-amount";
  amountInput.value = payment.amount.toLocaleString("ko-KR");
  amountInput.placeholder = "금액";
  amountInput.inputMode = "numeric";
  amountInput.addEventListener("input", () => {
    const amount = parseAmount(amountInput.value);
    amountInput.value = amount ? amount.toLocaleString("ko-KR") : "";
  });

  const placeInput = document.createElement("input");
  placeInput.className = "payment-edit-input payment-edit-place";
  placeInput.value = payment.place;
  placeInput.placeholder = "사용처 (선택)";

  fields.append(nameInput, amountInput, placeInput);

  const actions = document.createElement("div");
  actions.className = "payment-edit-actions";
  const cancelButton = document.createElement("button");
  cancelButton.className = "small-btn";
  cancelButton.textContent = "취소";
  cancelButton.addEventListener("click", cancelPaymentEdit);
  const saveButton = document.createElement("button");
  saveButton.className = "small-btn primary";
  saveButton.textContent = "수정 저장";
  saveButton.addEventListener("click", () => savePaymentEdit(payment.id, panel));
  actions.append(cancelButton, saveButton);

  [nameInput, amountInput, placeInput].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") savePaymentEdit(payment.id, panel);
      if (event.key === "Escape") cancelPaymentEdit();
    });
  });

  panel.append(fields, actions);
  return panel;
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

  visiblePayments.forEach(({ payment }) => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.style.borderLeftColor = colorOf(payment.payer);

    const customBadge = payment.participantMode === "custom" ? `<span class="custom-badge">예외</span>` : "";
    const placeMeta = payment.place ? `<div class="item-meta">${escapeHtml(payment.place)}</div>` : "";
    card.innerHTML = `
      <div class="item-main">
        <div class="item-title" style="color:${colorOf(payment.payer)};">${escapeHtml(payment.payer)}${customBadge}</div>
        ${placeMeta}
      </div>
      <div class="item-amount">${won(payment.amount)}</div>
      <div class="payment-actions">
        <button class="edit-btn">수정</button>
        <button class="delete-btn">삭제</button>
      </div>
    `;

    card.querySelector(".edit-btn").addEventListener("click", () => startPaymentEdit(payment.id));
    card.querySelector(".delete-btn").addEventListener("click", () => {
      state.payments = state.payments.filter((item) => item.id !== payment.id);
      if (editingPaymentId === payment.id) editingPaymentId = null;
      if (exceptionEditingPaymentId === payment.id) {
        exceptionEditingPaymentId = null;
      }
      saveAndRender();
    });

    list.appendChild(card);
    if (editingPaymentId === payment.id) list.appendChild(createPaymentEditPanel(payment));
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
  const totalCount = state.names.length;
  const targetCount = targets.length;
  const allSelected = totalCount > 0 && targetCount === totalCount;
  const allToggleButton = $("targetAllToggleBtn");

  $("targetCountBadge").textContent = `${targetCount}/${totalCount}명`;
  allToggleButton.textContent = allSelected ? "모두 제외" : "모두 포함";
  allToggleButton.disabled = totalCount === 0;
  list.innerHTML = "";

  if (!state.names.length) {
    list.innerHTML = `<p class="empty-text">멤버를 먼저 추가하세요.</p>`;
    return;
  }

  state.names.forEach((name) => {
    const checked = state.targets[name] !== false;
    const button = document.createElement("button");

    button.className = `target-chip ${checked ? "active" : "inactive"}`;
    button.textContent = name;
    if (checked) {
      button.style.borderColor = colorOf(name);
    }

    button.addEventListener("click", () => {
      const nextTargets = getTargets().filter((member) => member !== name);
      if (!checked) nextTargets.push(name);
      applyGlobalTargets(nextTargets);
    });

    list.appendChild(button);
  });
}

function openExceptionEditor(payment) {
  exceptionEditingPaymentId = exceptionEditingPaymentId === payment.id ? null : payment.id;
  renderExceptions();
}

function applyGlobalTargets(targetNames) {
  const result = setGlobalTargets(state, targetNames);
  if (!result.ok) {
    if (result.reason === "empty-global-targets") {
      showToast("전역 정산 대상자는 한 명 이상 포함해야 해요.");
    } else {
      const payment = result.blockingPayments[0];
      const label = payment ? (payment.place || payment.payer) : "결제";
      const excludedName = getTargets().find((name) => !targetNames.includes(name));
      showToast("'" + (excludedName || "선택한 멤버") + "' 제외 시 '" + label + "' 결제의 부담자가 0명이 됩니다.");
      markBlockedException(payment && payment.id);
    }
    renderTargets();
    return false;
  }
  return commitState(result.state);
}

function markBlockedException(paymentId) {
  if (!paymentId) return;
  exceptionEditingPaymentId = paymentId;
  renderExceptions();
  const row = $("exceptionPaymentList").querySelector('[data-payment-id="' + CSS.escape(paymentId) + '"]');
  if (!row) return;
  row.classList.add("blocked");
  window.setTimeout(() => row.classList.remove("blocked"), 800);
}

function togglePaymentParticipant(payment, name, button) {
  if (state.targets[name] === false) return;
  const current = payment.participantMode === "custom"
    ? payment.participants.filter((member) => state.targets[member] !== false)
    : getTargets();
  const selected = new Set(current);
  if (selected.has(name)) selected.delete(name);
  else selected.add(name);
  if (selected.size === 0) {
    button.classList.add("blocked");
    button.setAttribute("aria-invalid", "true");
    window.setTimeout(() => {
      button.classList.remove("blocked");
      button.removeAttribute("aria-invalid");
    }, 800);
    showToast("부담자는 한 명 이상 선택해야 해요.");
    return;
  }
  const result = setCustomParticipants(state, payment.id, state.names.filter((member) => selected.has(member)));
  if (!result.ok) {
    showToast("부담자 설정을 저장하지 못했어요.");
    return;
  }
  commitState(result.state);
}

function renderExceptions() {
  const list = $("exceptionPaymentList");
  const editor = $("exceptionEditor");
  const customCount = state.payments.filter((payment) => payment.participantMode === "custom").length;
  $("customPaymentCountBadge").textContent = `예외 ${customCount}건`;
  list.innerHTML = "";
  editor.innerHTML = "";

  const selectedPayment = state.payments.find((payment) => payment.id === exceptionEditingPaymentId);
  if (!selectedPayment) {
    exceptionEditingPaymentId = null;
  }

  if (!state.payments.length) {
    list.innerHTML = `<p class="empty-text">설정할 결제 내역이 없어요.</p>`;
    return;
  }

  state.payments.slice().reverse().forEach((payment) => {
    const button = document.createElement("button");
    button.className = `exception-payment-btn ${payment.id === exceptionEditingPaymentId ? "selected" : ""}`;
    button.dataset.paymentId = payment.id;
    const label = document.createElement("span");
    label.textContent = payment.place ? `${payment.payer} · ${payment.place}` : payment.payer;
    if (payment.participantMode === "custom") {
      const badge = document.createElement("span");
      badge.className = "custom-badge";
      badge.textContent = "예외";
      label.append(" ", badge);
    }
    const amount = document.createElement("span");
    amount.textContent = won(payment.amount);
    button.append(label, amount);
    button.addEventListener("click", () => openExceptionEditor(payment));
    list.appendChild(button);
  });

  if (!selectedPayment) return;

  const card = document.createElement("div");
  card.className = "exception-editor-card";
  const title = document.createElement("p");
  title.className = "exception-editor-title";
  title.textContent = `${selectedPayment.place || selectedPayment.payer} 부담자 선택`;
  const chips = document.createElement("div");
  chips.className = "target-chip-wrap";

  state.names.forEach((name) => {
    const locked = state.targets[name] === false;
    const selected = selectedPayment.participantMode === "custom"
      ? selectedPayment.participants.includes(name)
      : !locked;
    const checked = selected && !locked;
    const button = document.createElement("button");
    button.className = `target-chip ${locked ? "locked" : checked ? "active" : "inactive"}`;
    button.textContent = locked ? `${name} · 전체 정산 제외 🔒` : name;
    button.disabled = locked;
    button.setAttribute("aria-pressed", String(checked));
    if (locked) button.title = "전역 정산에서 제외되어 이 결제에서도 선택할 수 없어요.";
    if (checked) button.style.borderColor = colorOf(name);
    button.addEventListener("click", () => {
      togglePaymentParticipant(selectedPayment, name, button);
    });
    chips.appendChild(button);
  });
  const hint = document.createElement("p");
  hint.className = "exception-editor-hint";
  hint.textContent = "부담자 선택은 즉시 저장돼요. 전역 대상자와 같아지면 기본 정산으로 돌아가요.";
  card.append(title, chips, hint);
  editor.appendChild(card);
}

function renderResult(calculation) {
  const list = $("resultList");
  const { transfers, errors } = calculation;

  list.innerHTML = "";

  if (!state.payments.length || errors.length > 0) {
    const message = errors.some((error) => error.code === "empty-default-participants")
      ? "기본 정산 대상자를 한 명 이상 포함해주세요."
      : errors.some((error) => error.code === "empty-custom-participants")
        ? "예외 결제의 부담자를 전역 정산 대상자 중에서 한 명 이상 선택해주세요."
        : "결제 내역과 정산 대상자를 확인해주세요.";
    list.innerHTML = `<div class="notice">${message}</div>`;
    $("copyResultBtn").style.display = "none";
    $("createPngBtn").style.display = "none";
    return;
  }

  $("copyResultBtn").style.display = "block";
  $("createPngBtn").style.display = "block";

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
  const calculation = calcResult();
  renderStartOverCard();
  renderSummary(calculation);
  renderPayerButtons();
  renderMembers();
  renderPayments();
  renderTargets();
  renderExceptions();
  renderResult(calculation);
  updateSaveButtonText();
}

function saveAndRender() {
  invalidateShareImage();
  normalizeState();
  saveState();
  render();
}

function commitState(nextState) {
  const result = saveStateToStorage(localStorage, STORAGE_KEY, nextState);
  if (!result.ok) {
    showToast("저장하지 못했어요. 변경 전 상태를 유지합니다.");
    render();
    return false;
  }
  state = nextState;
  invalidateShareImage();
  render();
  return true;
}

function addPayment() {
  const name = getPayerInputName();
  const amountInput = $("amountInput");
  const place = $("placeInput").value.trim();
  const entry = classifyQuickEntry({ payer: name, amount: amountInput.value, place });

  if (!entry.ok) {
    if (entry.reason === "invalid-payer") {
      showQuickInputError($("payerInput"), "이름을 입력해주세요.");
    } else if (entry.reason === "missing-amount") {
      showQuickInputError(amountInput, "사용처만 입력했어요. 금액을 입력해주세요.");
    } else {
      showQuickInputError(amountInput, "금액은 1원 이상의 숫자로 입력해주세요.");
    }
    return;
  }

  if (entry.action === "add-member") {
    if (state.names.includes(entry.payer)) {
      showQuickInputNotice("이미 등록된 멤버예요. 결제를 추가하려면 금액을 입력하세요.");
      return;
    }
    addQuickMember(entry.payer);
    return;
  }

  const { payer, amount } = entry;
  const result = storeDefaultPayment(
    localStorage,
    STORAGE_KEY,
    state,
    { payer, amount, place: entry.place },
    { idFactory: createPaymentId },
  );
  if (!result.ok) {
    if (result.reason === "empty-default-participants") {
      showQuickInputNotice("기본 정산 대상자가 모두 제외되어 있어요. 결과 탭에서 한 명 이상 포함해주세요.");
    } else if (result.reason === "storage-write-failed") {
      showQuickInputNotice("결제를 저장하지 못했어요. 입력 내용은 그대로 유지됩니다.");
    } else {
      showQuickInputNotice("결제 정보를 확인해주세요.");
    }
    return;
  }

  state = result.state;
  invalidateShareImage();
  quickSavedPayer = payer;
  amountInput.value = "";
  $("placeInput").value = "";
  clearQuickInputError(amountInput);
  render();
  amountInput.focus({ preventScroll: true });
  keepQuickInputVisible();
  showSaveSuccess(`${payer} · ${won(amount)} 저장됨`);
}

function clearPaymentsOnly() {
  if (!confirm("결제내역만 삭제할까요? 멤버 명단은 유지됩니다.")) return;

  state.payments = [];
  showAllPayments = false;
  editingPaymentId = null;
  exceptionEditingPaymentId = null;
  saveAndRender();
  closeStartOverDetails();
}

function resetAll() {
  if (!confirm("전체 새로 시작할까요? 멤버와 결제내역이 모두 삭제됩니다.")) return;

  const scrollY = window.scrollY;
  state = createInitialState();
  showAllPayments = false;
  editingPaymentId = null;
  exceptionEditingPaymentId = null;
  saveAndRender();
  closeStartOverDetails();

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, behavior: "auto" });
    $("amountInput").focus({ preventScroll: true });
  });
}

function closeStartOverDetails() {
  const details = document.querySelector(".start-over-details");
  if (details) {
    details.open = false;
  }
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
  const amountRaw = $("amountInput").value.trim();
  const place = $("placeInput").value.trim();
  button.disabled = false;
  const feedback = $("quickInputFeedback");

  if (!amountRaw && !place && name && state.names.includes(name) && name !== quickSavedPayer) {
    button.textContent = "이미 등록됨";
    button.disabled = true;
    showQuickInputNotice("이미 등록된 멤버예요. 결제를 추가하려면 금액을 입력하세요.");
    return;
  }

  if (feedback.textContent.startsWith("이미 등록된 멤버")) feedback.textContent = "";
  if (amountRaw) {
    button.textContent = "결제 저장";
  } else if (name && name === quickSavedPayer) {
    button.textContent = "금액 입력";
  } else if (!name && place) {
    button.textContent = "이름 입력";
  } else if (place) {
    button.textContent = "금액 입력";
  } else {
    button.textContent = "멤버 추가";
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

  const quickInputs = [$("payerInput"), $("amountInput"), $("placeInput")];
  quickInputs.forEach((input) => {
    input.addEventListener("focus", keepQuickInputVisible);
    input.addEventListener("blur", () => {
      quickInputFocused = false;
    });
    input.addEventListener("input", () => {
      quickSavedPayer = null;
      clearQuickInputError(input);
    });
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleQuickInputVisibility);
    window.visualViewport.addEventListener("scroll", scheduleQuickInputVisibility);
  }

  $("payerInput").addEventListener("focus", () => {
    quickSavedPayer = null;
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
  $("placeInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPayment();
  });
  $("placeInput").addEventListener("input", updateSaveButtonText);

  $("savePaymentBtn").addEventListener("click", addPayment);
  $("clearPaymentsBtn").addEventListener("click", clearPaymentsOnly);

  $("targetAllToggleBtn").addEventListener("click", () => {
    const targets = getTargets();
    const allSelected = state.names.length > 0 && targets.length === state.names.length;

    applyGlobalTargets(allSelected ? [] : state.names.slice());
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

  $("createPngBtn").addEventListener("click", prepareShareImage);
  $("sharePngBtn").addEventListener("click", sharePreparedImage);
  $("downloadPngBtn").addEventListener("click", downloadPreparedImage);
  $("closeSharePanelBtn").addEventListener("click", () => {
    $("sharePanel").hidden = true;
  });

  $("resetBtn").addEventListener("click", resetAll);
  window.addEventListener("beforeunload", () => {
    if (preparedShare?.url) URL.revokeObjectURL(preparedShare.url);
  });
}

loadState();
normalizeState();
bindEvents();
render();
if (startupStorageMessage) showToast(startupStorageMessage);
