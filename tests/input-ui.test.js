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
