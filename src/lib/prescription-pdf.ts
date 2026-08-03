import { jsPDF } from "jspdf";

const NAVY = "#1A2A41";
const AMBER = "#D4A04A";

export interface PrescriptionPdfInput {
  branch: string;
  patientName: string;
  age?: number | null;
  gender?: string | null;
  patientCode?: string | null;
  tokenNumber?: string | null;
  chiefComplaint?: string | null;
  doctorNotes?: string | null;
  nextVisitDate?: string | null;
  // Owner-editable "SLX kaise lena hai" text (Rx improvements item E) --
  // falls back to the old hardcoded line if not supplied, so existing
  // callers that don't pass this yet don't lose the SLX note entirely.
  slxInstructions?: string | null;
  rows: {
    medicine_name: string;
    potency: string;
    dose: string;
    frequency: string;
    duration_days: number;
    is_slx?: boolean;
    // Sequenced dosing (item D) -- days after the Rx date this medicine
    // actually starts. 0/undefined = starts same day as always.
    start_offset_days?: number;
  }[];
}

export function downloadPrescriptionPdf(input: PrescriptionPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 0;

  // Header band
  doc.setFillColor(NAVY);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Yadav Homeo Clinic", margin, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(input.branch || "", margin, 56);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(11);
  doc.text("Dr. Anavil Yadav", pageWidth - margin, 38, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const dateStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  doc.text(dateStr, pageWidth - margin, 56, { align: "right" });

  y = 120;
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(input.patientName || "—", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const meta = [
    input.age ? `${input.age}y` : null,
    input.gender || null,
    input.patientCode || null,
    input.tokenNumber ? `Token ${input.tokenNumber}` : null,
  ].filter(Boolean).join("  •  ");
  y += 16;
  doc.text(meta, margin, y);

  if (input.chiefComplaint) {
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.text("Chief Complaint:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(input.chiefComplaint, pageWidth - margin * 2 - 100), margin + 100, y);
  }

  y += 26;
  doc.setDrawColor(AMBER);
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageWidth - margin, y);

  y += 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("℞ Prescription", margin, y);
  y += 10;

  const nonSlx = input.rows.filter((r) => !r.is_slx);
  nonSlx.forEach((r, i) => {
    y += 24;
    if (y > 760) {
      doc.addPage();
      y = 60;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${i + 1}. ${r.medicine_name} ${r.potency}`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const startNote = r.start_offset_days ? ` — Day ${r.start_offset_days + 1} se shuru` : "";
    doc.text(`${r.dose} — ${r.frequency} — ${r.duration_days} din${startNote}`, margin + 16, y + 14);
  });

  const hasSlx = input.rows.some((r) => r.is_slx);
  if (hasSlx) {
    y += 30;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const slxLines = doc.splitTextToSize(input.slxInstructions || "+ Placebo (SLX) globules as instructed", pageWidth - margin * 2);
    doc.text(slxLines, margin, y);
    y += (slxLines.length - 1) * 11;
    doc.setTextColor(NAVY);
  }

  if (input.doctorNotes) {
    y += 30;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Notes:", margin, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(input.doctorNotes, pageWidth - margin * 2);
    doc.text(lines, margin, y + 14);
    y += 14 + lines.length * 12;
  }

  if (input.nextVisitDate) {
    y += 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Next visit: ${input.nextVisitDate}`, margin, y);
  }

  const filename = `Rx-${(input.patientName || "patient").replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
