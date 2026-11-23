import { $, $$, escapeHtml } from "../utils/dom.js";
import { avatarMarkup } from "./avatar.js";
import { icon } from "./icons.js";
import { lockScroll, trapFocus, unlockScroll } from "./overlay.js";

/**
 * Recherche rapide (Ctrl/⌘ + K) : aller à une page, lancer une action ou retrouver un client en quelques touches.
 * Les pages, actions et conversations sont fournies par app.js : ce module ne connaît aucune fonctionnalité métier.
 */
let providers = { pages: () => [], actions: () => [], conversations: () => [] };
let results = [];
let activeIndex = 0;
let releaseFocus = null;
let previousFocus = null;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");

/** Minuscules sans accents : « Résumé » et « resume » se trouvent l'un l'autre. */
export function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matches(haystack, tokens) {
  const text = normalize(haystack);
  return tokens.every((token) => text.includes(token));
}

function search(query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const digits = query.replace(/\D/g, "");
  const groups = [];

  const pages = providers.pages().filter((item) => !tokens.length || matches(`${item.label} ${item.keywords || ""}`, tokens));
  const actions = providers.actions().filter((item) => !tokens.length || matches(`${item.label} ${item.keywords || ""}`, tokens));
  const conversations = tokens.length
    ? providers.conversations().filter((item) => matches(item.label, tokens) || (digits.length >= 3 && String(item.phone || "").includes(digits))).slice(0, 6)
    : [];

  if (conversations.length) groups.push({ title: "Clients", items: conversations });
  if (pages.length) groups.push({ title: "Aller à", items: pages });
  if (actions.length) groups.push({ title: "Actions", items: actions });
  return groups;
}

function itemMarkup(item, index) {
  const visual = item.avatar ? avatarMarkup(item.label, { seed: item.phone || item.label }) : `<span class="icon-tile">${icon(item.icon || "arrow-right")}</span>`;
  return `<button type="button" class="palette-item${index === activeIndex ? " is-active" : ""}" role="option" aria-selected="${index === activeIndex}" data-index="${index}">
    ${visual}
    <span class="palette-text"><span>${escapeHtml(item.label)}</span>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ""}</span>
    <span class="palette-hint">${icon("enter", "icon-xs")}</span>
  </button>`;
}

function render() {
  const query = $("#palette-input").value;
  const groups = search(query);
  results = groups.flatMap((group) => group.items);
  if (activeIndex >= results.length) activeIndex = Math.max(0, results.length - 1);
  const box = $("#palette-results");
  if (!results.length) {
    box.innerHTML = `<p class="palette-empty">Aucun résultat pour « ${escapeHtml(query.trim())} ».</p>`;
    return;
  }
  let index = 0;
  box.innerHTML = groups.map((group) => `<p class="palette-group">${escapeHtml(group.title)}</p>${group.items.map((item) => itemMarkup(item, index++)).join("")}`).join("");
}

function setActive(index, { scroll = true } = {}) {
  if (!results.length) return;
  activeIndex = (index + results.length) % results.length;
  $$(".palette-item", $("#palette-results")).forEach((element, position) => {
    const active = position === activeIndex;
    element.classList.toggle("is-active", active);
    element.setAttribute("aria-selected", String(active));
    if (active && scroll) element.scrollIntoView({ block: "nearest" });
  });
}

function run(index) {
  const item = results[index];
  if (!item) return;
  closePalette({ restoreFocus: false });
  item.run();
}

export function isPaletteOpen() {
  return !$("#command-palette")?.classList.contains("hidden");
}

export function openPalette() {
  const palette = $("#command-palette");
  if (!palette || isPaletteOpen()) return;
  previousFocus = document.activeElement;
  palette.classList.remove("hidden");
  lockScroll();
  releaseFocus = trapFocus(palette);
  const input = $("#palette-input");
  input.value = "";
  activeIndex = 0;
  render();
  input.focus();
}

export function closePalette({ restoreFocus = true } = {}) {
  const palette = $("#command-palette");
  if (!palette || !isPaletteOpen()) return;
  palette.classList.add("hidden");
  releaseFocus?.();
  releaseFocus = null;
  unlockScroll();
  if (restoreFocus && previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
}

// Changement de page ou déconnexion : la recherche rapide ne reste pas ouverte par-dessus.
document.addEventListener("brayano:close-overlays", () => closePalette({ restoreFocus: false }));

/**
 * @param {{ pages: () => Array, actions: () => Array, conversations: () => Array, isAvailable?: () => boolean }} options
 * Chaque élément : { label, hint?, icon?, keywords?, avatar?, phone?, run }.
 */
export function initCommandPalette(options) {
  providers = { ...providers, ...options };
  const palette = $("#command-palette");
  if (!palette) return;
  const available = options.isAvailable || (() => true);

  $$("[data-shortcut-label]").forEach((element) => { element.textContent = isMac ? "⌘K" : "Ctrl K"; });

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-open-palette]")) {
      event.preventDefault();
      openPalette();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
      if (!available()) return;
      event.preventDefault();
      if (isPaletteOpen()) closePalette();
      else openPalette();
    }
  });

  const input = $("#palette-input");
  input.addEventListener("input", () => {
    activeIndex = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); run(activeIndex); }
  });
  palette.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePalette();
    }
  });
  palette.addEventListener("mousedown", (event) => { if (event.target === palette) closePalette(); });
  $("#palette-close")?.addEventListener("click", () => closePalette());

  const box = $("#palette-results");
  box.addEventListener("click", (event) => {
    const element = event.target.closest(".palette-item");
    if (element) run(Number(element.dataset.index));
  });
  box.addEventListener("mousemove", (event) => {
    const element = event.target.closest(".palette-item");
    if (element && Number(element.dataset.index) !== activeIndex) setActive(Number(element.dataset.index), { scroll: false });
  });
}
