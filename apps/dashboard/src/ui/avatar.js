import { escapeHtml } from "../utils/dom.js";
import { initials } from "../utils/format.js";

/** Teintes choisies pour rester lisibles en clair comme en sombre (voir .avatar dans components.css). */
const HUES = [216, 262, 330, 12, 32, 152, 174, 196, 288, 48];

/** Une même personne garde toujours la même couleur : la teinte est calculée à partir de son nom ou de son numéro. */
export function avatarHue(seed = "") {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

/**
 * Pastille ronde avec les initiales.
 * @param {string} name nom affiché (sert aux initiales)
 * @param {{ seed?: string, size?: "sm" | "lg" | "xl", className?: string }} options
 */
export function avatarMarkup(name, { seed, size, className = "" } = {}) {
  const label = String(name || "").trim();
  const text = /[\p{L}]/u.test(label) ? initials(label) : "#";
  const classes = ["avatar", size ? `avatar-${size}` : "", className].filter(Boolean).join(" ");
  return `<span class="${classes}" style="--h:${avatarHue(seed || label)}" aria-hidden="true">${escapeHtml(text)}</span>`;
}
