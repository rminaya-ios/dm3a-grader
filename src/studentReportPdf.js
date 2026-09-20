// PDF for the Student Report. Split from StudentReport.jsx so that file exports
// only components (React Fast Refresh). Uses the same jsPDF generator and the
// same navy/gold/level palette as the instructor report, so the two files look
// like one product.

// Strip characters jsPDF's built-in Helvetica cannot encode — same normalization
// the instructor PDF applies, so the two files read alike.
const pdfSafe = (s) => String(s || "")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, "-").replace(/…/g, "...")
  .replace(/°/g, " deg").replace(/·/g, "-").replace(/≈/g, "~")
  // eslint-disable-next-line no-control-regex -- jsPDF's Helvetica is Latin-1 only
  .replace(/[^\x00-\xFF]/g, "");

// ── PDF. Same generator the instructor report uses (jsPDF, dynamically imported)
// and the same navy/gold/level palette, so the two files look like one product. ──
export async function generateStudentReportPDF(data) {
  const { jsPDF } = await import("jspdf");
  const NAVY = [10, 22, 40], GOLD = [201, 168, 76], WHITE = [255, 255, 255], LIGHT = [248, 247, 244];
  const RGB = { P4: [15, 110, 86], P3: [24, 95, 165], P2: [133, 79, 11], P1: [163, 45, 45] };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 15, BOT = 275;
  let y = 40; // running cursor, in mm from the top of the current page
  // Break to a new page when the next block will not fit.
  const room = (h) => { if (y + h > BOT) { doc.addPage(); y = 20; } };

  // Header bar
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 28, "F");
  doc.setFillColor(...GOLD); doc.rect(0, 28, W, 2, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("DM3A Grader", M, 12);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Mastery-Based Assessment Report", M, 19);
  doc.text(pdfSafe(`${data.assignment}${data.courseCode ? ` · ${data.courseCode}` : ""}`), M, 25);
  doc.setTextColor(0, 0, 0);

  // Name + overall badge
  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text(pdfSafe(data.name), M, y);
  const tc = RGB[data.overall] || [80, 80, 80];
  doc.setFillColor(...tc); doc.roundedRect(W - M - 22, y - 9, 22, 10, 2, 2, "F");
  doc.setTextColor(...WHITE); doc.setFontSize(11);
  doc.text(data.overall, W - M - 11, y - 3, { align: "center" });
  doc.setTextColor(0, 0, 0);
  y += 6;
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(90, 90, 85);
  doc.text(pdfSafe(`Graded ${data.dateGraded}`), M, y);
  doc.setTextColor(0, 0, 0);

  // Dimensions
  if (data.dimensions.length > 0) {
    y += 8;
    doc.setFillColor(...LIGHT); doc.rect(M, y, W - M * 2, 24, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(90, 90, 85);
    doc.text("DIMENSIONS", M + 3, y + 5);
    const colW = (W - M * 2) / data.dimensions.length;
    data.dimensions.forEach((d, i) => {
      const x = M + i * colW + colW / 2;
      doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...(RGB[d.level] || [80, 80, 80]));
      doc.text(d.level, x, y + 16, { align: "center" });
      doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(90, 90, 85);
      doc.text(pdfSafe(d.label), x, y + 22, { align: "center" });
    });
    doc.setTextColor(0, 0, 0);
    y += 30;
  } else {
    y += 8;
  }

  // Problem breakdown — the student version carries the full prose, so each
  // problem is a wrapped block rather than the instructor PDF's one-line row.
  if (data.problems.length > 0) {
    room(14);
    doc.setFillColor(...NAVY); doc.rect(M, y, W - M * 2, 6, "F");
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...WHITE);
    doc.text("PROBLEM BREAKDOWN", M + 3, y + 4.5);
    doc.setTextColor(0, 0, 0);
    y += 10;
    const TW = W - M * 2 - 6;
    data.problems.forEach((p) => {
      const ptc = RGB[p.level] || [80, 80, 80];
      const head = pdfSafe(`Problem ${p.id}${p.description ? ` — ${p.description}` : ""}`);
      doc.setFontSize(9); doc.setFont("helvetica", "bold");
      const headLines = doc.splitTextToSize(head, TW - 14);
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
      const procLines = p.processAssessment ? doc.splitTextToSize(pdfSafe(`Process: ${p.processAssessment}`), TW) : [];
      const reasLines = p.reasoning ? doc.splitTextToSize(pdfSafe(p.reasoning), TW) : [];
      const blockH = headLines.length * 5 + (procLines.length + reasLines.length) * 4.2 + 8;
      room(blockH);
      doc.setDrawColor(...ptc); doc.setLineWidth(1);
      doc.line(M, y - 1, M, y + blockH - 4);
      doc.setLineWidth(0.2);
      let ty = y + 3;
      doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
      doc.text(headLines, M + 3, ty);
      doc.setTextColor(...ptc);
      doc.text(p.level, W - M - 2, ty, { align: "right" });
      doc.setTextColor(0, 0, 0);
      ty += headLines.length * 5;
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(50, 50, 50);
      if (procLines.length) { doc.text(procLines, M + 3, ty); ty += procLines.length * 4.2 + 1; }
      if (reasLines.length) { doc.setTextColor(90, 90, 85); doc.text(reasLines, M + 3, ty); }
      doc.setTextColor(0, 0, 0);
      y += blockH;
    });
  }

  // Personalized feedback
  y += 4;
  room(20);
  doc.setFillColor(...LIGHT); doc.rect(M, y, W - M * 2, 5, "F");
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY);
  doc.text("PERSONALIZED FEEDBACK", M + 3, y + 3.5);
  doc.setTextColor(0, 0, 0); y += 9;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  if (data.feedback) {
    const lines = doc.splitTextToSize(pdfSafe(data.feedback), W - M * 2 - 4);
    room(lines.length * 4.6);
    doc.text(lines, M + 2, y);
    y += lines.length * 4.6 + 3;
  }
  const list = (label, items, rgb) => {
    if (!items.length) return;
    const lines = doc.splitTextToSize(pdfSafe(`${label} ${items.join(", ")}`), W - M * 2 - 4);
    room(lines.length * 4.6 + 2);
    doc.setTextColor(...rgb); doc.setFontSize(9);
    doc.text(lines, M + 2, y);
    doc.setTextColor(0, 0, 0);
    y += lines.length * 4.6 + 2;
  };
  list("Strengths:", data.strengths, RGB.P4);
  list("Growth areas:", data.growthAreas, RGB.P3);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(150, 150, 150);
    doc.text(pdfSafe(`Generated by DM3A Grader · Dr. Ralph Minaya, Ed.D. · ${data.dateGraded}`), M, 290);
  }
  doc.setTextColor(0, 0, 0);
  return doc;
}
