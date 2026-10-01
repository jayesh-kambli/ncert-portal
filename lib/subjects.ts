// Single source of truth for which class+subject combinations the portal
// supports — used by the chat API (to validate requests) and the frontend
// selector (to populate its pills). The ingestion config
// (scripts/ingest/config.ts) pairs these with book codes.
export interface ClassSubject {
  class: number;
  subject: string;
}

export const CLASSES = [7, 8, 9, 10, 11, 12] as const;

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
  // "CA: Taxation" is CA (ICAI) study material, not an NCERT book — ingested
  // from local PDFs via scripts/ingest/ingest-local.ts and filed under Class 12
  // since every chunk row needs a class.
  12: ["Physics", "Chemistry", "Biology", "Accountancy", "Business Studies", "Economics", "CA: Taxation"],
};

export const AVAILABLE_SUBJECTS: ClassSubject[] = CLASSES.flatMap((c) =>
  SUBJECTS_BY_CLASS[c].map((s) => ({ class: c, subject: s }))
);

export function isAvailable(studentClass: number, subject: string): boolean {
  return AVAILABLE_SUBJECTS.some((a) => a.class === studentClass && a.subject === subject);
}
