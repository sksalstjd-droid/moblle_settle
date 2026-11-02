const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { calculateSettlement } = require("../static/settlement-core.js");
const {
  buildShareModel,
  buildCopyText,
  renderReportCanvas,
  createPngReport,
  shareFile,
  requestDownload,
} = require("../static/share-report.js");

test("ShareReport는 브라우저 window 전역에도 노출되고 HTML에서 app.js보다 먼저 로드된다", () => {
  const browserWindow = {};
  const context = vm.createContext({ window: browserWindow });
  const source = fs.readFileSync(path.join(__dirname, "../static/share-report.js"), "utf8");
  vm.runInContext(source, context);
  assert.equal(typeof browserWindow.ShareReport.buildShareModel, "function");

  const html = fs.readFileSync(path.join(__dirname, "../templates/index.html"), "utf8");
  const coreIndex = html.indexOf("filename='settlement-core.js'");
  const shareIndex = html.indexOf("filename='share-report.js'");
  const appIndex = html.indexOf("filename='app.js'");
  assert.ok(coreIndex >= 0 && shareIndex > coreIndex && appIndex > shareIndex);
});

test("Flask가 반환하는 실제 HTML에 세 스크립트가 올바른 순서로 포함된다", () => {
  const result = spawnSync("python", ["-B", "-c", [
    "from app import app",
    "response = app.test_client().get('/')",
    "print(response.get_data(as_text=True))",
  ].join("; ")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const html = result.stdout;
  const coreIndex = html.indexOf("/static/settlement-core.js");
  const shareIndex = html.indexOf("/static/share-report.js");
  const appIndex = html.indexOf("/static/app.js");
  assert.ok(coreIndex >= 0 && shareIndex > coreIndex && appIndex > shareIndex);
});

test("개발 모드에서만 모바일 Live Reload 스크립트와 변경 지문을 제공한다", () => {
  const result = spawnSync("python", ["-B", "-c", [
    "import json",
    "from app import app",
    "client = app.test_client()",
    "page = client.get('/')",
    "revision = client.get('/__dev/revision')",
    "static = client.get('/static/app.js')",
    "print(json.dumps({'enabled': app.config['DEV_LIVE_RELOAD'], 'template_reload': app.config['TEMPLATES_AUTO_RELOAD'], 'html': page.get_data(as_text=True), 'revision_status': revision.status_code, 'revision': revision.get_json(silent=True), 'cache_control': revision.headers.get('Cache-Control', ''), 'static_cache_control': static.headers.get('Cache-Control', '')}))",
  ].join("; ")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, SETTLE_DEV: "1", RENDER: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.enabled, true);
  assert.equal(payload.template_reload, true);
  assert.match(payload.html, /static\/dev-live-reload\.js/);
  assert.match(payload.html, /data-server-id="\d+"/);
  assert.equal(payload.revision_status, 200);
  assert.match(payload.revision.revision, /^[a-f0-9]{64}$/);
  assert.match(payload.revision.server_id, /^\d+$/);
  assert.match(payload.cache_control, /no-store/);
  assert.match(payload.static_cache_control, /no-store/);
});

test("Render 환경에서는 개발 Live Reload 경로를 비활성화한다", () => {
  const result = spawnSync("python", ["-B", "-c", [
    "import json",
    "from app import app",
    "client = app.test_client()",
    "page = client.get('/')",
    "revision = client.get('/__dev/revision')",
    "print(json.dumps({'enabled': app.config['DEV_LIVE_RELOAD'], 'template_reload': app.config['TEMPLATES_AUTO_RELOAD'], 'html': page.get_data(as_text=True), 'revision_status': revision.status_code}))",
  ].join("; ")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, SETTLE_DEV: "1", RENDER: "true" },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.enabled, false);
  assert.equal(payload.template_reload, false);
  assert.doesNotMatch(payload.html, /static\/dev-live-reload\.js/);
  assert.equal(payload.revision_status, 404);
});

test("개발 서버는 Python 자동 재시작만 켜고 대화형 디버거를 끈다", () => {
  const result = spawnSync("python", ["-B", "-c", [
    "import json, os, runpy",
    "from unittest.mock import patch",
    "with patch('flask.Flask.run') as run:",
    " runpy.run_path('app.py', run_name='__main__')",
    " print(json.dumps(run.call_args.kwargs))",
  ].join("\n")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, SETTLE_DEV: "1", RENDER: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  const options = JSON.parse(result.stdout);
  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.debug, false);
  assert.equal(options.use_debugger, false);
  assert.equal(options.use_reloader, true);
});

test("Windows 자동 시작용 포트 검사는 Windows PowerShell에서 지원되는 방식으로 소켓을 닫는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../run-local.ps1"), "utf8");
  assert.match(source, /TcpListener\]::new/);
  assert.match(source, /\$probe\.Stop\(\)/);
  assert.doesNotMatch(source, /\$probe\.Dispose\(\)/);
  assert.match(source, /\$env:SETTLE_DEV = "1"/);
  assert.match(source, /\$env:FLASK_DEBUG = "0"/);
});

