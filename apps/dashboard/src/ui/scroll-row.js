/**
 * Rangées qui défilent horizontalement (onglets, filtres) quand elles sont plus larges que leur place.
 *  - Un fondu sur le bord où il reste des éléments signale qu'on peut faire défiler (classes fade-start / fade-end).
 *  - À la souris, la molette fait défiler la rangée ; l'élément choisi revient entièrement à l'écran.
 */
const ROWS = ".tabs, .chips.scroll-x, .chart-metric, .settings-nav";

function update(row) {
  const hidden = row.scrollWidth - row.clientWidth;
  row.classList.toggle("fade-start", hidden > 2 && row.scrollLeft > 2);
  row.classList.toggle("fade-end", hidden > 2 && row.scrollLeft < hidden - 2);
}

function reveal(row, item) {
  const rowBox = row.getBoundingClientRect();
  const itemBox = item.getBoundingClientRect();
  const margin = 44; // sort l'élément du fondu
  if (itemBox.left < rowBox.left + margin) row.scrollBy({ left: itemBox.left - rowBox.left - margin, behavior: "smooth" });
  else if (itemBox.right > rowBox.right - margin) row.scrollBy({ left: itemBox.right - rowBox.right + margin, behavior: "smooth" });
}

export function initScrollRows(root = document) {
  const resized = new ResizeObserver((entries) => entries.forEach((entry) => update(entry.target)));
  for (const row of root.querySelectorAll(ROWS)) {
    update(row);
    resized.observe(row);
    // Le contenu change (compteurs des filtres, catégories) sans que la rangée change de taille.
    new MutationObserver(() => update(row)).observe(row, { childList: true, subtree: true, characterData: true });
    row.addEventListener("scroll", () => update(row), { passive: true });
    row.addEventListener("wheel", (event) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const before = row.scrollLeft;
      row.scrollLeft += event.deltaY;
      // On ne retient la molette que si la rangée a réellement défilé : sinon la page continue de défiler.
      if (row.scrollLeft !== before) event.preventDefault();
    }, { passive: false });
    row.addEventListener("click", (event) => {
      const item = event.target.closest("button, a, [role='tab']");
      if (item && row.contains(item)) reveal(row, item);
    });
  }
}
