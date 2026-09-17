import { currentLanguage, formatDay, translate } from "@/lib/i18n-core";

export type PrintBlock =
  | { kind: "table"; heading: string; columns: string[]; rows: string[][] }
  | { kind: "list"; heading: string; items: string[] }
  | { kind: "text"; heading: string; body: string };

const STYLE = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Vazirmatn, "Segoe UI", system-ui, sans-serif;
    color: #221c33;
    font-size: 11.5pt;
    line-height: 1.9;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 2px solid #6f5bd6;
    padding-bottom: 10px;
    margin-bottom: 18px;
  }
  .mark {
    width: 34px;
    height: 34px;
    border-radius: 11px;
    object-fit: cover;
  }
  .brand { font-size: 13pt; font-weight: 700; }
  .title { font-size: 16pt; font-weight: 700; margin: 0 0 4px; }
  .subtitle { font-size: 10.5pt; color: #6b6480; margin: 0; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 12px 0 20px; font-size: 10pt; color: #6b6480; }
  h2 { font-size: 12.5pt; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th, td { border: 1px solid #ded8ef; padding: 7px 9px; text-align: start; vertical-align: top; }
  th { background: #f4f1fb; font-weight: 700; }
  ul { margin: 0; padding-inline-start: 18px; }
  li { margin-bottom: 4px; }
  p.body { margin: 0; white-space: pre-wrap; }
  footer {
    margin-top: 26px;
    border-top: 1px solid #ded8ef;
    padding-top: 8px;
    font-size: 9.5pt;
    color: #8b85a0;
    display: flex;
    justify-content: space-between;
  }
`;

function escape(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderBlock(block: PrintBlock) {
  if (block.kind === "table") {
    return `<h2>${escape(block.heading)}</h2>
      <table>
        <thead><tr>${block.columns.map((column) => `<th>${escape(column)}</th>`).join("")}</tr></thead>
        <tbody>${block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody>
      </table>`;
  }
  if (block.kind === "list") {
    return `<h2>${escape(block.heading)}</h2>
      <ul>${block.items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
  }
  return `<h2>${escape(block.heading)}</h2><p class="body">${escape(block.body)}</p>`;
}

export function printDocument({
  title,
  subtitle,
  meta = [],
  blocks,
}: {
  title: string;
  subtitle?: string;
  meta?: string[];
  blocks: PrintBlock[];
}) {
  const language = currentLanguage();
  const dir = language === "fa" ? "rtl" : "ltr";
  const brand = language === "fa" ? "بومرنگ" : "Boomrang";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const stamp = formatDay(new Date(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.inset = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }

  doc.open();
  doc.write(`<!doctype html><html lang="${language}" dir="${dir}"><head><meta charset="utf-8" />
    <title>${escape(title)}</title><style>${STYLE}</style></head>
    <body>
      <header>
        <img class="mark" src="${origin}/logo.png" alt="" />
        <span class="brand">${brand}</span>
      </header>
      <h1 class="title">${escape(title)}</h1>
      ${subtitle ? `<p class="subtitle">${escape(subtitle)}</p>` : ""}
      ${meta.length ? `<div class="meta">${meta.map((item) => `<span>${escape(item)}</span>`).join("")}</div>` : ""}
      ${blocks.map(renderBlock).join("")}
      <footer><span>${escape(brand)}</span><span>${escape(translate("تاریخ تهیه"))}: ${escape(stamp)}</span></footer>
    </body></html>`);
  doc.close();

  const view = frame.contentWindow;
  if (!view) {
    frame.remove();
    return;
  }
  const cleanup = () => window.setTimeout(() => frame.remove(), 500);
  view.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    view.focus();
    view.print();
    window.setTimeout(cleanup, 60000);
  }, 250);
}
