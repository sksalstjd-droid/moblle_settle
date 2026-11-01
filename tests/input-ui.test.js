const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "templates/index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "static/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "static/style.css"), "utf8");

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

test("요청한 입력 탭 문구만 바뀌고 상단 총 결제액 요약을 유지한다", () => {
  assert.doesNotMatch(appSource, /맞춤 포함|빠른 이름 선택/);
  assert.match(appSource, /<span>결제<\/span>[\s\S]*?won\(paid\[name\]/);
  assert.match(appSource, /summaryPrimaryLabel"\)\.textContent = "총 결제액"/);
  assert.match(appSource, /summaryTargetCount"\)\.textContent = `\$\{state\.payments\.length\}건 · 예외 \$\{customCount\}건`/);
});

test("최근 결제 행에서만 예외 배지를 빼고 결과 탭의 예외 표시는 유지한다", () => {
  const paymentListSource = appSource.match(/function renderPayments\([\s\S]*?\n}\n\nfunction renderTargets/)?.[0] || "";
  const exceptionSource = appSource.match(/function renderExceptions\([\s\S]*?\n}\n\nfunction renderResult/)?.[0] || "";
  assert.doesNotMatch(paymentListSource, /customBadge|custom-badge/);
  assert.match(exceptionSource, /badge\.className = "custom-badge"/);
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
  assert.match(appSource, /amountInput\.value = "";[\s\S]*?\$\("placeInput"\)\.value = "";[\s\S]*?amountInput\.focus/);
});

test("예외 부담자 선택은 즉시 저장하고 전역 제외자를 잠금 표시한다", () => {
  assert.match(appSource, /function togglePaymentParticipant\([\s\S]*?setCustomParticipants\([\s\S]*?commitState\(result\.state\)/);
  assert.match(appSource, /function commitState\(nextState(?:, onSuccess)?\)[\s\S]*?saveStateToStorage\(localStorage, STORAGE_KEY, nextState\)[\s\S]*?if \(!result\.ok\)[\s\S]*?state = nextState/);
  assert.match(appSource, /button\.disabled = locked/);
  assert.match(appSource, /전체 정산 제외 🔒/);
  const exceptionsSource = appSource.match(/function renderExceptions\([\s\S]*?\n}\n\nfunction renderResult/)?.[0] || "";
  assert.doesNotMatch(exceptionsSource, /textContent = "적용"|textContent = "취소"|기본 정산으로 되돌리기/);
  assert.match(appSource, /selected\.size === 0[\s\S]*?부담자는 한 명 이상 선택해야 해요/);
  assert.match(css, /\.target-chip\.locked/);
});
