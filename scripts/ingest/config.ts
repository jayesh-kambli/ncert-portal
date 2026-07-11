import type { ClassSubject } from "../../lib/subjects";

export interface IngestTarget extends ClassSubject {
  /** One or more book codes making up this subject's full syllabus for this class. */
  bookCodes: string[];
}

// English-medium editions only. Scoped to Mathematics/Science/Social
// Science/English — see the plan doc for why Hindi/Sanskrit/Urdu-as-subjects
// and Arts/Physical Education/Vocational Education are excluded for now.
//
// Book codes were extracted from ncert.nic.in/textbook.php's cascading
// dropdown JS (the first matching class+subject `else if` block wins, per
// how the site's own selector resolves duplicate/legacy entries left over
// from its NCF curriculum transition). Social Science in particular may
// have more constituent books (History/Geography/Civics/Economics) than
// listed here — verify against the live site before assuming this list is
// complete for a given class.
export const INGEST_TARGETS: IngestTarget[] = [
  { class: 7, subject: "Mathematics", bookCodes: ["gegp1", "gegp2"] },
  { class: 7, subject: "Science", bookCodes: ["gecu1"] },
  { class: 7, subject: "English", bookCodes: ["gepr1"] },
  { class: 7, subject: "Social Science", bookCodes: ["gees1", "gees2"] },

  { class: 8, subject: "Mathematics", bookCodes: ["hegp1", "hegp2"] },
  { class: 8, subject: "Science", bookCodes: ["hecu1"] },
  { class: 8, subject: "English", bookCodes: ["hepr1"] },
  { class: 8, subject: "Social Science", bookCodes: ["hees1"] },

  { class: 9, subject: "Mathematics", bookCodes: ["iemh1"] },
  { class: 9, subject: "Science", bookCodes: ["iesc1"] },
  { class: 9, subject: "English", bookCodes: ["iebe1"] },
  { class: 9, subject: "Social Science", bookCodes: ["iest1"] },

  { class: 10, subject: "Mathematics", bookCodes: ["jemh1"] },
  { class: 10, subject: "Science", bookCodes: ["jesc1"] },
  { class: 10, subject: "English", bookCodes: ["jeff1"] },
  // Contemporary India (Geography), Understanding Economic Development
  // (Economics), India and the Contemporary World-II (History), Democratic
  // Politics (Civics) — Social Science splits into 4 separate books for
  // Class 10, confirmed against the live site (the 3rd/4th parts were
  // missed on the first pass).
  { class: 10, subject: "Social Science", bookCodes: ["jess1", "jess2", "jess3", "jess4"] },
];

// Chapter titles are not hardcoded here — they're parsed from each PDF's own
// "CHAPTER N" heading during extraction, so they always match whatever
// edition/rationalization NCERT has published, instead of relying on
// (possibly stale) prior knowledge of the syllabus.

export const PDF_DIR = "data/pdfs";
export const TEXT_DIR = "data/text";
