// Microsoft Forms results: at the end of a module the learner opens a pre-filled form and presses
// Submit, and the response lands in the form's Excel sheet. No server or Azure needed.
//
// config.json → "resultsForm": a pre-filled link from Forms (… → Get pre-filled URL) where each
// answer was typed as one of these words. The app swaps each word for the learner's details.
export const FORM_TOKENS = ['NAME', 'OFFICE', 'MODULE', 'SCORE', 'RESULT', 'CORRECT', 'MINUTES', 'COMPLETED'];

const tokenOf = (v) => {
  const t = String(v || '').trim().replace(/^[{[<(]+|[}\]>)]+$/g, '').toUpperCase();
  return FORM_TOKENS.includes(t) ? t : null;
};

/** True when the link looks like a usable Microsoft Forms pre-filled link with at least one token. */
export function isFormTemplate(template) {
  try {
    const u = new URL(template);
    return /^https:$/.test(u.protocol) && [...u.searchParams.values()].some(tokenOf);
  } catch {
    return false;
  }
}

/** Builds the learner's pre-filled link. `values` is keyed by token, e.g. { NAME: 'Sam', SCORE: 90 }. */
export function formLink(template, values) {
  const u = new URL(template);
  for (const [k, v] of [...u.searchParams.entries()]) {
    const t = tokenOf(v);
    if (t) u.searchParams.set(k, values[t] == null ? '' : String(values[t]));
  }
  return u.toString();
}

/** Local date and time as "2026-11-16 14:05", which Excel reads as a date. */
export function formDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
