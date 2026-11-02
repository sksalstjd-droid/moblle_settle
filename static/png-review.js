(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.mount(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const names5 = ["준녕", "민성", "현진", "광일", "지은"];
  const names10 = ["준녕", "민성", "현진", "광일", "지은", "현구", "서연", "Alex Morgan", "Christopher Long", "긴이름의참여자"];

  const sharedPayments = [
    { payer: 0, amount: 39800, place: "가즈아", participants: [0, 1, 2, 3, 4, 5] },
    { payer: 1, amount: 12500, place: "카페", participants: null },
    { payer: 3, amount: 278000, place: "아주 긴 한글 사용처 이름이 있는 저녁 식사", participants: [0, 3, 4, 6, 8] },
    { payer: 5, amount: 7900, place: "택시", participants: null },
    { payer: 0, amount: 86500, place: "회시장", participants: [0, 1, 3, 7, 9] },
    { payer: 7, amount: 1280000, place: "친구 생일 기념 식사 장소", participants: null },
    { payer: 2, amount: 43000, place: "노래방", participants: [0, 2, 3, 5, 6, 8, 9] },
    { payer: 4, amount: 990000, place: "숙소 예약", participants: null },
    { payer: 6, amount: 5500, place: "편의점", participants: [1, 3, 4, 6, 8] },
    { payer: 9, amount: 321700, place: "역 근처 주차장 및 간식 구매", participants: null },
    { payer: 8, amount: 16900, place: "투다리", participants: [0, 1, 2, 5, 7, 8] },
    { payer: 3, amount: 450000, place: "항공권", participants: null },
  ];

  const definitions = [
    {
      id: "5x4",
      title: "A · 5명 4건",
      names: names5,
      payments: [
        { payer: 0, amount: 50000, place: "가즈아", participants: [0, 2, 3] },
        { payer: 1, amount: 25000, place: "카페", participants: null },
        { payer: 3, amount: 30000, place: "아주 긴 한글 사용처 이름이 있는 저녁 식사", participants: [0, 1, 3, 4] },
        { payer: 4, amount: 10000, place: "노래방", participants: [1, 2, 4] },
      ],
    },
    ...[
      ["10x7", "B · 10명 7건", 7],
      ["10x10", "C · 10명 10건", 10],
      ["10x12", "D · 10명 12건", 12],
    ].map(([id, title, count]) => ({ id, title, names: names10, payments: sharedPayments.slice(0, count) })),
  ];

  function createState(definition) {
    return {
      schemaVersion: 2,
      names: definition.names.slice(),
      targets: Object.fromEntries(definition.names.map((name) => [name, true])),
      lastPayer: definition.names[0] || null,
      payments: definition.payments.map((payment, index) => ({
        id: `review-${definition.id}-${index + 1}`,
        payer: definition.names[payment.payer],
        amount: payment.amount,
        place: payment.place,
        participantMode: payment.participants ? "custom" : "default",
        participants: payment.participants ? payment.participants.map((participant) => definition.names[participant]) : null,
      })),
    };
  }

  async function renderSample(root, definition) {
    const card = root.document.querySelector(`[data-sample="${definition.id}"]`);
    const status = card.querySelector("[data-status]");
    const image = card.querySelector("img");
    const download = card.querySelector("[data-download]");
    try {
      const state = createState(definition);
      const calculation = root.SettlementCore.calculateSettlement(state);
      if (calculation.errors.length) throw new Error(calculation.errors.map((item) => item.message).join(" "));
      const model = root.ShareReport.buildShareModel(state, calculation);
      if (!model.ok) throw new Error(model.errors.map((item) => item.message || item.code).join(" "));

      // Use the exact production Canvas and PNG Blob path; no storage is read or written.
      const report = await root.ShareReport.createPngReport(model);
      const url = root.URL.createObjectURL(report.blob);
      root.__pngReviewUrls.push(url);
      image.onload = () => { status.textContent = "PNG 생성 및 이미지 로드 완료"; };
      image.onerror = () => { status.textContent = "PNG 파일을 표시하지 못했습니다."; status.classList.add("error"); };
      image.src = url;
      image.hidden = false;
      download.href = url;
      download.download = `settlement-${definition.id}.png`;
      download.hidden = false;
      card.querySelector("[data-dimensions]").textContent = `${report.canvas.width} × ${report.canvas.height}px`;
      card.querySelector("[data-logical]").textContent = `논리 크기 ${report.logicalWidth} × ${report.logicalHeight}px`;
      status.textContent = "PNG 생성 완료, 이미지 확인 중";
    } catch (error) {
      status.textContent = `생성 실패: ${error && error.message ? error.message : String(error)}`;
      status.classList.add("error");
    }
  }

  function mount(root) {
    root.__pngReviewUrls = [];
    root.addEventListener("beforeunload", () => root.__pngReviewUrls.forEach((url) => root.URL.revokeObjectURL(url)), { once: true });
    (async () => {
      for (const definition of definitions) await renderSample(root, definition);
    })();
  }

  return { definitions, createState, mount };
});