test("Live Reload는 안정된 파일·서버 변경을 감지하고 백그라운드 복귀 즉시 다시 확인한다", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../static/dev-live-reload.js"), "utf8");
  function createHarness(pageServerId, initialPayload) {
    let current = { ...initialPayload };
    let failRequests = false;
    let reloadCount = 0;
    let timerId = 0;
    const timers = new Map();
    const documentListeners = {};
    const document = {
      hidden: false,
      currentScript: { dataset: { serverId: pageServerId } },
      addEventListener: (name, callback) => { documentListeners[name] = callback; },
    };
    const window = {
      location: { reload: () => { reloadCount += 1; } },
      addEventListener() {},
      setTimeout: (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    };
    vm.runInNewContext(source, {
      document,
      window,
      fetch: async () => {
        if (failRequests) throw new Error("connection temporarily unavailable");
        return { ok: true, json: async () => ({ ...current }) };
      },
    });
    return {
      document,
      documentListeners,
      timers,
      setCurrent: (payload) => { current = { ...payload }; },
      setRequestFailure: (value) => { failRequests = value; },
      reloads: () => reloadCount,
      async runNextTimer() {
        const next = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay)[0];
        assert.ok(next, "expected a scheduled check");
        timers.delete(next[0]);
        next[1].callback();
        await new Promise((resolve) => setImmediate(resolve));
      },
      async resume() {
        document.hidden = false;
        documentListeners.visibilitychange();
        await new Promise((resolve) => setImmediate(resolve));
      },
      hide() {
        document.hidden = true;
        documentListeners.visibilitychange();
      },
    };
  }

  // Unchanged content stays put; a real content change needs two matching polls.
  const files = createHarness("10", { revision: "first", server_id: "10" });
  await files.runNextTimer();
  assert.equal(files.reloads(), 0);
  files.setCurrent({ revision: "second", server_id: "10" });
  await files.runNextTimer();
  assert.equal(files.reloads(), 0);
  await files.runNextTimer();
  assert.equal(files.reloads(), 1);

  // A Python reloader restart changes the server id even if asset hashes match.
  const restarted = createHarness("10", { revision: "same", server_id: "11" });
  await restarted.runNextTimer();
  await restarted.runNextTimer();
  assert.equal(restarted.reloads(), 1);

  // A page returning from the background polls immediately and then confirms.
  const resumed = createHarness("20", { revision: "one", server_id: "20" });
  await resumed.runNextTimer();
  resumed.hide();
  resumed.setCurrent({ revision: "two", server_id: "20" });
  await resumed.resume();
  assert.equal(resumed.reloads(), 0);
  await resumed.runNextTimer();
  assert.equal(resumed.reloads(), 1);

  // Temporary server unavailability is retried and the restarted process is noticed.
  const reconnect = createHarness("30", { revision: "same", server_id: "30" });
  await reconnect.runNextTimer();
  reconnect.setRequestFailure(true);
  await reconnect.runNextTimer();
  reconnect.setRequestFailure(false);
  reconnect.setCurrent({ revision: "same", server_id: "31" });
  await reconnect.runNextTimer();
  await reconnect.runNextTimer();
  assert.equal(reconnect.reloads(), 1);
});

function stateOf(names, payments, targets = {}) {
  return {
    schemaVersion: 2,
    names,
    targets: Object.fromEntries(names.map((name) => [name, targets[name] !== false])),
    lastPayer: names[0] || null,
    payments: payments.map((payment, index) => ({
      id: payment.id || `p${index + 1}`,
      payer: payment.payer,
      amount: payment.amount,
      place: payment.place || "",
      participantMode: payment.participantMode || "default",
      participants: payment.participantMode === "custom" ? payment.participants : null,
    })),
  };
}

