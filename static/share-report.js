(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShareReport = api;
  if (typeof window !== "undefined" && window !== root) window.ShareReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LOGICAL_WIDTH = 900;
  const MAX_PIXELS = 24000000;
  const MAX_MATRIX_COLUMNS = 6;

  function won(amount) {
    return `${Math.trunc(amount).toLocaleString("ko-KR")}원`;
  }

  function sameNames(left, right) {
    return left.length === right.length && left.every((name, index) => name === right[index]);
  }

  function buildShareModel(state, calculation) {
    if (!calculation || calculation.errors.length > 0) {
      return { ok: false, errors: calculation ? calculation.errors.slice() : [{ code: "missing-calculation" }] };
    }

    const defaultDetail = calculation.paymentDetails.find((detail) => detail.type === "default-group");
    const customDetails = new Map(
      calculation.paymentDetails
        .filter((detail) => detail.type === "custom-payment")
        .map((detail) => [detail.paymentId, detail]),
    );
    const payments = state.payments.map((payment, index) => {
      const participants = payment.participantMode === "custom"
        ? (customDetails.get(payment.id)?.participants || payment.participants || [])
        : (defaultDetail?.participants || []);
      return {
        id: payment.id,
        index,
        label: payment.place || `결제 ${index + 1}`,
        place: payment.place,
        payer: payment.payer,
        amount: payment.amount,
        participants: participants.slice(),
      };
    });

    const firstParticipants = payments[0]?.participants || [];
    const uniformParticipants = payments.every((payment) => sameNames(payment.participants, firstParticipants));
    const members = state.names.map((name) => {
      const balance = calculation.balances[name] || 0;
      const net = -balance;
      return {
        name,
        paid: calculation.paid[name] || 0,
        owed: calculation.owed[name] || 0,
        balance,
        net,
        status: net > 0 ? "receive" : net < 0 ? "send" : "settled",
      };
    });

    return {
      ok: true,
      total: calculation.total,
      memberCount: state.names.length,
      paymentCount: state.payments.length,
      names: state.names.slice(),
      payments,
      members,
      transfers: calculation.transfers.map((transfer) => transfer.slice()),
      uniformParticipants,
      commonParticipants: uniformParticipants ? firstParticipants.slice() : null,
      matrixRequired: !uniformParticipants,
      matrixColumnsPerPage: Math.min(Math.max(payments.length, 1), MAX_MATRIX_COLUMNS),
      matrixPageCount: uniformParticipants ? 0 : Math.ceil(payments.length / MAX_MATRIX_COLUMNS),
      hasCustomPayments: state.payments.some((payment) => payment.participantMode === "custom"),
      perHead: calculation.perHead,
    };
  }

  function groupTransfers(transfers) {
    const groups = [];
    const bySender = new Map();
    transfers.forEach(([sender, receiver, amount]) => {
      if (!bySender.has(sender)) {
        const group = { sender, total: 0, items: [] };
        bySender.set(sender, group);
        groups.push(group);
      }
      const group = bySender.get(sender);
      group.total += amount;
      group.items.push({ receiver, amount });
    });
    return groups;
  }

  function buildCopyText(state, calculation) {
    const model = buildShareModel(state, calculation);
    if (!model.ok) return "";
    const targets = state.names.filter((name) => state.targets[name] !== false);
    const excludedNames = state.names.filter((name) => state.targets[name] === false);
    const lines = ["🧾 정산 결과", "", `총액: ${won(model.total)}`];

    if (!model.hasCustomPayments) {
      lines.push(`1인당: ${won(model.perHead)} (${targets.length}명 기준)`);
      if (excludedNames.length > 0) lines.push(`정산 제외: ${excludedNames.join(", ")}`);
    } else if (model.uniformParticipants) {
      lines.push(`공통 부담자: ${model.commonParticipants.join(", ")}`);
    } else {
      lines.push("", "[결제별 비용 부담]");
      model.payments.forEach((payment) => {
        lines.push(
          `${payment.label} · ${won(payment.amount)} · 결제 ${payment.payer}`,
          `부담: ${payment.participants.join(", ")}`,
        );
      });
    }

    const grouped = groupTransfers(model.transfers);
    if (grouped.length === 0) {
      lines.push("", "정산할 내역 없음");
      return lines.join("\n");
    }

    lines.push("", "[보낼 돈]");
    grouped.forEach((group) => {
      if (group.items.length === 1) {
        const item = group.items[0];
        lines.push("", `[${group.sender}] → ${item.receiver} ${won(item.amount)}`);
      } else {
        lines.push("", `[${group.sender}] 총 ${won(group.total)}`);
        group.items.forEach((item) => lines.push(`→ ${item.receiver} ${won(item.amount)}`));
      }
    });
    return lines.join("\n");
  }

  function wrapText(ctx, text, maxWidth) {
    const value = String(text || "");
    if (!value) return [""];
    const lines = [];
    let current = "";
    for (const character of value) {
      const candidate = current + character;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function ellipsize(ctx, text, maxWidth) {
    const value = String(text || "");
    if (ctx.measureText(value).width <= maxWidth) return value;
    let result = value;
    while (result && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
    return `${result}…`;
  }

  function createLayout(model, measureContext) {
    const commands = [];
    const left = 62;
    const right = LOGICAL_WIDTH - 62;
    const width = right - left;
    let y = 62;

    function text(value, x, options = {}) {
      const font = options.font || "500 25px system-ui, sans-serif";
      const color = options.color || "#111827";
      const lineHeight = options.lineHeight || 34;
      measureContext.font = font;
      const lines = options.wrap === false
        ? [ellipsize(measureContext, value, options.maxWidth || width)]
        : wrapText(measureContext, value, options.maxWidth || width);
      lines.forEach((line, index) => {
        commands.push({ type: "text", value: line, x, y: y + index * lineHeight, font, color, align: options.align || "left" });
      });
      y += lines.length * lineHeight;
    }

    function inlineText(value, x, atY, options = {}) {
      const font = options.font || "500 25px system-ui, sans-serif";
      const color = options.color || "#111827";
      measureContext.font = font;
      commands.push({
        type: "text",
        value: ellipsize(measureContext, value, options.maxWidth || width),
        x,
        y: atY,
        font,
        color,
        align: options.align || "left",
      });
    }

    function gap(amount) { y += amount; }
    function divider() {
      commands.push({ type: "line", x1: left, x2: right, y, color: "#dfe4ea" });
      y += 18;
    }
    function sectionTitle(value) {
      text(value, left, { font: "700 24px system-ui, sans-serif", lineHeight: 30 });
      gap(5);
    }

    text(`총 결제액  ${won(model.total)}`, left, { font: "800 34px system-ui, sans-serif", color: "#2563a6", lineHeight: 42 });
    text(`멤버 ${model.memberCount}명 · 결제 ${model.paymentCount}건`, left, { font: "500 19px system-ui, sans-serif", color: "#6b7280", lineHeight: 25 });
    gap(10);
    divider();

    sectionTitle("결제 내역");
    model.payments.forEach((payment, index) => {
      const rowY = y;
      text(`${index + 1}. ${payment.label}`, left, { font: "600 21px system-ui, sans-serif", wrap: false, maxWidth: 440, lineHeight: 27 });
      inlineText(`${payment.payer} 결제 · ${won(payment.amount)}`, right, rowY, { font: "500 20px system-ui, sans-serif", color: "#374151", maxWidth: 330, align: "right" });
      y += 8;
    });
    divider();

    sectionTitle(model.uniformParticipants ? "공통 부담자 및 개인별 차액" : "비용 부담 및 최종 차액");
    text("✓ 비용 부담   — 비부담   ·   참석 여부가 아닌 비용 부담 기준", left, { font: "500 18px system-ui, sans-serif", color: "#6b7280", lineHeight: 24 });
    gap(6);
    if (model.uniformParticipants) {
      text(`공통 부담자  ✓ ${model.commonParticipants.join(", ")}`, left, { font: "600 21px system-ui, sans-serif", color: "#047857", lineHeight: 28 });
      model.members.forEach((member) => {
        const statusText = member.status === "receive"
          ? `+${won(member.net)} 받음`
          : member.status === "send"
            ? `-${won(Math.abs(member.net))} 보냄`
            : "0원 완료";
        const color = member.status === "receive" ? "#047857" : member.status === "send" ? "#c2410c" : "#6b7280";
        const rowY = y;
        text(member.name, left, { font: "600 20px system-ui, sans-serif", wrap: false, maxWidth: 380, lineHeight: 26 });
        inlineText(statusText, right, rowY, { font: "600 20px system-ui, sans-serif", color, maxWidth: 400, align: "right" });
        y += 3;
      });
    } else {
      const pages = [];
      for (let start = 0; start < model.payments.length; start += MAX_MATRIX_COLUMNS) {
        pages.push(model.payments.slice(start, start + MAX_MATRIX_COLUMNS));
      }
      if (pages.length === 0) pages.push([]);
      const nameWidth = 205;
      const balanceWidth = 236;
      const availableForColumns = width - nameWidth - balanceWidth;
      pages.forEach((pagePayments, pageIndex) => {
        if (pages.length > 1) {
          text(`부담 매트릭스 ${pageIndex + 1}/${pages.length}`, left, { font: "600 18px system-ui, sans-serif", color: "#6b7280", lineHeight: 23 });
        }
        const colWidth = availableForColumns / Math.max(pagePayments.length, 1);
        const headersY = y;
        commands.push({ type: "rect", x: left, y: headersY - 3, width, height: 34, fill: "#f1f5f9" });
        text("이름", left + 4, { font: "700 18px system-ui, sans-serif", wrap: false, maxWidth: nameWidth - 8, lineHeight: 26 });
        pagePayments.forEach((payment, column) => {
          const x = left + nameWidth + column * colWidth;
          const center = x + colWidth / 2;
          const header = documentLabel(payment, model);
          inlineText(header, center, headersY, { font: "700 18px system-ui, sans-serif", maxWidth: colWidth - 8, align: "center" });
        });
        inlineText("최종 차액", right, headersY, { font: "700 18px system-ui, sans-serif", maxWidth: balanceWidth - 10, align: "right" });
        y += 38;

        model.members.forEach((member, rowIndex) => {
          const rowY = y;
          if (rowIndex % 2 === 1) commands.push({ type: "rect", x: left, y: rowY - 2, width, height: 34, fill: "#f8fafc" });
          text(member.name, left + 4, { font: "600 19px system-ui, sans-serif", wrap: false, maxWidth: nameWidth - 8, lineHeight: 27 });
          pagePayments.forEach((payment, column) => {
            const bearsCost = payment.participants.includes(member.name);
            const x = left + nameWidth + column * colWidth;
            const cellWidth = Math.min(34, colWidth - 8);
            const cellX = x + (colWidth - cellWidth) / 2;
            commands.push({
              type: "rect", x: cellX, y: rowY + 1, width: cellWidth, height: 27,
              fill: bearsCost ? "#d1fae5" : "#f1f5f9",
              stroke: bearsCost ? "#6ee7b7" : "#e2e8f0",
            });
            inlineText(bearsCost ? "✓" : "—", cellX + cellWidth / 2, rowY + 3, {
              font: "700 18px system-ui, sans-serif",
              color: bearsCost ? "#047857" : "#94a3b8",
              maxWidth: cellWidth,
              align: "center",
            });
          });
          const balanceText = member.net > 0
            ? `+${won(member.net)}`
            : member.net < 0
              ? `-${won(Math.abs(member.net))}`
              : "0원";
          const balanceColor = member.net > 0 ? "#047857" : member.net < 0 ? "#c2410c" : "#6b7280";
          inlineText(balanceText, right, rowY + 1, {
            font: "700 19px system-ui, sans-serif", color: balanceColor,
            maxWidth: balanceWidth - 10, align: "right",
          });
          y += 34;
        });
        gap(5);
      });
    }
    gap(8);
    divider();

    sectionTitle("실제 송금");
    if (model.transfers.length === 0) {
      text("송금할 내역 없음", left, { font: "500 19px system-ui, sans-serif", color: "#047857", lineHeight: 26 });
    } else {
      model.transfers.forEach(([sender, receiver, amount]) => {
        const rowY = y;
        text(`${sender} → ${receiver}`, left, { font: "600 20px system-ui, sans-serif", wrap: false, maxWidth: 590, lineHeight: 26 });
        inlineText(won(amount), right, rowY, { font: "700 20px system-ui, sans-serif", color: "#2563a6", maxWidth: 190, align: "right" });
        y += 5;
      });
    }
    gap(12);
    return { commands, height: Math.ceil(y + 42) };
  }

  function documentLabel(payment, model) {
    return `①②③④⑤⑥⑦⑧⑨⑩`[payment.index] || `${payment.index + 1}`;
  }

  function defaultCanvasFactory() {
    return document.createElement("canvas");
  }

  function renderReportCanvas(model, options = {}) {
    if (!model || !model.ok) throw new Error("유효한 정산 결과가 필요합니다.");
    const canvasFactory = options.canvasFactory || defaultCanvasFactory;
    const measureCanvas = canvasFactory();
    const measureContext = measureCanvas.getContext("2d");
    if (!measureContext) throw new Error("Canvas 2D를 사용할 수 없습니다.");
    const layout = createLayout(model, measureContext);
    const requestedScale = Math.min(Number(options.scale) || 2, 2);
    const safeScale = Math.min(requestedScale, Math.sqrt(MAX_PIXELS / (LOGICAL_WIDTH * layout.height)));
    const scale = safeScale;
    const canvas = canvasFactory();
    canvas.width = Math.ceil(LOGICAL_WIDTH * scale);
    canvas.height = Math.ceil(layout.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D를 사용할 수 없습니다.");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LOGICAL_WIDTH, layout.height);
    ctx.textBaseline = "top";

    layout.commands.forEach((command) => {
      if (command.type === "line") {
        ctx.strokeStyle = command.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(command.x1, command.y);
        ctx.lineTo(command.x2, command.y);
        ctx.stroke();
        return;
      }
      if (command.type === "rect") {
        ctx.fillStyle = command.fill;
        ctx.fillRect(command.x, command.y, command.width, command.height);
        if (command.stroke) {
          ctx.strokeStyle = command.stroke;
          ctx.lineWidth = 1;
          ctx.strokeRect(command.x, command.y, command.width, command.height);
        }
        return;
      }
      ctx.font = command.font;
      ctx.fillStyle = command.color;
      ctx.textAlign = command.align;
      ctx.fillText(command.value, command.x, command.y);
    });
    return { canvas, logicalWidth: LOGICAL_WIDTH, logicalHeight: layout.height, scale, commands: layout.commands };
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("PNG 데이터를 만들지 못했습니다."));
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    });
  }

  async function createPngReport(model, options = {}) {
    const rendered = renderReportCanvas(model, options);
    const blob = await canvasToPngBlob(rendered.canvas);
    return { ...rendered, blob };
  }

  async function shareFile(navigatorLike, file) {
    if (!navigatorLike || typeof navigatorLike.canShare !== "function" || typeof navigatorLike.share !== "function") {
      return { status: "unsupported" };
    }
    try {
      if (!navigatorLike.canShare({ files: [file] })) return { status: "unsupported" };
      await navigatorLike.share({ files: [file], title: "정산 결과", text: "정산 결과 이미지입니다." });
      return { status: "shared" };
    } catch (error) {
      if (error && error.name === "AbortError") return { status: "canceled" };
      return { status: "failed", error };
    }
  }

  function requestDownload(documentLike, url, fileName) {
    if (!documentLike || typeof documentLike.createElement !== "function") return { status: "unsupported" };
    try {
      const link = documentLike.createElement("a");
      if (!("download" in link)) return { status: "unsupported" };
      link.href = url;
      link.download = fileName;
      documentLike.body.appendChild(link);
      link.click();
      link.remove();
      return { status: "requested" };
    } catch (error) {
      return { status: "failed", error };
    }
  }

  return {
    LOGICAL_WIDTH,
    MAX_PIXELS,
    MAX_MATRIX_COLUMNS,
    won,
    buildShareModel,
    buildCopyText,
    groupTransfers,
    createLayout,
    renderReportCanvas,
    canvasToPngBlob,
    createPngReport,
    shareFile,
    requestDownload,
  };
});
