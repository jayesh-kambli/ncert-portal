// Single source of truth for which class+subject combinations the portal
// supports — used by the chat API (to validate requests) and the frontend
// selector (to populate its dropdowns). The ingestion config
// (scripts/ingest/config.ts) pairs these with book codes.
export interface ClassSubject {
  class: number;
  subject: string;
}

export const CLASSES = [7, 8, 9, 10] as const;
export const SUBJECTS = ["Mathematics", "Science", "Social Science", "English"] as const;

export const AVAILABLE_SUBJECTS: ClassSubject[] = CLASSES.flatMap((c) =>
  SUBJECTS.map((s) => ({ class: c, subject: s }))
);

export function isAvailable(studentClass: number, subject: string): boolean {
  return AVAILABLE_SUBJECTS.some((a) => a.class === studentClass && a.subject === subject);
}