function reportFor(state) {
  const calculation = calculateSettlement(state);
  return { calculation, model: buildShareModel(state, calculation) };
}

function fakeCanvasFactory(options = {}) {
  return () => {
    const context = {
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "top",
      measureText: (value) => ({ width: String(value).length * 14 }),
      quadraticCurveTo() {}, scale() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
    };
    return {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback) => callback(options.nullBlob ? null : new Blob(["png"], { type: "image/png" })),
    };
  };
}

test("일반 정산 텍스트 형식을 보존한다", () => {
  const state = stateOf(["A", "B"], [{ payer: "A", amount: 10000 }]);
  const text = buildCopyText(state, calculateSettlement(state));
  assert.equal(text, [
    "🧾 정산 결과",
    "",
    "총액: 10,000원",
    "1인당: 5,000원 (2명 기준)",
    "",
    "[보낼 돈]",
    "",
    "[B] → A 5,000원",
  ].join("\n"));
});

test("예외 정산 텍스트는 공통 1인당을 표시하지 않고 사용처와 부담자를 구분한다", () => {
  const state = stateOf(["A", "B", "C"], [
    { payer: "A", amount: 9000, place: "식당" },
    { payer: "B", amount: 3000, participantMode: "custom", participants: ["A", "C"] },
  ]);
  const text = buildCopyText(state, calculateSettlement(state));
  assert.equal(text.includes("1인당:"), false);
  assert.match(text, /식당 · 9,000원 · 결제 A/);
  assert.match(text, /결제 2 · 3,000원 · 결제 B/);
  assert.match(text, /부담: A, C/);
});

test("custom 설정이어도 실제 부담자 구성이 같으면 공통 부담자로 요약한다", () => {
  const state = stateOf(["A", "B", "C"], [
    { payer: "A", amount: 6000 },
    { payer: "B", amount: 3000, participantMode: "custom", participants: ["A", "B", "C"] },
  ]);
  const { model } = reportFor(state);
  assert.equal(model.uniformParticipants, true);
  assert.deepEqual(model.commonParticipants, ["A", "B", "C"]);
  const text = buildCopyText(state, calculateSettlement(state));
  assert.match(text, /공통 부담자: A, B, C/);
  assert.equal(text.includes("1인당:"), false);
});

test("일부 결제의 실제 부담자가 다르면 결제별 관계를 만든다", () => {
  const state = stateOf(["A", "B", "C"], [
    { payer: "A", amount: 6000 },
    { payer: "B", amount: 3000, participantMode: "custom", participants: ["A", "B"] },
  ]);
  const { model } = reportFor(state);
  assert.equal(model.uniformParticipants, false);
  assert.deepEqual(model.payments[1].participants, ["A", "B"]);
});

test("결제자가 부담자가 아닌 결제를 정확히 표현한다", () => {
  const state = stateOf(["A", "B", "C"], [
    { payer: "A", amount: 4000, place: "카페", participantMode: "custom", participants: ["B", "C"] },
  ]);
  const { model } = reportFor(state);
  assert.equal(model.payments[0].payer, "A");
  assert.deepEqual(model.payments[0].participants, ["B", "C"]);
  assert.equal(model.members.find((member) => member.name === "A").status, "receive");
});

test("송금이 없으면 정산할 내역 없음으로 표시한다", () => {
  const state = stateOf(["A"], [{ payer: "A", amount: 1000 }]);
  const { calculation, model } = reportFor(state);
  assert.deepEqual(model.transfers, []);
  assert.match(buildCopyText(state, calculation), /정산할 내역 없음/);
});

