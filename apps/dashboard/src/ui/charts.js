/**
 * Graphiques du tableau de bord, dessinés en SVG sans bibliothèque externe.
 *
 * Principes : une seule teinte pour une seule série, traits fins, grille discrète, valeur lisible au survol
 * (souris, doigt ou clavier) et tableau équivalent pour les lecteurs d'écran. Les libellés viennent de données
 * de l'entreprise : ils sont toujours insérés comme du texte, jamais comme du HTML.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** Graduations « rondes » (1, 2, 5 × 10ⁿ) couvrant la valeur maximale, en 3 ou 4 paliers. */
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) || 10 * magnitude;
  const safeStep = Math.max(step, 1);
  const ticks = [];
  for (let value = 0; value < max + safeStep - 1e-9; value += safeStep) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}

/**
 * Petite courbe de tendance pour une tuile de chiffre. Renvoie du balisage SVG (aucune donnée texte n'y figure).
 * @param {number[]} values
 */
export function sparklineMarkup(values, { width = 104, height = 34 } = {}) {
  if (!Array.isArray(values) || values.length < 2) return "";
  const max = Math.max(...values, 0);
  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = (index) => pad + (index / (values.length - 1)) * innerW;
  const y = (value) => pad + innerH - (max > 0 ? (value / max) * innerH : 0);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${height - 1} L${x(0).toFixed(1)},${height - 1} Z`;
  const lastX = x(values.length - 1).toFixed(1);
  const lastY = y(values[values.length - 1]).toFixed(1);
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">
    <path class="sparkline-area" d="${area}"></path>
    <path class="sparkline-line" d="${line}"></path>
    <circle class="sparkline-dot" cx="${lastX}" cy="${lastY}" r="3"></circle>
  </svg>`;
}

function columnPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
}

/**
 * Graphique en colonnes à une série (une valeur par jour).
 * @param {HTMLElement} container
 * @param {{ points: Array<{ label: string, shortLabel: string, tinyLabel?: string, value: number }>, formatValue?: (value: number) => string, formatAxis?: (value: number) => string, name: string }} options
 */
export function renderColumnChart(container, options) {
  container.chartOptions = options;
  if (!container.chartObserver && "ResizeObserver" in window) {
    let lastWidth = 0;
    container.chartObserver = new ResizeObserver(() => {
      const width = Math.round(container.clientWidth);
      if (width && width !== lastWidth) {
        lastWidth = width;
        draw(container);
      }
    });
    container.chartObserver.observe(container);
  }
  draw(container);
}

function draw(container) {
  const { points, formatValue = String, formatAxis = String, name } = container.chartOptions;
  const width = Math.max(240, Math.round(container.clientWidth || 600));
  const height = width < 520 ? 200 : 244;
  container.replaceChildren();
  container.classList.add("chart");

  const max = Math.max(...points.map((point) => point.value), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const axisLabels = ticks.map((tick) => formatAxis(tick));
  const margin = { top: 14, right: 8, bottom: 30, left: Math.max(30, Math.max(...axisLabels.map((label) => label.length)) * 6.6 + 12) };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const band = plotW / points.length;
  const barW = Math.max(3, Math.min(24, band * 0.58));
  const yOf = (value) => margin.top + plotH - (value / top) * plotH;

  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "chart-svg", role: "img", "aria-label": `${name} : ${points.map((point) => `${point.label} ${formatValue(point.value)}`).join(", ")}` });

  // Grille et graduations : discrètes, pleines, sans cadre.
  ticks.forEach((tick, index) => {
    const y = Math.round(yOf(tick)) + 0.5;
    root.append(svg("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: index === 0 ? "chart-axis" : "chart-grid" }));
    const label = svg("text", { x: margin.left - 8, y: y + 4, class: "chart-tick", "text-anchor": "end" });
    label.textContent = axisLabels[index];
    root.append(label);
  });

  // Libellés des jours : on en saute si la place manque, plutôt que de les faire se chevaucher.
  const useTiny = points.length > 10;
  const labelWidth = useTiny ? 26 : 54;
  const step = Math.max(1, Math.ceil(labelWidth / band));
  points.forEach((point, index) => {
    const fromEnd = points.length - 1 - index;
    if (fromEnd % step !== 0) return;
    const label = svg("text", { x: margin.left + band * index + band / 2, y: height - 9, class: "chart-tick", "text-anchor": "middle" });
    label.textContent = useTiny ? point.tinyLabel || point.shortLabel : point.shortLabel;
    root.append(label);
  });

  const columns = points.map((point, index) => {
    const x = margin.left + band * index + (band - barW) / 2;
    const h = point.value > 0 ? Math.max(2, (point.value / top) * plotH) : 0;
    const column = svg("path", { d: h ? columnPath(x, margin.top + plotH - h, barW, h, 4) : "", class: "chart-column" });
    root.append(column);
    return column;
  });

  // Zones de survol : toute la largeur du jour, bien plus grande que la colonne elle-même.
  const hits = points.map((point, index) => {
    const hit = svg("rect", { x: margin.left + band * index, y: margin.top, width: band, height: plotH + 4, class: "chart-hit", "data-index": index });
    root.append(hit);
    return hit;
  });
  container.append(root);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("role", "status");
  tooltip.hidden = true;
  const tooltipValue = document.createElement("strong");
  const tooltipLabel = document.createElement("span");
  tooltip.append(tooltipValue, tooltipLabel);
  container.append(tooltip);

  // Tableau équivalent pour les lecteurs d'écran : toutes les valeurs y sont, sans survol.
  const table = document.createElement("table");
  table.className = "sr-only";
  const caption = document.createElement("caption");
  caption.textContent = name;
  table.append(caption);
  for (const point of points) {
    const row = document.createElement("tr");
    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = point.label;
    const cell = document.createElement("td");
    cell.textContent = formatValue(point.value);
    row.append(head, cell);
    table.append(row);
  }
  container.append(table);

  let active = -1;
  const show = (index) => {
    if (index === active) return;
    active = index;
    columns.forEach((column, position) => column.classList.toggle("is-active", position === index));
    root.classList.toggle("has-active", index >= 0);
    if (index < 0) {
      tooltip.hidden = true;
      return;
    }
    const point = points[index];
    tooltipValue.textContent = formatValue(point.value);
    tooltipLabel.textContent = point.label;
    tooltip.hidden = false;
    const center = margin.left + band * index + band / 2;
    const half = tooltip.offsetWidth / 2;
    const left = Math.max(half + 4, Math.min(width - half - 4, center));
    const tipTop = Math.max(0, yOf(point.value) - tooltip.offsetHeight - 10);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${tipTop}px`;
  };

  hits.forEach((hit, index) => {
    hit.addEventListener("pointerenter", () => show(index));
    hit.addEventListener("pointerdown", () => show(index));
  });
  root.addEventListener("pointerleave", () => show(-1));

  container.tabIndex = 0;
  container.onkeydown = (event) => {
    if (event.key === "ArrowRight") { event.preventDefault(); show(Math.min(points.length - 1, active + 1)); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); show(active < 0 ? points.length - 1 : Math.max(0, active - 1)); }
    else if (event.key === "Home") { event.preventDefault(); show(0); }
    else if (event.key === "End") { event.preventDefault(); show(points.length - 1); }
    else if (event.key === "Escape") show(-1);
  };
  container.onblur = () => show(-1);
}
