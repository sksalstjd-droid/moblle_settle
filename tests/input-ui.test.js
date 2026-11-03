const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const settlementCore = require("../static/settlement-core.js");

const root = path.join(__dirname, "..");
function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

const html = readSource("templates/index.html");
const appSource = readSource("static/app.js");
const css = readSource("static/style.css");

test("소스 읽기는 LF와 CRLF 줄바꿈을 같은 형식으로 정규화한다", () => {
  const source = "function sample() {\n  return true;\n}\n";
  assert.equal(source.replace(/\r\n?/g, "\n"), source);
  assert.equal(source.replace(/\n/g, "\r\n").replace(/\r\n?/g, "\n"), source);
});

test("입력 탭에는 이름·금액·사용처와 통합 저장 버튼이 항상 표시된다", () => {
  for (const id of ["payerInput", "amountInput", "placeInput", "savePaymentBtn"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
  }
  assert.doesNotMatch(html, /id="paymentOptions"|사용처 추가/);
  assert.match(html, /id="quickEntryForm"/);
  assert.match(html, /id="quickInputFeedback"[^>]+role="alert"/);
});

test("빠른 입력 필드는 세로 순서로 배치하고 이름 선택은 저장 버튼 아래에 둔다", () => {
  const fields = html.match(/<div class="quick-input-fields">([\s\S]*?)<\/div>\s*<button id="savePaymentBtn"/)?.[1] || "";
  const positions = ["payerInput", "amountInput", "placeInput"].map((id) => fields.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  assert.doesNotMatch(html, /quick-input-row/);
  assert.ok(html.indexOf("id=\"savePaymentBtn\"") < html.indexOf("id=\"payerButtons\""));
  assert.match(html, /<h3>이름 선택<\/h3>/);
  assert.match(css, /\.quick-input-fields\s*\{\s*display:\s*grid;/);
});

test("입력 탭 문구를 유지하고 빠른 입력의 기존 요약 기능은 변경하지 않는다", () => {
  assert.doesNotMatch(appSource, /맞춤 포함|빠른 이름 선택/);
  assert.match(appSource, /<span>결제<\/span>[\s\S]*?won\(paid\[name\]/);
  assert.match(html, /id="summaryTotalAmount"/);
  assert.match(html, /id="summaryPaymentCount"/);
  assert.match(appSource, /function renderSummary\(calculation\)[\s\S]*?summaryTotalAmount"\)\.textContent = won\(calculation\.total\)[\s\S]*?summaryPaymentCount"\)\.textContent = `\$\{state\.payments\.length\}건`/);
  assert.doesNotMatch(html.slice(0, html.indexOf('<nav class="tab-bar"')), /1인당|인원 변경|정산<\/span>/);
});

test("최근 결제 행에는 정산 인원 표시가 없고 결과 결제 목록에는 실제 인원수가 표시된다", () => {
  const paymentListSource = appSource.match(/function renderPayments\([\s\S]*?\n}\n\nfunction renderTargets/)?.[0] || "";
  const exceptionSource = appSource.match(/function renderExceptions\([\s\S]*?\n}\n\nfunction renderResult/)?.[0] || "";
  assert.doesNotMatch(paymentListSource, /customBadge|custom-badge/);
  assert.match(exceptionSource, /detail\.type === "custom-payment" && detail\.paymentId === payment\.id/);
  assert.match(exceptionSource, /paymentDetail\?\.participants\.length/);
  assert.match(exceptionSource, /badge\.className = "participant-count-badge"/);
  assert.match(exceptionSource, /badge\.textContent = `\$\{participantCount\}명`/);
  assert.match(exceptionSource, /Number\.isInteger\(participantCount\) && participantCount > 0/);
  assert.doesNotMatch(exceptionSource, /textContent = "개별"|custom-badge/);
});

test("결제 수정창은 이름·금액과 사용처·버튼의 2행 구조다", () => {
  const editSource = appSource.match(/function createPaymentEditPanel\([\s\S]*?\n}\n\nfunction renderPayments/)?.[0] || "";
  assert.match(editSource, /payment-edit-row-primary/);
  assert.match(editSource, /payment-edit-row-secondary/);
  assert.match(editSource, /editField\("이름", nameInput\), editField\("금액", amountInput\)/);
  assert.match(editSource, /editField\("사용처", placeInput\)/);
  assert.match(editSource, /amountInput\.addEventListener\("input"[\s\S]*?toLocaleString\("ko-KR"\)/);
  assert.match(editSource, /saveButton\.textContent = "저장"/);
  assert.match(editSource, /cancelButton\.textContent = "취소"/);
  assert.match(css, /\.payment-edit-row-primary\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.payment-edit-row-secondary\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.payment-edit-amount\s*\{\s*text-align:\s*right/);
  assert.match(css, /\.small-btn\s*\{\s*min-width:\s*52px/);
});

test("멤버·결제 삭제는 상세 정보가 있는 공통 앱 확인창을 사용한다", () => {
  const memberSource = appSource.match(/function renderMembers\([\s\S]*?\n}\n\nfunction startPaymentEdit/)?.[0] || "";
  const paymentSource = appSource.match(/function renderPayments\([\s\S]*?\n}\n\nfunction renderTargets/)?.[0] || "";
  assert.match(memberSource, /title: "멤버 삭제"/);
  assert.match(memberSource, /message: "이 멤버를 삭제할까요\?"/);
  assert.match(memberSource, /이 멤버가 결제한 내역도 함께 삭제됩니다/);
  assert.match(memberSource, /const result = removeMember\(state, name\)/);
  assert.match(paymentSource, /title: "결제 내역 삭제"/);
  assert.match(paymentSource, /message: "이 결제 내역을 삭제할까요\?"/);
  assert.match(paymentSource, /detailLines = \[.*payment\.payer.*won\(payment\.amount\)/);
  assert.match(paymentSource, /if \(payment\.place\) detailLines\.push\(payment\.place\)/);
  assert.doesNotMatch(memberSource + paymentSource, /confirm\(/);
  assert.match(appSource, /saveStateToStorage\(localStorage, STORAGE_KEY, nextState\)/);
});

test("삭제 확인창은 접근성, 취소·바깥 클릭·Escape, 포커스 복원을 제공한다", () => {
  assert.match(html, /id="confirmDialog"[^>]+hidden/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle"/);
  assert.match(html, /id="confirmDialogTitle"/);
  assert.match(html, /id="confirmCancelBtn"[^>]*>취소<\/button>/);
  assert.match(html, /id="confirmActionBtn"[^>]*>삭제<\/button>/);
  assert.match(appSource, /if \(event\.target === dialog\) closeConfirmDialog\(\)/);
  assert.match(appSource, /if \(event\.key === "Escape"\)[\s\S]*?closeConfirmDialog\(\)/);
  assert.match(appSource, /event\.shiftKey && document\.activeElement === first/);
  assert.match(appSource, /focusTarget\.focus\(\)/);
  assert.match(appSource, /confirmBusy \|\| typeof confirmAction/);
  assert.match(css, /\.confirm-dialog\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.confirm-delete-btn\s*\{\s*background:\s*var\(--danger\)/);
});

test("결제 입력은 개인정보 자동완성을 줄이고 숫자 키패드를 유지한다", () => {
  const payer = html.match(/<input[^>]+id="payerInput"[^>]*>/)?.[0] || "";
  const amount = html.match(/<input[^>]+id="amountInput"[^>]*>/)?.[0] || "";
  const place = html.match(/<input[^>]+id="placeInput"[^>]*>/)?.[0] || "";
  assert.match(payer, /autocomplete="off"/);
  assert.match(payer, /autocorrect="off"/);
  assert.match(payer, /spellcheck="false"/);
  assert.match(amount, /autocomplete="off"/);
  assert.match(amount, /inputmode="numeric"/);
  assert.match(place, /autocomplete="off"/);
  assert.match(place, /autocorrect="off"/);
});

test("멤버 관리의 별도 이름 추가 입력은 제거하고 기존 멤버 목록은 유지한다", () => {
  assert.doesNotMatch(html, /id="memberInput"|id="addMemberBtn"/);
  assert.match(html, /id="memberList"/);
  assert.match(appSource, /function addQuickMember\(/);
  assert.doesNotMatch(appSource, /function addMember\(/);
});

test("세 입력창이 같은 키보드 위치 보정과 오류 강조 경로를 사용한다", () => {
  assert.match(appSource, /const quickInputs = \[\$\("payerInput"\), \$\("amountInput"\), \$\("placeInput"\)\]/);
  assert.match(appSource, /window\.visualViewport\.addEventListener\("resize", scheduleQuickInputVisibility\)/);
  assert.match(appSource, /window\.visualViewport\.addEventListener\("scroll", scheduleQuickInputVisibility\)/);
  assert.match(appSource, /function showQuickInputError\(/);
  assert.match(css, /@keyframes quick-input-shake/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("빠른 입력은 금액·사용처·멤버 등록을 한 저장 경로로 연결하고 Enter를 보존한다", () => {
  assert.match(appSource, /const entry = classifyQuickEntry\(\{ payer: name, amount: amountInput\.value, place \}\)/);
  assert.match(appSource, /entry\.action === "add-member"/);
  assert.match(appSource, /const \{ payer, amount \} = entry;[\s\S]*?storeDefaultPayment/);
  assert.match(appSource, /if \(event\.key === "Enter"\) addPayment\(\)/);
  assert.match(appSource, /function formatAmountInput\(/);
  assert.match(appSource, /storeMemberAddition\(localStorage, STORAGE_KEY, state, name\)/);
  assert.equal((appSource.match(/if \(event\.key === "Enter"\) addPayment\(\)/g) || []).length, 3);
  assert.match(appSource, /\$\("payerButtons"\)[\s\S]*?\$\("amountInput"\)\.focus\(\)/);
  assert.match(appSource, /button\.addEventListener\("click", \(\) => \{[\s\S]*?clearQuickInputErrors\(\);[\s\S]*?payerInput"\)\.value = name;[\s\S]*?amountInput"\)\.focus\(\)/);
  assert.match(appSource, /amountInput\.value = "";[\s\S]*?\$\("placeInput"\)\.value = "";[\s\S]*?amountInput\.focus/);
});

test("기존 이름은 금액 입력 전까지 중복 등록을 막고, 금액 입력 후 결제를 허용한다", () => {
  const buttonStateSource = appSource.match(/function updateSaveButtonText\([\s\S]*?\n}\n\nfunction escapeHtml/)?.[0] || "";
  const addSource = appSource.match(/function addPayment\([\s\S]*?\n}\n\nfunction clearPaymentsOnly/)?.[0] || "";
  const chipSource = appSource.match(/function renderPayerButtons\([\s\S]*?\n}\n\nfunction renderMembers/)?.[0] || "";
  assert.match(chipSource, /clearQuickInputErrors\(\)/);
  assert.match(appSource, /function clearQuickInputErrors\(\)[\s\S]*?querySelectorAll\("\.quick-input-fields input"\)[\s\S]*?clearQuickInputError/);
  assert.match(buttonStateSource, /state\.names\.includes\(name\)\)\s*\{\s*button\.textContent = "금액 입력";\s*button\.disabled = true;\s*return;/);
  assert.doesNotMatch(buttonStateSource, /showQuickInputNotice/);
  assert.match(addSource, /if \(state\.names\.includes\(entry\.payer\)\)[\s\S]*?showQuickInputNotice\("이미 등록된 멤버/);
  assert.match(addSource, /entry\.action === "add-member"[\s\S]*?addQuickMember\(entry\.payer\)/);
  assert.match(appSource, /function addQuickMember\([\s\S]*?storeMemberAddition\(localStorage, STORAGE_KEY, state, name\)/);

  const updateFunction = buttonStateSource.split("\n\nfunction escapeHtml")[0];
  const button = { textContent: "", disabled: false };
  const feedback = { textContent: "" };
  const amount = { value: "" };
  const place = { value: "" };
  const context = {
    state: { names: ["민성"] },
    payer: "민성",
    $: (id) => ({ savePaymentBtn: button, quickInputFeedback: feedback, amountInput: amount, placeInput: place })[id],
    getPayerInputName: () => context.payer,
  };
  vm.runInNewContext(`${updateFunction}\nupdateSaveButtonText()`, context);
  assert.equal(button.textContent, "금액 입력");
  assert.equal(button.disabled, true);

  amount.value = "32000";
  vm.runInNewContext("updateSaveButtonText()", context);
  assert.equal(button.textContent, "결제 저장");
  assert.equal(button.disabled, false);

  amount.value = "";
  place.value = "";
  vm.runInNewContext("updateSaveButtonText()", context);
  assert.equal(button.textContent, "금액 입력");
  assert.equal(button.disabled, true);

  context.payer = "새 멤버";
  vm.runInNewContext("updateSaveButtonText()", context);
  assert.equal(button.textContent, "멤버 추가");
  assert.equal(button.disabled, false);

  const paymentAddFunction = appSource.match(/function addPayment\([\s\S]*?\n}\n\nfunction clearPaymentsOnly/)?.[0]
    .split("\n\nfunction clearPaymentsOnly")[0] || "";
  const savedButton = { textContent: "", disabled: false };
  const payerInput = { value: "민성" };
  const amountInput = { value: "32000", focus() {} };
  const placeInput = { value: "식당" };
  const feedbackInput = { textContent: "" };
  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const integration = {
    state: { schemaVersion: 2, names: ["민성"], payments: [], targets: { 민성: true }, lastPayer: "민성" },
    localStorage: storage,
    STORAGE_KEY: "test-state",
    classifyQuickEntry: settlementCore.classifyQuickEntry,
    storeDefaultPayment: settlementCore.storeDefaultPayment,
    createPaymentId: () => `payment-${stored.size + 1}`,
    getPayerInputName: () => payerInput.value,
    won: (value) => `${Number(value).toLocaleString("ko-KR")}원`,
    invalidateShareImage() {},
    clearQuickInputError() {},
    showQuickInputError() { assert.fail("valid input should not show an error"); },
    showQuickInputNotice(message) { assert.fail(message); },
    keepQuickInputVisible() {},
    showSaveSuccess(message) { savedButton.textContent = `✓ ${message}`; },
    render() { vm.runInNewContext("updateSaveButtonText()", integration); },
    $: (id) => ({ payerInput, amountInput, placeInput, quickInputFeedback: feedbackInput, savePaymentBtn: savedButton })[id],
  };
  vm.runInNewContext(`${updateFunction}\n${paymentAddFunction}\naddPayment()`, integration);
  assert.equal(integration.state.payments.length, 1);
  assert.equal(integration.state.payments[0].payer, "민성");
  assert.equal(payerInput.value, "민성");
  assert.equal(amountInput.value, "");
  assert.equal(placeInput.value, "");
  assert.equal(savedButton.disabled, true);
  assert.equal(savedButton.textContent, "✓ 민성 · 32,000원 저장됨");

  vm.runInNewContext("updateSaveButtonText()", integration); // 저장 완료 표시가 끝난 뒤 다음 입력 상태
  assert.equal(savedButton.textContent, "금액 입력");
  assert.equal(savedButton.disabled, true);

  amountInput.value = "5000";
  placeInput.value = "카페";
  vm.runInNewContext("updateSaveButtonText(); addPayment()", integration);
  assert.equal(integration.state.payments.length, 2);
  assert.equal(integration.state.payments[1].payer, "민성");
});

test("결제내역 및 전체 초기화는 공통 확인창을 쓰고 확인 전 데이터에 손대지 않는다", () => {
  const clearSource = appSource.match(/function clearPaymentsOnly\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const resetSource = appSource.match(/function resetAll\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const saveSource = appSource.match(/function saveAndRender\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(clearSource + resetSource, /confirm\(/);
  assert.match(clearSource, /openConfirmDialog\([\s\S]*?onConfirm: \(\) => \{[\s\S]*?state\.payments = \[\][\s\S]*?saveAndRender\(\)/);
  assert.match(resetSource, /openConfirmDialog\([\s\S]*?onConfirm: \(\) => \{[\s\S]*?state = createInitialState\(\)[\s\S]*?saveAndRender\(\)/);
  assert.match(saveSource, /saveState\(\)/);

  function harness(source, initialState) {
    let options = null;
    let saves = 0;
    let closed = 0;
    const context = {
      state: structuredClone(initialState),
      showAllPayments: true,
      editingPaymentId: "edit-1",
      exceptionEditingPaymentId: "exception-1",
      openConfirmDialog: (value) => { options = value; },
      $: (id) => ({ focus() {} }),
      saveAndRender: () => { saves += 1; },
      closeStartOverDetails: () => { closed += 1; },
      createInitialState: () => ({ names: [], payments: [], targets: {}, lastPayer: null }),
      window: { scrollY: 12, requestAnimationFrame: (fn) => fn(), scrollTo() {} },
    };
    vm.runInNewContext(`${source}\n${source.startsWith("function resetAll") ? "resetAll" : "clearPaymentsOnly"}()`, context);
    return { context, get options() { return options; }, confirm: () => options.onConfirm(), get saves() { return saves; }, get closed() { return closed; } };
  }

  const original = { names: ["A", "B"], payments: [{ payer: "A", amount: 100 }], targets: { A: true, B: false } };
  const clear = harness(clearSource, original);
  assert.equal(clear.context.state.payments.length, 1); // 취소 경로: 확인 콜백 미실행
  assert.equal(clear.options.actionLabel, "비우기");
  clear.confirm();
  assert.deepEqual(Array.from(clear.context.state.names), ["A", "B"]);
  assert.equal(clear.context.state.payments.length, 0);
  assert.deepEqual({ ...clear.context.state.targets }, original.targets);
  assert.equal(clear.saves, 1);
  assert.equal(clear.closed, 1);

  const reset = harness(resetSource, original);
  assert.deepEqual(Array.from(reset.context.state.names), ["A", "B"]); // 취소 경로
  assert.equal(reset.options.actionLabel, "초기화");
  reset.confirm();
  assert.deepEqual(Array.from(reset.context.state.names), []);
  assert.deepEqual(Array.from(reset.context.state.payments), []);
  assert.equal(reset.saves, 1);
  assert.equal(reset.closed, 1);

  const actionSource = appSource.match(/function confirmDialogAction\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  let actionCount = 0;
  const actionButton = { disabled: false };
  const cancelButton = { disabled: false };
  const actionContext = {
    confirmBusy: false,
    confirmAction: () => { actionCount += 1; },
    $: (id) => ({ confirmActionBtn: actionButton, confirmCancelBtn: cancelButton })[id],
    closeConfirmDialog() { actionContext.confirmAction = null; actionContext.confirmBusy = false; },
    showToast() {},
  };
  vm.runInNewContext(`${actionSource}\nconfirmDialogAction(); confirmDialogAction()`, actionContext);
  assert.equal(actionCount, 1);
});

test("새 정산 시작은 유지하고 멤버·결제 수 요약은 표시하지 않는다", () => {
  const startOver = html.match(/<section id="startOverCard"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(startOver, /새 정산 시작/);
  assert.match(startOver, /clearPaymentsBtn|resetBtn/);
  assert.doesNotMatch(startOver, /startOverSummary|멤버 [^<]*명|결제 [^<]*건/);
  assert.doesNotMatch(appSource, /function renderStartOverCard|startOverSummary/);
});

test("개별 정산 인원 선택은 즉시 저장하고 전역 제외자를 비활성화한다", () => {
  assert.match(appSource, /function togglePaymentParticipant\([\s\S]*?setCustomParticipants\([\s\S]*?commitState\(result\.state\)/);
  assert.match(appSource, /function commitState\(nextState(?:, onSuccess)?\)[\s\S]*?saveStateToStorage\(localStorage, STORAGE_KEY, nextState\)[\s\S]*?if \(!result\.ok\)[\s\S]*?state = nextState/);
  assert.match(appSource, /button\.disabled = locked/);
  assert.doesNotMatch(appSource, /전체 정산 제외|🔒/);
  assert.match(appSource, /button\.setAttribute\("aria-pressed", String\(checked\)\)/);
  const exceptionsSource = appSource.match(/function renderExceptions\([\s\S]*?\n}\n\nfunction renderResult/)?.[0] || "";
  assert.doesNotMatch(exceptionsSource, /textContent = "적용"|textContent = "취소"|기본 정산으로 되돌리기/);
  assert.match(appSource, /activeSelectedCount === 0[\s\S]*?정산 인원은 한 명 이상 선택해야 해요/);
  assert.match(css, /\.target-chip\.locked/);
  assert.doesNotMatch(css, /target-chip::after|content: "✓"|content: "✕"/);
  assert.match(appSource, /payment\.participants\.slice\(\)/);
  assert.match(appSource, /activeSelectedCount = state\.names\.filter\([\s\S]*?state\.targets\[member\] !== false && selected\.has\(member\)/);
});

test("결과 탭 상태 표현은 아이콘 없이 스타일과 이름만 사용하고 안내 문구를 제거한다", () => {
  const resultHtml = html.slice(html.indexOf('id="tabResult"'));
  const exceptionSource = appSource.match(/function renderExceptions\([\s\S]*?\n}\n\nfunction renderResult/)?.[0] || "";
  assert.match(resultHtml, /결제별 정산 인원/);
  assert.doesNotMatch(resultHtml, /필요한 결제만 선택해 부담자를 따로 지정할 수 있어요|자동 계산|결제별 예외 설정/);
  assert.match(appSource, /selectedCount\.textContent = `\$\{targetCount\}명 선택`/);
  assert.match(appSource, /memberCount\.textContent = `전체 \$\{totalCount\}명`/);
  assert.match(appSource, /button\.textContent = name;[\s\S]*?button\.disabled = locked/);
  assert.match(exceptionSource, /정산 인원 선택/);
  assert.doesNotMatch(exceptionSource, /textContent = `[^`]*[·|/][^`]*`|전체 정산 제외|부담자 선택|부담자 설정/);
  assert.match(css, /\.target-chip\.active\s*\{[\s\S]*?background:/);
  assert.match(css, /\.target-chip\.inactive\s*\{/);
  assert.match(css, /\.target-chip\.locked\s*\{/);
  assert.match(appSource, /className = `chip target-chip \$\{checked \? "active" : "inactive"\}`/);
  assert.match(appSource, /className = `chip target-chip \$\{locked \? "locked" : checked \? "active" : "inactive"\}`/);
  assert.match(appSource, /button\.style\.color = colorOf\(name\)/);
  assert.match(css, /\.chip\s*\{[\s\S]*?min-height:\s*32px[\s\S]*?padding:\s*0 10px[\s\S]*?font-size:\s*13px/);
  assert.match(css, /\.chip\s*\{[\s\S]*?background:\s*#eef2f7/);
  assert.match(css, /\.target-chip\.active\s*\{[\s\S]*?background:\s*#eef2f7/);
  assert.match(appSource, /function renderPayerButtons\([\s\S]*?button\.style\.borderColor = colorOf\(name\);\s*button\.style\.color = colorOf\(name\)/);
  assert.match(exceptionSource, /if \(checked\) \{\s*button\.style\.borderColor = colorOf\(name\);\s*button\.style\.color = colorOf\(name\);/);
  assert.match(css, /#payerButtons\s*\{[\s\S]*?gap:\s*7px/);
  assert.match(css, /\.target-chip-wrap\s*\{[\s\S]*?gap:\s*7px/);
  assert.match(css, /\.chip-wrap\s*\{[\s\S]*?gap:\s*5px/);
  assert.match(css, /\.target-chip\.inactive\s*\{[\s\S]*?background:\s*#fff/);
  assert.match(css, /\.target-chip\.locked\s*\{[\s\S]*?text-decoration:\s*line-through/);
  assert.match(css, /\.exception-editor-heading\s*\{[\s\S]*?display:\s*flex/);
});

test("결제별 정산 인원 제목 행은 건수와 펼침 상태를 함께 보여주고 접근성 토글을 제공한다", () => {
  const disclosure = html.match(/<details id="paymentExceptions"[\s\S]*?<\/details>/)?.[0] || "";
  assert.match(disclosure, /<summary aria-controls="exceptionContent" aria-expanded="false">/);
  assert.match(disclosure, /id="customPaymentCountBadge">0건/);
  assert.match(disclosure, /id="paymentExceptionsToggleLabel"[^>]*>펼치기/);
  assert.match(disclosure, /class="payment-exceptions-chevron" aria-hidden="true"/);
  assert.match(disclosure, /id="exceptionContent"/);
  assert.match(appSource, /paymentExceptions\.addEventListener\("toggle", updatePaymentExceptionsDisclosure\)/);
  assert.match(appSource, /paymentExceptionsSummary\.setAttribute\("aria-expanded", String\(expanded\)\)/);
  assert.match(appSource, /textContent = expanded \? "접기" : "펼치기"/);
  assert.match(css, /\.payment-exceptions-state\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.payment-exceptions\[open\] \.payment-exceptions-chevron/);
});

test("412px 모바일 폭에서 두 글자 이름 여섯 칩이 공통 스타일로 한 줄에 들어간다", () => {
  const availableWidth = 412 - 54;
  const twoCharacterChipWidth = (13 * 2) + (10 * 2) + (1 * 2);
  const chipGap = 7;
  const sixChipRowWidth = (twoCharacterChipWidth * 6) + (chipGap * 5);
  assert.ok(sixChipRowWidth <= availableWidth, `${sixChipRowWidth}px > ${availableWidth}px`);
  assert.match(css, /\.chip\s*\{[\s\S]*?padding:\s*0 10px/);
  assert.match(css, /#payerButtons\s*\{[\s\S]*?gap:\s*7px/);
  assert.match(css, /\.target-chip-wrap\s*\{[\s\S]*?gap:\s*7px/);
  assert.match(css, /\.chip\s*\{[\s\S]*?min-height:\s*32px/);
  assert.match(css, /\.target-chip-wrap\s*\{[\s\S]*?flex-wrap:\s*wrap/);
});

test("상단 요약, 대상자 개별 선택, 결과 버튼은 합의한 표시만 제공한다", () => {
  const summaryMarkup = html.slice(html.indexOf('<section class="summary-panel"'), html.indexOf('<nav class="tab-bar"'));
  const resultMarkup = html.slice(html.indexOf('id="tabResult"'));
  assert.match(summaryMarkup, /총 결제액/);
  assert.match(summaryMarkup, /결제 내역/);
  assert.doesNotMatch(summaryMarkup, /1인당|정산<|인원 변경|summaryTargetCount/);
  assert.doesNotMatch(resultMarkup, /targetAllToggleBtn|모두 포함|모두 제외/);
  assert.doesNotMatch(appSource, /targetAllToggleBtn/);
  assert.match(resultMarkup, /id="copyResultBtn"[^>]*>결과 복사<\/button>/);
  assert.match(resultMarkup, /id="createPngBtn"[^>]*>이미지 공유<\/button>/);
  assert.match(appSource, /button\.textContent = "이미지 공유"/);
  assert.doesNotMatch(resultMarkup, /결과 복사하기|PNG 공유 이미지 만들기/);
});