test("PNG 레이아웃은 송금 내역을 먼저 보여주고 결제별 실제 정산액을 표에 담는다", () => {
  const state = stateOf(["A", "B"], [{ payer: "A", amount: 10000, place: "긴 식당 이름" }]);
  const { model } = reportFor(state);
  const rendered = renderReportCanvas(model, { canvasFactory: fakeCanvasFactory() });
  const output = rendered.commands.filter((command) => command.type === "text").map((command) => command.value).join("\n");
  const transfersHeading = output.indexOf("최종 송금");
  const matrixHeading = output.indexOf("정산 상세");
  assert.ok(transfersHeading >= 0 && transfersHeading < matrixHeading);
  assert.match(output, /정산 결과/);
  assert.match(output, /총 결제액  10,000원/);
  assert.match(output, /긴 식당 이름/);
  assert.doesNotMatch(output, /결제 A/);
  assert.match(output, /정산액/);
  assert.equal(model.payments[0].amountsByMember.A, 5000);
  assert.equal(model.payments[0].amountsByMember.B, 5000);
  assert.ok(output.includes("A") && output.includes("5,000원"));
  assert.ok(rendered.logicalHeight > 0);
  assert.ok(rendered.canvas.width > 0);
});

test("긴 이름·긴 사용처·많은 결제도 동적 높이로 렌더링한다", () => {
  const names = Array.from({ length: 10 }, (_, index) => `아주긴참여자이름${index + 1}`);
  const payments = Array.from({ length: 24 }, (_, index) => ({
    payer: names[index % names.length],
    amount: 1000 + index,
    place: `아주 긴 사용처 이름 ${index + 1}호점`,
    participantMode: index % 2 ? "custom" : "default",
    participants: index % 2 ? names.filter((_, memberIndex) => memberIndex % 2 === 0) : undefined,
  }));
  const { model } = reportFor(stateOf(names, payments));
  const rendered = renderReportCanvas(model, { canvasFactory: fakeCanvasFactory() });
  assert.ok(rendered.logicalHeight > 2000);
  assert.ok(rendered.canvas.width * rendered.canvas.height <= 24000000 + rendered.canvas.width);
});

test("PNG Blob을 생성하고 null Blob 오류를 처리한다", async () => {
  const state = stateOf(["A"], [{ payer: "A", amount: 1000 }]);
  const { model } = reportFor(state);
  const report = await createPngReport(model, { canvasFactory: fakeCanvasFactory() });
  assert.equal(report.blob.type, "image/png");
  await assert.rejects(
    createPngReport(model, { canvasFactory: fakeCanvasFactory({ nullBlob: true }) }),
    /PNG 데이터를 만들지 못했습니다/,
  );
});

test("공유 API 지원·미지원·취소·실패를 구분한다", async () => {
  const file = { name: "report.png" };
  assert.deepEqual(await shareFile({}, file), { status: "unsupported" });
  assert.deepEqual(await shareFile({ canShare: () => false, share: async () => {} }, file), { status: "unsupported" });
  assert.deepEqual(await shareFile({ canShare: () => true, share: async () => {} }, file), { status: "shared" });
  assert.deepEqual(
    await shareFile({ canShare: () => true, share: async () => { const error = new Error("cancel"); error.name = "AbortError"; throw error; } }, file),
    { status: "canceled" },
  );
  const failed = await shareFile({ canShare: () => true, share: async () => { throw new Error("fail"); } }, file);
  assert.equal(failed.status, "failed");
  const canShareFailed = await shareFile({ canShare: () => { throw new Error("bad data"); }, share: async () => {} }, file);
  assert.equal(canShareFailed.status, "failed");
});

test("PNG 다운로드 요청과 미지원 분기를 처리한다", () => {
  let clicked = false;
  let appended = false;
  const link = { download: "", click: () => { clicked = true; }, remove() {} };
  const documentLike = { createElement: () => link, body: { appendChild: () => { appended = true; } } };
  assert.deepEqual(requestDownload(documentLike, "blob:test", "report.png"), { status: "requested" });
  assert.equal(link.href, "blob:test");
  assert.equal(clicked && appended, true);
  assert.deepEqual(requestDownload(null, "blob:test", "report.png"), { status: "unsupported" });
  assert.equal(requestDownload({ createElement: () => { throw new Error("blocked"); } }, "blob:test", "report.png").status, "failed");
});

test("정산 데이터가 바뀌면 공유 모델과 PNG 금액도 새로 계산된다", () => {
  const firstState = stateOf(["A", "B"], [{ payer: "A", amount: 1000 }]);
  const secondState = stateOf(["A", "B"], [{ payer: "A", amount: 3000 }]);
  const first = reportFor(firstState);
  const second = reportFor(secondState);
  assert.equal(first.model.total, 1000);
  assert.equal(second.model.total, 3000);
  const firstText = renderReportCanvas(first.model, { canvasFactory: fakeCanvasFactory() }).commands.map((command) => command.value || "").join(" ");
  const secondText = renderReportCanvas(second.model, { canvasFactory: fakeCanvasFactory() }).commands.map((command) => command.value || "").join(" ");
  assert.match(firstText, /1,000원/);
  assert.match(secondText, /3,000원/);
});

