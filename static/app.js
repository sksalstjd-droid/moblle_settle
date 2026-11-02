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
let confirmReturnFocus = null;
let confirmFallbackFocus = null;
let confirmAction = null;
let confirmBusy = false;

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

function clearQuickInputErrors() {
  document.querySelectorAll(".quick-input-fields input").forEach(clearQuickInputError);
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
  if (!$("sharePanel").hidden) { $("sharePanel").hidden = true; return; }
  if (preparedShare?.fingerprint === shareFingerprint()) { $("sharePanel").hidden = false; return; }
  const fingerprint = shareFingerprint();
  const calculation = calcResult();
  const model = buildShareModel(state, calculation);
  if (!model.ok || !state.payments.length) {
    showToast(model.errors?.length ? "정산 결과를 확인한 뒤 이미지를 만들어주세요." : "결제 내역을 추가한 뒤 이미지를 만들어주세요.");
    return;
  }

  const button = $("createPngBtn");
  button.disabled = true;
  button.textContent = "이미지 생성 중…";
  $("sharePanel").hidden = false;
  $("shareStatus").textContent = "이미지를 생성하고 있어요.";

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const report = await createPngReport(model);
    if (fingerprint !== shareFingerprint()) { invalidateShareImage(); return; }
    invalidateShareImage();
    const fileName = shareFileName();
    const file = new File([report.blob], fileName, { type: "image/png" });
    const url = URL.createObjectURL(report.blob);
    preparedShare = { ...report, file, fileName, url, fingerprint: shareFingerprint() };
    $("sharePreview").src = url;
    $("sharePanel").hidden = false;

    $("shareStatus").textContent = "";
  } catch (error) {
    invalidateShareImage();
    $("sharePanel").hidden = false;
    $("shareStatus").textContent = "PNG 생성에 실패했어요. 다시 시도해주세요.";
    showToast("PNG 생성에 실패했어요.");
  } finally {
    button.disabled = false;
    button.textContent = "이미지 공유";
  }
}

function hasFreshShareImage() {
  if (preparedShare && preparedShare.fingerprint === shareFingerprint()) return true;
  invalidateShareImage();
  showToast("정산 내용이 바뀌었어요. PNG를 다시 만들어주세요.");
  return false;
}

