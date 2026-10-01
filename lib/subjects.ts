// Single source of truth for which class+subject combinations the portal
// supports — used by the chat API (to validate requests) and the frontend
// selector (to populate its pills). The ingestion config
// (scripts/ingest/config.ts) pairs these with book codes.
export interface ClassSubject {
  class: number;
  subject: string;
}

// CA (Chartered Accountancy, ICAI study material) sits alongside the school
// classes as its own "class". The chunks table stores class as a number, so
// CA is stored as 100 — well clear of any school class — and only shown as
// "CA" in the UI and prompt (see classLabel).
export const CA_CLASS = 100;

export const CLASSES = [7, 8, 9, 10, 11, 12, CA_CLASS] as const;

// Not every subject applies to every class: Classes 7-10 use a single
// combined "Science" book, but NCERT splits Science into three separate
// subjects (Physics/Chemistry/Biology) starting Class 11 — there's no
// unified "Science" book at that level, so the subject set itself changes
// per class rather than being a flat list shared across all classes.
export const SUBJECTS_BY_CLASS: Record<number, string[]> = {
  7: ["Mathematics", "Science", "Social Science", "English"],
  8: ["Mathematics", "Science", "Social Science", "English"],
  9: ["Mathematics", "Science", "Social Science", "English"],
  10: ["Mathematics", "Science", "Social Science", "English"],
  11: ["Physics", "Chemistry", "Biology", "Accountancy", "Business Studies", "Economics"],
  12: ["Physics", "Chemistry", "Biology", "Accountancy", "Business Studies", "Economics"],
  // Ingested from local PDFs via scripts/ingest/ingest-local.ts (--class CA).
  [CA_CLASS]: ["Taxation"],
};

export const AVAILABLE_SUBJECTS: ClassSubject[] = CLASSES.flatMap((c) =>
  SUBJECTS_BY_CLASS[c].map((s) => ({ class: c, subject: s }))
);

export function isAvailable(studentClass: number, subject: string): boolean {
  return AVAILABLE_SUBJECTS.some((a) => a.class === studentClass && a.subject === subject);
}

export function isCA(studentClass: number): boolean {
  return studentClass === CA_CLASS;
}

/** "Class 10", or "CA" for the CA pseudo-class. */
export function classLabel(studentClass: number): string {
  return isCA(studentClass) ? "CA" : `Class ${studentClass}`;
}

/** What the source material is called for this class, e.g. in UI copy. */
export function materialLabel(studentClass: number): string {
  return isCA(studentClass) ? "study material" : "textbook";
}