test("6명·4건 실사용 예시의 화면·텍스트·PNG 원본 값이 일치한다", () => {
  const names = ["준녕", "현진", "광일", "지은", "현규", "민성"];
  const state = stateOf(names, [
    { payer: "준녕", amount: 185000, place: "회시장", participantMode: "custom", participants: ["준녕", "현진", "광일", "현규", "민성"] },
    { payer: "준녕", amount: 116500, place: "투다리" },
    { payer: "민성", amount: 33000, place: "노래방", participantMode: "custom", participants: ["준녕", "광일", "지은", "민성"] },
    { payer: "준녕", amount: 9700, place: "편의점", participantMode: "custom", participants: ["준녕", "광일", "지은", "민성"] },
  ]);
  const { calculation, model } = reportFor(state);
  assert.equal(calculation.total, 344200);
  assert.equal(Object.values(calculation.paid).reduce((sum, amount) => sum + amount, 0), 344200);
  assert.equal(Object.values(calculation.owed).reduce((sum, amount) => sum + amount, 0), 344200);
  assert.deepEqual(calculation.transfers, [
    ["현진", "준녕", 56417],
    ["광일", "준녕", 67092],
    ["지은", "준녕", 30092],
    ["현규", "준녕", 56416],
    ["민성", "준녕", 34091],
  ]);
  assert.deepEqual(model.transfers, calculation.transfers);
  const text = buildCopyText(state, calculation);
  assert.match(text, /총액: 344,200원/);
  assert.match(text, /\[현진\] → 준녕 56,417원/);
  const pngText = renderReportCanvas(model, { canvasFactory: fakeCanvasFactory() }).commands.map((command) => command.value || "").join(" ");
  assert.match(pngText, /344,200원/);
  assert.ok(pngText.includes("준녕") && pngText.includes("56,417원"));
  assert.match(pngText, /56,417원/);
});

test("정산표 검증 예시의 결제별 실제 금액과 송금이 정확하다", () => {
  const names = ["준녕", "민성", "현진", "광일", "지은", "현구"];
  const state = stateOf(names, [
    { payer: "준녕", amount: 50000, place: "가즈아", participantMode: "custom", participants: ["준녕", "현진", "광일"] },
    { payer: "준녕", amount: 25000, place: "카페", participantMode: "custom", participants: ["광일", "지은", "현구"] },
    { payer: "민성", amount: 30000, place: "횟집", participantMode: "custom", participants: ["준녕", "광일", "지은", "현구"] },
  ]);
  const calculation = calculateSettlement(state);
  const model = buildShareModel(state, calculation);
  assert.equal(calculation.total, 105000);
  assert.deepEqual(model.members.map(({ name, net }) => [name, net]), [
    ["준녕", 50833], ["민성", 30000], ["현진", -16667],
    ["광일", -32500], ["지은", -15833], ["현구", -15833],
  ]);
  assert.deepEqual(calculation.transfers, [
    ["현진", "준녕", 16667], ["광일", "준녕", 32500], ["지은", "준녕", 1666],
    ["지은", "민성", 14167], ["현구", "민성", 15833],
  ]);

  const layout = require("../static/share-report.js").createLayout(model, {
    font: "",
    measureText: (value) => ({ width: String(value).length * 12 }),
  });
  const output = layout.commands.filter((command) => command.type === "text").map((command) => command.value).join("\n");
  assert.match(output, /정산 상세/);
  assert.ok(output.includes("50,000원"));
  assert.ok(output.includes("25,000원"));
  assert.ok(output.includes("30,000원"));
  assert.deepEqual(model.payments.map((payment) => names.reduce((sum, name) => sum + payment.amountsByMember[name], 0)), [50000, 25000, 30000]);
  assert.deepEqual(names.map((name) => model.payments.reduce((sum, payment) => sum + payment.amountsByMember[name], 0)), names.map((name) => calculation.owed[name]));
  assert.ok(output.includes("민성") && output.includes("14,167원"));
  assert.ok(!output.includes("—"));
  assert.equal(model.payments[0].amountsByMember["준녕"] + model.payments[0].amountsByMember["현진"] + model.payments[0].amountsByMember["광일"], 50000);
});

