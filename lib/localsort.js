// Sorting without Claude Code (for machines that do not have it): the dump is
// split into lines and sentences, and each piece is filed by the project names
// and keywords it mentions. Cruder than Claude; the same review step follows.

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;
const BULLET = /^\s*([-*•·]|\d+[.)]|\[ ?\])\s*/;
const LEAD = /^(?:(?:ok(?:ay)?|so|and|also|oh|plus|then|but)[,\s]+)*(?:i\s+(?:really\s+|still\s+|also\s+)?(?:need|have|got|must|should|want)\s+to|i'?ll|i\s+will|need\s+to|have\s+to|must|should|remember\s+to|don'?t\s+forget\s+to|to\s?do:?)\s+/i;

const FILLER = /^(?:(?:ok(?:ay)?|so|and|also|oh|plus|then|but)[,\s]+)+/i;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pieces(dump) {
  return dump
    .split(/\n+/)
    .map((line) => line.replace(BULLET, ""))
    .flatMap((line) => line.split(/;\s*|(?<=[.!?])\s+(?=[A-Z0-9¿¡])|,?\s+and also\s+|,\s+also\s+/))
    .map((p) => p.trim())
    .filter((p) => p.replace(URL_RE, "").replace(/[^\p{L}\p{N}]/gu, "").length >= 3);
}

function clean(piece) {
  let t = piece.replace(LEAD, "").replace(FILLER, "").replace(/\b[Pp][01]\b[:\s]*/g, "")
    .replace(/[,;]?\s*(?:it'?s\s+|this is\s+)?(?:urgent|asap)\b[!.]*/gi, "").replace(/\s{2,}/g, " ").trim();
  t = t.replace(/[.;,]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function priorityOf(piece) {
  if (/\b(p0|urgent|asap)\b/i.test(piece)) return "P0";
  if (/\bp1\b/i.test(piece)) return "P1";
  return "";
}

function terms(project) {
  return [project.name, ...project.keywords.split(",")]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !/^anything not tied/.test(t));
}

function projectFor(piece, projects) {
  const text = piece.toLowerCase();
  let best = "general", score = 0;
  for (const p of projects) {
    if (p.id === "general") continue;
    const n = terms(p).filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, "u").test(text)).length;
    if (n > score) { best = p.id; score = n; }
  }
  return best;
}

function sortLocally(data, dump) {
  const open = new Set(data.items.filter((i) => !i.done).map((i) => i.text.toLowerCase()));
  const out = [];
  for (const piece of pieces(dump)) {
    const links = (piece.match(URL_RE) || []).map((u) => u.replace(/[.,;:]+$/, ""));
    const text = clean(piece.replace(URL_RE, "").replace(/\s+([.,;:])/g, "$1"));
    if (!text || open.has(text.toLowerCase())) continue;
    out.push({ project: projectFor(piece, data.projects), newProject: "", text, links, priority: priorityOf(piece) });
  }
  return out;
}

module.exports = { sortLocally, pieces, clean };