function downloadPreparedImage() {
  if (!hasFreshShareImage()) return;
  const result = requestDownload(document, preparedShare.url, preparedShare.fileName);
  $("shareStatus").textContent = result.status === "requested"
    ? ""
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
  $("summaryTotalAmount").textContent = won(calculation.total);
  $("summaryPaymentCount").textContent = `${state.payments.length}건`;
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
    button.style.color = colorOf(name);
    button.addEventListener("click", () => {
      quickSavedPayer = null;
      clearQuickInputErrors();
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
        <span>결제</span>
        <strong>${won(paid[name] || 0)}</strong>
      </div>
      <button class="delete-btn">삭제</button>
    `;

    card.querySelector("button").addEventListener("click", () => {
      openConfirmDialog({
        title: "멤버 삭제",
        message: "이 멤버를 삭제할까요?",
        detail: `${name}\n이 멤버가 결제한 내역도 함께 삭제됩니다.`,
        actionLabel: "삭제",
        fallbackFocus: list,
        onConfirm: () => {
          const result = removeMember(state, name);
          if (!result.ok) {
            if (result.reason === "empty-custom-participants") {
              const payment = result.blockingPayments[0];
              const label = payment.place || `${payment.payer} · ${won(payment.amount)}`;
              showToast(`삭제할 수 없어요. '${label}' 결제에 이 멤버만 비용을 나눠 부담하도록 설정돼 있어요.`);
            }
            return false;
          }
          return commitState(result.state, () => {
            if (!state.payments.some((payment) => payment.id === editingPaymentId)) editingPaymentId = null;
            if (!state.payments.some((payment) => payment.id === exceptionEditingPaymentId)) {
              exceptionEditingPaymentId = null;
            }
            showToast("멤버를 삭제했어요.");
          });
        },
      });
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

function openConfirmDialog(options) {
  if (confirmAction || confirmBusy) return;
  const dialog = $("confirmDialog");
  confirmReturnFocus = document.activeElement;
  confirmFallbackFocus = options.fallbackFocus || $("tabInput");
  confirmAction = options.onConfirm;
  $("confirmDialogTitle").textContent = options.title;
  $("confirmDialogMessage").textContent = options.message;
  const detail = $("confirmDialogDetail");
  detail.textContent = options.detail || "";
  detail.hidden = !options.detail;
  const actionButton = $("confirmActionBtn");
  actionButton.textContent = options.actionLabel || "삭제";
  actionButton.disabled = false;
  $("confirmCancelBtn").disabled = false;
  dialog.hidden = false;
  $("confirmCancelBtn").focus();
}

function closeConfirmDialog() {
  const dialog = $("confirmDialog");
  if (dialog.hidden) return;
  dialog.hidden = true;
  confirmAction = null;
  confirmBusy = false;
  $("confirmActionBtn").disabled = false;
  $("confirmCancelBtn").disabled = false;
  const focusTarget = confirmReturnFocus?.isConnected ? confirmReturnFocus : confirmFallbackFocus;
  if (focusTarget?.isConnected) {
    if (focusTarget === confirmFallbackFocus) focusTarget.tabIndex = -1;
    focusTarget.focus();
  }
  confirmReturnFocus = null;
  confirmFallbackFocus = null;
}

function confirmDialogAction() {
  if (confirmBusy || typeof confirmAction !== "function") return;
  confirmBusy = true;
  $("confirmActionBtn").disabled = true;
  $("confirmCancelBtn").disabled = true;
  try {
    confirmAction();
  } catch {
    showToast("작업을 완료하지 못했어요. 다시 시도해주세요.");
  }
  closeConfirmDialog();
}

function bindConfirmDialog() {
  const dialog = $("confirmDialog");
  $("confirmCancelBtn").addEventListener("click", closeConfirmDialog);
  $("confirmActionBtn").addEventListener("click", confirmDialogAction);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeConfirmDialog();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [$("confirmCancelBtn"), $("confirmActionBtn")].filter((button) => !button.disabled);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
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

  const saved = saveStateToStorage(localStorage, STORAGE_KEY, result.state);
  if (!saved.ok) {
    showToast("저장하지 못했어요. 수정 내용을 확인한 뒤 다시 시도해주세요.");
    return;
  }
  state = result.state;
  editingPaymentId = null;
  invalidateShareImage();
  render();
  showToast("결제 내역을 수정했어요.");
}

function createPaymentEditPanel(payment) {
  const panel = document.createElement("div");
  panel.className = "payment-edit-panel";
  panel.dataset.editPaymentId = payment.id;

  const firstRow = document.createElement("div");
  firstRow.className = "payment-edit-row payment-edit-row-primary";
  const secondRow = document.createElement("div");
  secondRow.className = "payment-edit-row payment-edit-row-secondary";

  const nameInput = document.createElement("input");
  nameInput.className = "payment-edit-input payment-edit-name";
  nameInput.id = `edit-payer-${payment.id}`;
  nameInput.value = payment.payer;
  nameInput.placeholder = "결제자";

  const amountInput = document.createElement("input");
  amountInput.className = "payment-edit-input payment-edit-amount";
  amountInput.id = `edit-amount-${payment.id}`;
  amountInput.value = payment.amount.toLocaleString("ko-KR");
  amountInput.placeholder = "금액";
  amountInput.inputMode = "numeric";
  amountInput.addEventListener("input", () => {
    const amount = parseAmount(amountInput.value);
    amountInput.value = amount ? amount.toLocaleString("ko-KR") : "";
  });

  const placeInput = document.createElement("input");
  placeInput.className = "payment-edit-input payment-edit-place";
  placeInput.id = `edit-place-${payment.id}`;
  placeInput.value = payment.place;
  placeInput.placeholder = "사용처 (선택)";

  function editField(labelText, input) {
    const field = document.createElement("div");
    field.className = "payment-edit-field";
    const label = document.createElement("label");
    label.className = "payment-edit-label";
    label.htmlFor = input.id;
    label.textContent = labelText;
    field.append(label, input);
    return field;
  }

  firstRow.append(editField("이름", nameInput), editField("금액", amountInput));
  secondRow.append(editField("사용처", placeInput));

  const actions = document.createElement("div");
  actions.className = "payment-edit-actions";
  const cancelButton = document.createElement("button");
  cancelButton.className = "small-btn";
  cancelButton.textContent = "취소";
  cancelButton.addEventListener("click", cancelPaymentEdit);
  const saveButton = document.createElement("button");
  saveButton.className = "small-btn primary";
  saveButton.textContent = "저장";
  saveButton.addEventListener("click", () => savePaymentEdit(payment.id, panel));
  actions.append(cancelButton, saveButton);
  secondRow.appendChild(actions);

  [nameInput, amountInput, placeInput].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") savePaymentEdit(payment.id, panel);
      if (event.key === "Escape") cancelPaymentEdit();
    });
  });

  panel.append(firstRow, secondRow);
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

    const placeMeta = payment.place ? `<div class="item-meta">${escapeHtml(payment.place)}</div>` : "";
    card.innerHTML = `
      <div class="item-main">
        <div class="item-title" style="color:${colorOf(payment.payer)};">${escapeHtml(payment.payer)}</div>
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
      const detailLines = [`${payment.payer} · ${won(payment.amount)}`];
      if (payment.place) detailLines.push(payment.place);
      openConfirmDialog({
        title: "결제 내역 삭제",
        message: "이 결제 내역을 삭제할까요?",
        detail: detailLines.join("\n"),
        actionLabel: "삭제",
        fallbackFocus: list,
        onConfirm: () => commitState({
          ...state,
          payments: state.payments.filter((item) => item.id !== payment.id),
        }, () => {
          if (editingPaymentId === payment.id) editingPaymentId = null;
          if (exceptionEditingPaymentId === payment.id) exceptionEditingPaymentId = null;
          showToast("결제 내역을 삭제했어요.");
        }),
      });
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
  const targetCountBadge = $("targetCountBadge");
  targetCountBadge.replaceChildren();
  const selectedCount = document.createElement("span");
  selectedCount.textContent = `${targetCount}명 선택`;
  const memberCount = document.createElement("span");
  memberCount.textContent = `전체 ${totalCount}명`;
  targetCountBadge.append(selectedCount, memberCount);
  list.innerHTML = "";

  if (!state.names.length) {
    list.innerHTML = `<p class="empty-text">멤버를 먼저 추가하세요.</p>`;
    return;
  }

  state.names.forEach((name) => {
    const checked = state.targets[name] !== false;
    const button = document.createElement("button");

    button.className = `chip target-chip ${checked ? "active" : "inactive"}`;
    button.textContent = name;
    button.setAttribute("aria-pressed", String(checked));
    if (checked) {
      button.style.borderColor = colorOf(name);
      button.style.color = colorOf(name);
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
      showToast("'" + (excludedName || "선택한 멤버") + "' 제외 시 '" + label + "' 결제의 정산 인원이 0명이 됩니다.");
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
    ? payment.participants.slice()
    : getTargets();
  const selected = new Set(current);
  if (selected.has(name)) selected.delete(name);
  else selected.add(name);
  const activeSelectedCount = state.names.filter((member) => (
    state.targets[member] !== false && selected.has(member)
  )).length;
  if (activeSelectedCount === 0) {
    button.classList.add("blocked");
    button.setAttribute("aria-invalid", "true");
    window.setTimeout(() => {
      button.classList.remove("blocked");
      button.removeAttribute("aria-invalid");
    }, 800);
    showToast("정산 인원은 한 명 이상 선택해야 해요.");
    return;
  }
  const result = setCustomParticipants(state, payment.id, state.names.filter((member) => selected.has(member)));
  if (!result.ok) {
    showToast("정산 인원 설정을 저장하지 못했어요.");
    return;
  }
  commitState(result.state);
}

function renderExceptions(calculation = calcResult()) {
  const list = $("exceptionPaymentList");
  const editor = $("exceptionEditor");
  const customCount = state.payments.filter((payment) => payment.participantMode === "custom").length;
  $("customPaymentCountBadge").textContent = `${customCount}건`;
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
    label.className = "exception-payment-label";
    const payer = document.createElement("span");
    payer.className = "exception-payment-payer";
    payer.textContent = payment.payer;
    label.appendChild(payer);
    if (payment.place) {
      const place = document.createElement("span");
      place.className = "exception-payment-place";
      place.textContent = payment.place;
      label.appendChild(place);
    }
    if (payment.participantMode === "custom") {
      const paymentDetail = calculation.paymentDetails.find((detail) => (
        detail.type === "custom-payment" && detail.paymentId === payment.id
      ));
      const participantCount = paymentDetail?.participants.length;
      if (Number.isInteger(participantCount) && participantCount > 0) {
        const badge = document.createElement("span");
        badge.className = "participant-count-badge";
        badge.textContent = `${participantCount}명`;
        label.append(" ", badge);
      }
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
  const title = document.createElement("div");
  title.className = "exception-editor-heading";
  const paymentTitle = document.createElement("p");
  paymentTitle.className = "exception-editor-title";
  paymentTitle.textContent = selectedPayment.place || selectedPayment.payer;
  const subtitle = document.createElement("p");
  subtitle.className = "exception-editor-subtitle";
  subtitle.textContent = "정산 인원 선택";
  title.append(paymentTitle, subtitle);
  const chips = document.createElement("div");
  chips.className = "target-chip-wrap";

  state.names.forEach((name) => {
    const locked = state.targets[name] === false;
    const selected = selectedPayment.participantMode === "custom"
      ? selectedPayment.participants.includes(name)
      : !locked;
    const checked = selected && !locked;
    const button = document.createElement("button");
    button.className = `chip target-chip ${locked ? "locked" : checked ? "active" : "inactive"}`;
    button.textContent = name;
    button.disabled = locked;
    button.setAttribute("aria-pressed", String(checked));
    if (checked) {
      button.style.borderColor = colorOf(name);
      button.style.color = colorOf(name);
    }
    button.addEventListener("click", () => {
      togglePaymentParticipant(selectedPayment, name, button);
    });
    chips.appendChild(button);
  });
  card.append(title, chips);
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
        ? "선택한 결제의 정산 인원을 전역 정산 대상자 중에서 한 명 이상 선택해주세요."
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
  renderSummary(calculation);
  renderPayerButtons();
  renderMembers();
  renderPayments();
  renderTargets();
  renderExceptions(calculation);
  renderResult(calculation);
  updateSaveButtonText();
}

function saveAndRender() {
  invalidateShareImage();
  normalizeState();
  saveState();
  render();
}

function commitState(nextState, onSuccess) {
  const result = saveStateToStorage(localStorage, STORAGE_KEY, nextState);
  if (!result.ok) {
    showToast("저장하지 못했어요. 변경 전 상태를 유지합니다.");
    render();
    return false;
  }
  state = nextState;
  if (typeof onSuccess === "function") onSuccess();
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
  bindConfirmDialog();

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