test("공통 부담자 구성에서도 결제별 실제 정산 금액 매트릭스를 표시한다", () => {
  const state = stateOf(["A", "B"], [
    { payer: "A", amount: 1000, place: "식사" },
    { payer: "B", amount: 2000, place: "카페", participantMode: "custom", participants: ["B", "A"] },
  ]);
  const model = buildShareModel(state, calculateSettlement(state));
  const layout = require("../static/share-report.js").createLayout(model, {
    font: "", measureText: (value) => ({ width: String(value).length * 12 }),
  });
  const output = layout.commands.filter((command) => command.type === "text").map((command) => command.value).join("\n");
  assert.equal(model.uniformParticipants, true);
  assert.match(output, /정산 상세/);
  assert.match(output, /식사/);
  assert.match(output, /카페/);
});

test("매트릭스는 열을 6개씩 나누고 공백 사용처는 결제 번호를 사용한다", () => {
  const names = Array.from({ length: 12 }, (_, index) => `멤버${index + 1}`);
  const payments = Array.from({ length: 13 }, (_, index) => ({
    payer: names[index % names.length], amount: 1300 + index, place: index === 0 ? "" : `사용처${index + 1}`,
    participantMode: "custom", participants: names.filter((_, memberIndex) => (memberIndex + index) % 2 === 0),
  }));
  const model = buildShareModel(stateOf(names, payments), calculateSettlement(stateOf(names, payments)));
  const layout = require("../static/share-report.js").createLayout(model, {
    font: "", measureText: (value) => ({ width: String(value).length * 10 }),
  });
  const output = layout.commands.filter((command) => command.type === "text").map((command) => command.value).join("\n");
  assert.equal(model.matrixPageCount, 3);
  assert.match(output, /결제 1/);
  assert.match(output, /결제 1–6/);
  assert.match(output, /결제 13–13/);
  assert.ok(layout.height > 1500);
});

test("기본 결제 합산의 나머지를 결제별로 배분해 행·열·전체 합계를 코어와 일치시킨다", () => {
  const names = ["A", "B", "C"];
  const state = stateOf(names, [
    { payer: "A", amount: 5 },
    { payer: "B", amount: 4 },
    { payer: "C", amount: 2 },
    { payer: "A", amount: 7, participantMode: "custom", participants: ["A", "C"] },
  ], { C: false });
  const calculation = calculateSettlement(state);
  const model = buildShareModel(state, calculation);
  assert.equal(model.ok, true);
  assert.deepEqual(model.payments.map((payment) => names.reduce((sum, name) => sum + payment.amountsByMember[name], 0)), [5, 4, 2, 7]);
  assert.deepEqual(names.map((name) => model.payments.reduce((sum, payment) => sum + payment.amountsByMember[name], 0)), names.map((name) => calculation.owed[name]));
  assert.equal(model.payments.reduce((sum, payment) => sum + Object.values(payment.amountsByMember).reduce((a, b) => a + b, 0), 0), calculation.total);
  assert.deepEqual(model.transfers, calculation.transfers);
});

test("전역 제외는 PNG 정산 금액에서만 빠지고 재포함 시 기존 custom 선택만 복원한다", () => {
  const names = ["A", "B", "C"];
  const payments = [{ payer: "A", amount: 100, place: "저녁", participantMode: "custom", participants: ["A", "B"] }];
  const excludedState = stateOf(names, payments, { B: false });
  const excludedCalculation = calculateSettlement(excludedState);
  const excludedModel = buildShareModel(excludedState, excludedCalculation);
  assert.deepEqual(excludedModel.payments[0].participants, ["A"]);
  assert.deepEqual(excludedModel.payments[0].amountsByMember, { A: 100, B: 0, C: 0 });
  const restoredState = stateOf(names, payments);
  const restoredModel = buildShareModel(restoredState, calculateSettlement(restoredState));
  assert.deepEqual(restoredModel.payments[0].participants, ["A", "B"]);
  assert.deepEqual(restoredModel.payments[0].amountsByMember, { A: 50, B: 50, C: 0 });
  assert.equal(restoredModel.payments[0].payer, "A");
});

