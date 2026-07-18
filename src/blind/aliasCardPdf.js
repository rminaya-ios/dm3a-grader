// src/blind/aliasCardPdf.js
// DM3A Grader — Blind Grading Mode, alias card PDF (spec §2.4)
// One page(s) of alias slips (student name + alias) for week-1 distribution.
// Built entirely client-side via pdf-lib (consistent with the existing PDF stack).
// Never uploaded — the instructor is the only party that sees name↔alias together.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function buildAliasCardPdf(courseCode, students) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612, pageH = 792, margin = 36;
  const cols = 2, rowsPerPage = 8, perPage = cols * rowsPerPage;
  const cardW = (pageW - margin * 2) / cols;
  const cardH = (pageH - margin * 2) / rowsPerPage;
  const brand = rgb(0.157, 0.376, 0.784); // #2860C8
  const muted = rgb(0.4, 0.4, 0.4);

  let page;
  students.forEach((s, i) => {
    const idx = i % perPage;
    if (idx === 0) page = pdf.addPage([pageW, pageH]);
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = margin + col * cardW;
    const y = pageH - margin - (row + 1) * cardH;

    page.drawRectangle({ x: x + 4, y: y + 4, width: cardW - 8, height: cardH - 8, borderColor: brand, borderWidth: 1 });
    page.drawText(`${courseCode}`, { x: x + 14, y: y + cardH - 22, size: 8, font, color: muted });
    const name = `${s.firstName || ''} ${s.lastName || ''}`.trim() || '(unnamed)';
    page.drawText(name, { x: x + 14, y: y + cardH - 40, size: 12, font });
    page.drawText(s.alias, { x: x + 14, y: y + cardH - 66, size: 20, font: bold, color: brand });
    page.drawText('Write this DM3A ID — not your name — on all work.', { x: x + 14, y: y + 14, size: 7.5, font, color: muted });
  });

  return pdf.save(); // Uint8Array
}
