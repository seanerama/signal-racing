/**
 * Sources cited on the Model page (Stage 9). Every entry was fetched and checked during Stage 9
 * (2026-10-08); `checked` records what the fetch confirmed. Nothing is cited from memory. Links
 * are shown as text too, since the app is offline-first and a link may simply fail offline.
 */
export interface Source {
  id: string;
  /** Citation text. */
  cite: string;
  url: string;
  /** What it supports on this page. */
  supports: string;
  /** What the Stage 9 fetch confirmed. */
  checked: string;
}

export const SOURCES: readonly Source[] = Object.freeze([
  {
    id: 'nasa-drag',
    cite: 'NASA Glenn Research Center, Beginner’s Guide to Aeronautics: “Drag Equation”.',
    url: 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/',
    supports: 'Rows 1–2: drag (and, with a lift coefficient, downforce) as ½ρ·C·A·v².',
    checked: 'Page in the Beginner’s Guide to Aeronautics; gives D = Cd·ρ·V²·A/2.',
  },
  {
    id: 'load-sensitivity',
    cite: 'Wikipedia: “Tire load sensitivity”.',
    url: 'https://en.wikipedia.org/wiki/Tire_load_sensitivity',
    supports: 'Row 7: the friction coefficient falls as vertical load rises.',
    checked:
      'States that in most real tires the friction coefficient decreases as vertical load increases.',
  },
  {
    id: 'friction-circle',
    cite: 'Wikipedia: “Circle of forces” (traction circle, friction circle, friction ellipse).',
    url: 'https://en.wikipedia.org/wiki/Circle_of_forces',
    supports:
      'Rows 20 and 22, and the grip circle: one force limit shared by braking, driving and cornering.',
    checked:
      'Describes the limit on a tire’s combined horizontal force, and its dependence on load.',
  },
  {
    id: 'rcvd',
    cite: 'W. F. Milliken and D. L. Milliken, Race Car Vehicle Dynamics, SAE International, 1995 (book).',
    url: 'https://millikenresearch.com/rcvd.html',
    supports: 'The g-g diagram the grip circle follows (cited as a book).',
    checked:
      'The authors’ page for the book: title, authors, published 1995, “g-g” Diagram analysis among its topics, sold through the SAE bookstore.',
  },
  {
    id: 'motec-i2',
    cite: 'MoTeC: i2 data analysis software (product page).',
    url: 'https://www.motec.com.au/i2/',
    supports: 'The report’s conventions: synced strips, a shared cursor, channel tables, CSV logs.',
    checked: 'Page exists (HTTP 200, title “MoTeC - I2”); its body is rendered by script.',
  },
]);