test("정산 총액과 매트릭스가 불일치하면 PNG 모델 생성을 차단한다", () => {
  const state = stateOf(["A", "B"], [{ payer: "A", amount: 1000 }]);
  const calculation = calculateSettlement(state);
  calculation.owed.A += 1;
  const model = buildShareModel(state, calculation);
  assert.equal(model.ok, false);
  assert.equal(model.errors[0].code, "matrix-total-mismatch");
});

test("송금인은 여러 수취인을 한 그룹에 유지한다", () => {
  const groups = require("../static/share-report.js").groupTransfers([
    ["A", "B", 10], ["A", "C", 20], ["D", "B", 30],
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items, [{receiver:"B",amount:10},{receiver:"C",amount:20}]);
  assert.equal(groups[1].sender, "D");
});

test("미리보기는 저장·닫기와 캐시를 이용한 토글을 제공한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../templates/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../static/app.js"), "utf8");
  assert.doesNotMatch(html, /id="copyPngBtn"/);
  assert.match(html, /id="closeSharePanelBtn"[^>]*>닫기/);
  assert.match(html, /id="downloadPngBtn"[^>]*>이미지 저장/);
  assert.doesNotMatch(html, /id="sharePngBtn"/);
  assert.match(app, /preparedShare\?\.fingerprint === shareFingerprint\(\)/);
  assert.doesNotMatch(app, /copyPreparedImage/);
  assert.match(app, /requestDownload\(document, preparedShare\.url, preparedShare\.fileName\)/);
});

test("매트릭스는 이름 근처 결제액과 참여 타일만 표시하고 중간 합계 열을 생략한다", () => {
  const state = stateOf(["A", "B", "C"], [
    {payer:"A", amount:100, participantMode:"custom", participants:["A","B"]}
  ]);
  const { model } = reportFor(state);
  const rendered = renderReportCanvas(model, {canvasFactory:fakeCanvasFactory()});
  const labels = rendered.commands.filter(c => c.type === "text").map(c => c.value).join("\n");
  assert.match(labels, /결제 100원/);
  assert.doesNotMatch(labels, /결제 없음/);
  assert.doesNotMatch(labels, /분담 합계/);
  assert.match(labels, /정산액/);
  assert.equal(rendered.commands.filter(c => c.type === "route").length, 0);
  assert.doesNotMatch(labels, /—/);
});

test("요약은 한 줄이며 차액과 머리글 순서가 정확하다", () => {
  const state = stateOf(["A","B","C"], [{payer:"A",amount:900,place:"식사",participantMode:"custom",participants:["B","C"]}]);
  const {model}=reportFor(state);
  const output=renderReportCanvas(model,{canvasFactory:fakeCanvasFactory()});
  const texts=output.commands.filter(c=>c.type==="text");
  const summary=texts.slice(0,3);
  assert.equal(new Set(summary.map(c=>c.y)).size,1);
  assert.ok(summary[0].x<summary[1].x && summary[1].x<summary[2].x);
  assert.ok(texts.find(c=>c.value==="최종 송금").y < texts.find(c=>c.value==="정산 상세").y);
  const place=texts.find(c=>c.value==="식사");
  const amount=texts.find(c=>c.value==="900원");
  assert.ok(place.y<amount.y);
  assert.ok(!texts.some(c=>c.value==="결제 A"));
  assert.ok(texts.some(c=>c.value==="+900원"));
  assert.equal(texts.filter(c=>c.value==="−450원").length,2);
  assert.equal(output.commands.filter(c=>c.type==="route").length,0);
});

test("결제자가 미참여여도 색상은 유지하고 분담액과 대시는 표시하지 않는다", () => {
  const state=stateOf(["A","B"],[{payer:"A",amount:101,participantMode:"custom",participants:["B"]}]);
  const {model}=reportFor(state);
  const rendered=renderReportCanvas(model,{canvasFactory:fakeCanvasFactory()});
  const cell=rendered.commands.find(c=>c.type==="rect" && c.memberName==="A");
  assert.equal(cell.payer,true);
  assert.equal(cell.included,false);
  assert.equal(cell.fill,"#376653");
  const labels=rendered.commands.filter(c=>c.type==="text").map(c=>c.value);
  assert.ok(labels.includes("정산 참여") && labels.includes("결제자") && labels.includes("정산액"));
  assert.ok(!labels.includes("—") && !labels.includes("+ 받음  − 보냄"));
  assert.equal(model.payments[0].amountsByMember.A,0);
});

