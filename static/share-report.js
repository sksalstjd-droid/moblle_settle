(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShareReport = api;
  if (typeof window !== "undefined" && window !== root) window.ShareReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LOGICAL_WIDTH = 780;
  const MAX_PIXELS = 24000000;

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
    let defaultOffset = 0;
    const payments = state.payments.map((payment, index) => {
      const participants = payment.participantMode === "custom"
        ? (customDetails.get(payment.id)?.participants || payment.participants || [])
        : (defaultDetail?.participants || []);
      const amountsByMember = Object.fromEntries(state.names.map((name) => [name, 0]));
      if (payment.participantMode === "custom") {
        const detail = customDetails.get(payment.id);
        if (!detail) return null;
        const base = Math.floor(payment.amount / detail.participants.length);
        let remainder = payment.amount % detail.participants.length;
        detail.participants.forEach((name) => {
          amountsByMember[name] = base + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder -= 1;
        });
      } else if (defaultDetail) {
        const start = defaultOffset;
        const end = start + payment.amount;
        const countBefore = (position, memberIndex, size) => Math.floor((position + size - 1 - memberIndex) / size);
        defaultDetail.participants.forEach((name, memberIndex) => {
          amountsByMember[name] = countBefore(end, memberIndex, participants.length)
            - countBefore(start, memberIndex, participants.length);
        });
        defaultOffset = end;
      }
      return {
        id: payment.id,
        index,
        label: payment.place || `결제 ${index + 1}`,
        place: payment.place,
        payer: payment.payer,
        amount: payment.amount,
        participants: participants.slice(),
        amountsByMember,
      };
    });

    if (payments.some((payment) => !payment)) {
      return { ok: false, errors: [{ code: "missing-payment-detail" }] };
    }
    const rowTotals = Object.fromEntries(state.names.map((name) => [name, 0]));
    const columnTotals = payments.map((payment) => {
      let total = 0;
      state.names.forEach((name) => {
        const amount = payment.amountsByMember[name];
        if (!Number.isSafeInteger(amount) || amount < 0) total = NaN;
        else {
          total += amount;
          rowTotals[name] += amount;
        }
      });
      return total;
    });
    const matrixValid = columnTotals.every((total, index) => total === state.payments[index].amount)
      && state.names.every((name) => rowTotals[name] === (calculation.owed[name] || 0))
      && columnTotals.reduce((sum, amount) => sum + amount, 0) === calculation.total;
    const paidTotals = Object.fromEntries(state.names.map((name) => [name, 0]));
    state.payments.forEach((payment) => { paidTotals[payment.payer] += payment.amount; });
    const balancesValid = state.names.every((name) =>
      paidTotals[name] === calculation.paid[name]
      && calculation.balances[name] === calculation.owed[name] - calculation.paid[name]);
    if (!matrixValid || !balancesValid) return { ok: false, errors: [{ code: "matrix-total-mismatch" }] };

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
      matrixRequired: payments.length > 0,
      matrixColumnsPerPage: payments.length,
      matrixPageCount: payments.length ? 1 : 0,
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
    const participantOwed = (model.commonParticipants || []).map((name) =>
      model.members.find((member) => member.name === name)?.owed);
    const equalParticipantOwed = model.payments.length > 0
      && model.uniformParticipants
      && participantOwed.length > 0
      && participantOwed.every((amount) => amount === participantOwed[0]);
    const lines = ["🧾 정산 결과", `총 결제액 ${won(model.total)}`];
    if (equalParticipantOwed) {
      lines.push(`1인당 부담액 ${won(model.members.find((member) => member.name === model.commonParticipants[0]).owed)}`);
    }

    const grouped = groupTransfers(model.transfers);
    lines.push("", "[최종 송금]", "");
    if (grouped.length === 0) {
      lines.push("송금할 금액 없음");
      return lines.join("\n");
    }

    grouped.forEach((group, index) => {
      if (index > 0) lines.push("");
      if (group.items.length === 1) {
        const item = group.items[0];
        lines.push(`${group.sender} → ${item.receiver} ${won(item.amount)}`);
      } else {
        lines.push(`${group.sender} (총 ${won(group.total)})`);
        group.items.forEach((item) => lines.push(`  → ${item.receiver} ${won(item.amount)}`));
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

  function createLayout(model, measureContext, options = {}) {
    const commands = [];
    const left = 62;
    // The override is only for comparing the previous split layout in tests; production defaults to one table.
    const requestedColumns = Number(options.matrixColumnsPerPage);
    const matrixColumnsPerPage = Number.isInteger(requestedColumns) && requestedColumns > 0
      ? requestedColumns
      : Math.max(1, model.payments.length);
    const measured = (value, font) => { measureContext.font = font; return measureContext.measureText(value).width; };
    const nameGap = 20, columnGap = 10, resultGap = 24;
    const nameWidth = Math.max(70, ...model.members.map(member => Math.max(
      Math.min(260, measured(member.name, "600 16px system-ui, sans-serif")),
      member.paid ? measured(`결제 ${won(member.paid)}`, "500 13px system-ui, sans-serif") : 0
    ))) + 12;
    const netWidth = Math.max(measured("정산액", "600 16px system-ui, sans-serif"), ...model.members.map(member =>
      measured(`${member.net > 0 ? "+" : member.net < 0 ? "−" : ""}${won(Math.abs(member.net))}`, "700 16px system-ui, sans-serif"))) + 16;
    const paymentWidth = payment => Math.max(60,
      Math.min(220, measured(payment.label, "700 17px system-ui, sans-serif")),
      measured(won(payment.amount), "500 15px system-ui, sans-serif"),
      ...model.names.map(name => measured(won(payment.amountsByMember[name]), "600 15px system-ui, sans-serif"))
    ) + 16;
    const summaryItems = [
      ["정산 결과", "700 23px system-ui, sans-serif"],
      [`총 결제액  ${won(model.total)}`, "600 23px system-ui, sans-serif"],
      [`결제 ${model.paymentCount}건`, "500 17px system-ui, sans-serif"],
    ];
    const summaryWidth = summaryItems.reduce((sum, [value, font]) => sum + measured(value, font), 0)
      + Math.max(0, summaryItems.length - 1) * 24;
    const matrixWidths = [];
    for (let start = 0; start < model.payments.length; start += matrixColumnsPerPage) {
      const batch = model.payments.slice(start, start + matrixColumnsPerPage);
      matrixWidths.push(nameWidth + nameGap + netWidth + (batch.length ? resultGap : 0)
        + batch.reduce((sum,payment) => sum + paymentWidth(payment), 0)
        + Math.max(0,batch.length-1)*columnGap);
    }
    const legendWidth = Math.max(
      19 + measured("정산 참여", "400 13px system-ui, sans-serif"),
      139 + measured("결제자", "400 13px system-ui, sans-serif"),
    );
    const transferGroups = groupTransfers(model.transfers);
    const directionSpace = 26;
    const transferWidths = transferGroups.map((group) => {
      let groupWidth = measured(group.sender, "700 23px system-ui, sans-serif");
      group.items.forEach(({ receiver, amount }) => {
        groupWidth = Math.max(groupWidth, directionSpace + measured(receiver, "500 19px system-ui, sans-serif")
          + 12 + measured(won(amount), "700 20px system-ui, sans-serif"));
      });
      return Math.ceil(groupWidth + 2);
    });
    const transferWidth = Math.max(0, ...transferWidths);
    const contentWidth = Math.max(summaryWidth, ...matrixWidths, legendWidth, transferWidth);
    const canvasWidth = Math.max(LOGICAL_WIDTH, Math.ceil(left + contentWidth + left));
    const right = canvasWidth - 62;
    const width = right - left;
    let y = 42;

    function text(value, x, options = {}) {
      const font = options.font || "500 25px system-ui, sans-serif";
      const color = options.color || "#293532";
      const lineHeight = options.lineHeight || 34;
      measureContext.font = font;
      const lines = options.wrap === false
        ? [ellipsize(measureContext, value, options.maxWidth || width)]
        : wrapText(measureContext, value, options.maxWidth || width);
      lines.forEach((line, index) => commands.push({ type: "text", value: line, x, y: y + index * lineHeight, font, color, align: options.align || "left" }));
      y += lines.length * lineHeight;
    }
    function inlineText(value, x, atY, options = {}) {
      const font = options.font || "500 20px system-ui, sans-serif";
      measureContext.font = font;
      commands.push({ type: "text", value: ellipsize(measureContext, value, options.maxWidth || width), x, y: atY, font, color: options.color || "#293532", align: options.align || "left" });
    }
    function centered(value, x, centerY, options) {
      measureContext.font = options.font;
      const m = measureContext.measureText(value);
      const size = Number(options.font.match(/([0-9]+)px/)[1]);
      const ascent = m.actualBoundingBoxAscent ?? size * 0.8;
      const descent = m.actualBoundingBoxDescent ?? size * 0.2;
      commands.push({type:"text", value, x, y:centerY+(ascent-descent)/2, font:options.font,
        color:options.color || "#293532", align:options.align || "left", baseline:"alphabetic"});
    }
    function gap(amount) { y += amount; }
    function sectionTitle(value) { text(value, left, { font: "700 24px system-ui, sans-serif", lineHeight: 30 }); gap(5); }

    let summaryX = left;
    summaryItems.map(([value, font], index) => [value, font, ["#293532", "#245345", "#75817c"][index]])
      .forEach(([value, font, color]) => {
      measureContext.font = font;
      const itemWidth = measureContext.measureText(value).width;
      if (summaryX + itemWidth > right) throw new Error("요약 금액이 이미지 폭을 초과합니다.");
      inlineText(value, summaryX, y, { font, color, maxWidth: itemWidth + 1 });
      summaryX += itemWidth + 24;
    });
    y += 58;

    const transferBackdrop = { type: "rect", x: 0, y: y - 12, width: canvasWidth, height: 0, fill: "#e0ebe5" };
    commands.push(transferBackdrop);
    y += 12;
    sectionTitle("최종 송금");
    gap(8);
    const transferLayouts = [];
    if (!model.transfers.length) {
      text("송금할 금액이 없습니다.", left, { font: "600 25px system-ui, sans-serif", color: "#65756d", lineHeight: 34 });
    } else {
      const groupGapX = 80;
      const groupGapY = 30;
      let x = left;
      let top = y;
      let bottom = y;
      let transferRow = 0;
      transferGroups.forEach((group, groupIndex) => {
        measureContext.font = "700 23px system-ui, sans-serif";
        let groupWidth = measureContext.measureText(group.sender).width;
        group.items.forEach(({receiver, amount}) => {
          measureContext.font = "500 19px system-ui, sans-serif";
          const receiverWidth = directionSpace + measureContext.measureText(receiver).width;
          measureContext.font = "700 20px system-ui, sans-serif";
          groupWidth = Math.max(groupWidth, receiverWidth + 12 + measureContext.measureText(won(amount)).width);
        });
        groupWidth = Math.min(width, groupWidth + 2);
        if (x > left && x + groupWidth > right) {
          x = left;
          top = bottom + groupGapY;
          transferRow += 1;
        }
        const groupTop = top;
        y = top;
        text(group.sender, x, {font:"700 23px system-ui, sans-serif", maxWidth:groupWidth, lineHeight:29});
        group.items.forEach(({receiver, amount}) => {
          measureContext.font = "700 20px system-ui, sans-serif";
          const amountWidth = measureContext.measureText(won(amount)).width;
          measureContext.font = "500 19px system-ui, sans-serif";
          const lines = wrapText(measureContext, receiver, Math.max(30, groupWidth - directionSpace - amountWidth - 12));
          // A shared optical center aligns the receiver ink and the arrow's horizontal exit.
          const centerY = y + 12.5;
          commands.push({ type: "direction", x, y: centerY, width: 20, color: "#6b8275" });
          lines.forEach((line, i) => centered(line, x + directionSpace, centerY + i * 25, {font:"500 19px system-ui, sans-serif"}));
          measureContext.font = "500 19px system-ui, sans-serif";
          const lastWidth = measureContext.measureText(lines[lines.length-1]).width;
          centered(won(amount), x + directionSpace + lastWidth + 12, centerY + (lines.length-1)*25, {font:"700 20px system-ui, sans-serif", color:"#245345", maxWidth:amountWidth+1});
          y += lines.length * 25;
        });
        bottom = Math.max(bottom, y);
        transferLayouts.push({ sender: group.sender, x, y: groupTop, width: groupWidth, row: transferRow, index: groupIndex });
        x += groupWidth + groupGapX;
      });
      y = bottom + 12;
    }
    transferBackdrop.height = y - transferBackdrop.y + 8;
    gap(22);
    sectionTitle("정산 상세");
    gap(8);
    const pages = [];
    for (let start = 0; start < model.payments.length; start += matrixColumnsPerPage) pages.push(model.payments.slice(start, start + matrixColumnsPerPage));
    if (!pages.length) pages.push([]);
    const matrixPageLayouts = [];
    pages.forEach((pagePayments, pageIndex) => {
      const pageStartY = y;
      if (pages.length > 1) text(`결제 ${pageIndex * matrixColumnsPerPage + 1}–${pageIndex * matrixColumnsPerPage + pagePayments.length}`, left, { font: "600 17px system-ui, sans-serif", color: "#6b7280", lineHeight: 22 });
      const columnWidths = pagePayments.map(paymentWidth);
      const netLeft = left + nameWidth + nameGap;
      const firstPaymentLeft = netLeft + netWidth + resultGap;
      const columnLefts = columnWidths.map((_, index) => firstPaymentLeft
        + columnWidths.slice(0,index).reduce((a,b)=>a+b,0) + index * columnGap);
      const matrixRight = pagePayments.length
        ? columnLefts[columnLefts.length - 1] + columnWidths[columnWidths.length - 1]
        : netLeft + netWidth;
      let colWidth = columnWidths[0] || 60;
      const headerTop = y;
      const headerLine = 20;
      const maxCellText = Math.max(colWidth - 10, 20);
      measureContext.font = "600 15px system-ui, sans-serif";
      const headerData = pagePayments.map((payment, column) => [payment.label, won(payment.amount)].map((value, row) => {
        measureContext.font = ["700 17px system-ui, sans-serif", "500 15px system-ui, sans-serif", "400 13px system-ui, sans-serif"][row];
        return wrapText(measureContext, value, columnWidths[column] - 10);
      }));
      const rowHeights = [0, 1].map((row) => Math.max(1, ...headerData.map((cells) => cells[row].length)) * headerLine);
      const headerHeight = rowHeights.reduce((sum, height) => sum + height, 0) + 8;

      const rowOffsets = [4, 4 + rowHeights[0], 4 + rowHeights[0] + rowHeights[1]];
      inlineText("정산액", netLeft + netWidth / 2, headerTop + 4, { font: "600 16px system-ui, sans-serif", align: "center", maxWidth: netWidth - 8 });
      pagePayments.forEach((payment, column) => {
        colWidth = columnWidths[column];
        const center = columnLefts[column] + colWidth / 2;
        headerData[column].forEach((lines, row) => {
          lines.forEach((line, lineIndex) => {
            inlineText(line, center, headerTop + rowOffsets[row] + lineIndex * headerLine, { font: ["700 17px system-ui, sans-serif", "500 15px system-ui, sans-serif", "400 13px system-ui, sans-serif"][row], color: row === 2 ? "#75817c" : "#293532", maxWidth: colWidth - 10, align: "center" });
          });
        });
      });
      y += headerHeight;
      model.members.forEach((member, rowIndex) => {
        const rowY = y;
        measureContext.font = "600 16px system-ui, sans-serif";
        const nameLines = wrapText(measureContext, member.name, nameWidth - 12);
        const cellValues = pagePayments.map((payment, column) => {
          colWidth = columnWidths[column];
          const included = payment.participants.includes(member.name);
          const value = included ? won(payment.amountsByMember[member.name]) : "";
          measureContext.font = included ? "600 15px system-ui, sans-serif" : "500 16px system-ui, sans-serif";
          return { included, payer: payment.payer === member.name, lines: included ? wrapText(measureContext, value, colWidth - 8) : [] };
        });
        measureContext.font = "500 13px system-ui, sans-serif";
        const paidLines = member.paid ? wrapText(measureContext, `결제 ${won(member.paid)}`, nameWidth - 12) : [];
        measureContext.font = "700 16px system-ui, sans-serif";
        const netLabel = `${member.net > 0 ? "+" : member.net < 0 ? "−" : ""}${won(Math.abs(member.net))}`;
        const netLines = wrapText(measureContext, netLabel, netWidth - 12);
        const rowHeight = Math.max(46, netLines.length * 20 + 12, nameLines.length * 17 + paidLines.length * 16 + 12, ...cellValues.map((cell) => cell.lines.length * 17 + 12));
        commands.push({ type: "line", role: "row-guide", x1: left, x2: matrixRight, y: rowY + rowHeight, color: "#e4e9e6" });
        nameLines.forEach((line, index) => centered(line, left + 6, rowY + rowHeight / 2 - (nameLines.length * 17 + paidLines.length * 16) / 2 + 8.5 + index * 17, { font: "600 16px system-ui, sans-serif", maxWidth: nameWidth - 12 }));
        cellValues.forEach((cell, column) => {
          colWidth = columnWidths[column];
          if (cell.included || cell.payer) commands.push({
            type: "rect", x: columnLefts[column] + 3, y: rowY + 7,
            width: colWidth - 6, height: rowHeight - 14, fill: cell.payer ? "#376653" : "#e9eeeb",
            paymentId: pagePayments[column].id, memberName: member.name, payer: cell.payer, included: cell.included,
          });
          cell.lines.forEach((line, lineIndex) => centered(line, columnLefts[column] + colWidth / 2, rowY + rowHeight / 2 + (lineIndex - (cell.lines.length-1)/2) * 17, {
            font: cell.included ? "600 15px system-ui, sans-serif" : "500 16px system-ui, sans-serif",
            color: cell.payer ? "#ffffff" : "#293532", maxWidth: colWidth - 8, align: "center",
          }));
        });
        paidLines.forEach((value, index) => centered(value, left + 6, rowY + rowHeight / 2 - (nameLines.length * 17 + paidLines.length * 16)/2 + nameLines.length * 17 + 8 + index * 16, {
          font: "500 13px system-ui, sans-serif", color: "#75817c", maxWidth: nameWidth - 12,
        }));
        netLines.forEach((line, index) => centered(line, netLeft + netWidth / 2, rowY + rowHeight / 2 + (index-(netLines.length-1)/2)*20, {
          font: "700 16px system-ui, sans-serif", color: member.net > 0 ? "#245345" : "#293532", align: "center", maxWidth: netWidth - 12,
        }));
        y += rowHeight;
      });
      gap(7);
      matrixPageLayouts.push({
        pageIndex,
        paymentCount: pagePayments.length,
        width: matrixWidths[pageIndex] || nameWidth + nameGap + netWidth,
        height: y - pageStartY,
        nameLeft: left,
        nameWidth,
        nameRight: left + nameWidth,
        netLeft,
        netWidth,
        resultGap: resultGap,
        paymentColumnLefts: columnLefts.slice(),
        maxPaymentColumnWidth: Math.max(0, ...columnWidths),
        columnWidths: columnWidths.slice(),
      });
    });
    [["정산 참여", "#e9eeeb"], ["결제자", "#376653"]].forEach(([label, fill], index) => {
      const x = left + index * 120;
      commands.push({ type: "rect", x, y: y + 2, width: 12, height: 12, fill });
      inlineText(label, x + 19, y, { font: "400 13px system-ui, sans-serif", color: "#75817c", maxWidth: 95 });
    });
    const summaryRight = summaryX - 24;
    const transferRight = Math.max(left, ...transferLayouts.map((group) => group.x + group.width));
    const matrixRight = left + Math.max(0, ...matrixWidths);
    const legendRight = left + legendWidth;
    const contentRight = Math.max(summaryRight, transferRight, matrixRight, legendRight);
    return {
      commands,
      width: Math.ceil(canvasWidth),
      height: Math.ceil(y + 36),
      metrics: {
        minimumWidth: LOGICAL_WIDTH,
        matrixColumnsPerPage,
        matrixPages: matrixPageLayouts,
        summaryRight,
        transferRight,
        matrixRight,
        legendRight,
        contentRight,
        leftMargin: left,
        rightMargin: Math.ceil(canvasWidth) - contentRight,
        transferGroups: transferLayouts,
        widthDriver: summaryWidth >= Math.max(...matrixWidths, legendWidth, transferWidth) ? "summary"
          : Math.max(...matrixWidths) >= Math.max(legendWidth, transferWidth) ? "matrix"
            : transferWidth >= legendWidth ? "transfers" : "legend",
      },
    };
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
    const layout = createLayout(model, measureContext, options);
    const requestedScale = Math.min(Number(options.scale) || 2, 2);
    const safeScale = Math.min(requestedScale, Math.sqrt(MAX_PIXELS / (layout.width * layout.height)));
    const scale = safeScale;
    const canvas = canvasFactory();
    canvas.width = Math.ceil(layout.width * scale);
    canvas.height = Math.ceil(layout.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D를 사용할 수 없습니다.");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#f4f6f5";
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.textBaseline = "top";

    layout.commands.forEach((command) => {
      if (command.type === "direction") {
        ctx.strokeStyle = command.color;
        ctx.lineWidth = 1.8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Anchor the outgoing horizontal stroke (viewBox y=15) to the text's optical center.
        const px = value => command.x + value * command.width / 24;
        const py = value => command.y + (value - 15) * command.width / 24;
        ctx.beginPath();
        ctx.moveTo(px(4), py(3));
        ctx.lineTo(px(4), py(11));
        ctx.quadraticCurveTo(px(4), py(15), px(8), py(15));
        ctx.lineTo(px(20), py(15));
        ctx.moveTo(px(15), py(10));
        ctx.lineTo(px(20), py(15));
        ctx.lineTo(px(15), py(20));
        ctx.stroke();
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
        return;
      }
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
      ctx.textBaseline = command.baseline || "top";
      ctx.font = command.font;
      ctx.fillStyle = command.color;
      ctx.textAlign = command.align;
      ctx.fillText(command.value, command.x, command.y);
    });
    return { canvas, logicalWidth: layout.width, logicalHeight: layout.height, scale, commands: layout.commands, metrics: layout.metrics };
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