test("내용이 적은 표의 정산액은 마지막 결제 열에 붙고 장식선이 없다", () => {
  const {model}=reportFor(stateOf(["A","B"],[{payer:"A",amount:100,place:"카페"}]));
  const rendered=renderReportCanvas(model,{canvasFactory:fakeCanvasFactory()});
  assert.equal(rendered.commands.filter(c=>c.type==="line" && c.role!=="row-guide").length,0);
  const cell=rendered.commands.find(c=>c.type==="rect" && c.paymentId);
  const result=rendered.commands.find(c=>c.type==="text" && c.value==="정산액");
  assert.ok(result.x > cell.x+cell.width);
  assert.ok(result.x-(cell.x+cell.width)<100);
  assert.ok(result.x<rendered.logicalWidth-150);
  const value=rendered.commands.find(c=>c.type==="text" && c.value==="50원" && c.y>cell.y);
  assert.equal(value.baseline,"alphabetic");
});

test("송금 그룹은 행당 최대 세 개이며 방향 표시와 행 가이드가 독립적으로 렌더링된다", () => {
  const names=["A","B","C","D","E"];
  const {model}=reportFor(stateOf(names,[{payer:"A",amount:500}]));
  const {commands}=renderReportCanvas(model,{canvasFactory:fakeCanvasFactory()});
  const heading=commands.find(c=>c.value==="정산 상세");
  const senders=commands.filter(c=>c.type==="text" && ["B","C","D","E"].includes(c.value) && c.y<heading.y);
  const counts=new Map();
  senders.forEach(c=>counts.set(c.y,(counts.get(c.y)||0)+1));
  assert.ok([...counts.values()].every(count=>count<=3));
  const arrows=commands.filter(c=>c.type==="direction");
  assert.equal(arrows.length,model.transfers.length);
  assert.ok(arrows.every(c=>c.width===20));
  assert.ok(!commands.some(c=>c.type==="text" && c.value.includes("→")));
  const guides=commands.filter(c=>c.role==="row-guide");
  assert.equal(guides.length,names.length);
  assert.equal(new Set(guides.map(c=>c.x2-c.x1)).size,1);
  assert.ok(guides.every((c,i)=>i===0 || c.y>guides[i-1].y));
});


test("확정 화살표와 수취인·금액은 광학 중심을 공유하고 실험 UI를 제거한다", () => {
  const {model}=reportFor(stateOf(["A","B"],[{payer:"A",amount:100}]));
  const output=renderReportCanvas(model,{canvasFactory:fakeCanvasFactory()});
  const arrow=output.commands.find(c=>c.type==="direction");
  const receiver=output.commands.find(c=>c.type==="text" && c.value==="A" && c.x>arrow.x && c.y<arrow.y+20);
  const amount=output.commands.find(c=>c.type==="text" && c.value==="50원" && c.y<arrow.y+20);
  assert.equal(receiver.baseline,"alphabetic");
  assert.equal(amount.baseline,"alphabetic");
  // Test context has no glyph metrics: fallback ink center is 0.3 * font size above baseline.
  assert.ok(Math.abs(receiver.y-19*0.3-arrow.y)<0.001);
  assert.ok(Math.abs(amount.y-20*0.3-arrow.y)<0.001);
  for (const file of ["../static/app.js","../templates/index.html","../static/style.css"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname,file),"utf8"), /pngIconVariant|data-png-icon|png-icon-comparison/);
  }
  const app=fs.readFileSync(path.join(__dirname,"../static/app.js"),"utf8");
  assert.match(app,/const fileName = shareFileName\(\);/);
});

test("요약 상단 42px와 송금 제목 상단 여백 24px를 유지한다", () => {
  const {model}=reportFor(stateOf(["A","B"],[{payer:"A",amount:100}]));
  const {commands}=renderReportCanvas(model,{canvasFactory:fakeCanvasFactory()});
  const summary=commands.find(c=>c.value==="정산 결과");
  const background=commands.find(c=>c.type==="rect" && c.fill==="#e0ebe5");
  const title=commands.find(c=>c.value==="최종 송금");
  assert.equal(summary.y,42);
  assert.equal(background.y,88);
  assert.equal(title.y-background.y,24);
});
