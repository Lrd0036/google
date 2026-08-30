import { readFile, writeFile } from 'node:fs/promises';

const marker = 'royal-duke-theme';
const fontUrl = 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap';
const theme = `
  <style id="${marker}">
    /* Exact Royal Duke simulator typography and color tokens. */
    :root[data-preset="blueprint"][data-theme="dark"] {
      --bg: #070706;
      --grid: rgba(244, 244, 244, 0.09);
      --text: #f4f4f4;
      --text-muted: #c9c8bd;
      --text-dim: #8f8f86;
      --text-faint: #6f6f69;
      --panel: rgba(9, 9, 8, 0.96);
      --panel-border: rgba(244, 244, 244, 0.28);
      --lane-fill: rgba(244, 244, 244, 0.018);
      --lane-stroke: rgba(244, 244, 244, 0.28);
      --arrow: #9b9b92;
      --arrow-emphasis: #70e38e;
      --mask: #090908;
      --frontend-fill: rgba(70, 112, 153, 0.16);
      --frontend-stroke: #9ecdf7;
      --backend-fill: rgba(24, 80, 52, 0.16);
      --backend-stroke: #70e38e;
      --database-fill: rgba(244, 244, 244, 0.035);
      --database-stroke: #c9c8bd;
      --cloud-fill: rgba(121, 79, 25, 0.2);
      --cloud-stroke: #e8ad59;
      --security-fill: rgba(106, 21, 33, 0.2);
      --security-stroke: #ff4d5c;
      --messagebus-fill: rgba(121, 79, 25, 0.2);
      --messagebus-stroke: #e8ad59;
      --external-fill: rgba(244, 244, 244, 0.035);
      --external-stroke: #8f8f86;
      --toolbar-bg: rgba(9, 9, 8, 0.96);
      --toolbar-border: rgba(244, 244, 244, 0.28);
      --toolbar-text: #f4f4f4;
      --toolbar-hover: #0b0a09;
      --toolbar-menu-bg: #090908;
    }

    :root[data-preset="blueprint"][data-theme="light"] {
      --bg: #f4f4f0;
      --grid: rgba(7, 7, 6, 0.12);
      --text: #070706;
      --text-muted: #363632;
      --text-dim: #686861;
      --text-faint: #777770;
      --panel: rgba(255, 255, 252, 0.96);
      --panel-border: rgba(7, 7, 6, 0.3);
      --lane-fill: rgba(7, 7, 6, 0.018);
      --lane-stroke: rgba(7, 7, 6, 0.28);
      --arrow: #6f6f69;
      --arrow-emphasis: #287e48;
      --mask: #fffef9;
      --frontend-fill: rgba(70, 112, 153, 0.09);
      --frontend-stroke: #315d85;
      --backend-fill: rgba(24, 80, 52, 0.09);
      --backend-stroke: #287e48;
      --database-fill: rgba(7, 7, 6, 0.025);
      --database-stroke: #5c5c56;
      --cloud-fill: rgba(121, 79, 25, 0.1);
      --cloud-stroke: #8b5a1d;
      --security-fill: rgba(197, 18, 42, 0.08);
      --security-stroke: #c5122a;
      --messagebus-fill: rgba(121, 79, 25, 0.1);
      --messagebus-stroke: #8b5a1d;
      --external-fill: rgba(7, 7, 6, 0.025);
      --external-stroke: #686861;
      --toolbar-bg: rgba(255, 255, 252, 0.96);
      --toolbar-border: rgba(7, 7, 6, 0.3);
      --toolbar-text: #070706;
      --toolbar-hover: #ffffff;
      --toolbar-menu-bg: #fffef9;
    }

    body,
    button,
    input,
    select,
    textarea,
    svg,
    svg text {
      font-family: 'Share Tech Mono', ui-monospace, 'Lucida Console', 'Courier New', monospace !important;
      font-variant-ligatures: none;
      font-synthesis: weight;
    }

    :root[data-preset="blueprint"] body {
      background-size: 40px 40px;
      letter-spacing: 0.01em;
    }
  </style>
`;

for (const path of process.argv.slice(2)) {
  let html = await readFile(path, 'utf8');
  html = html.replace(new RegExp(`\\n\\s*<style id="${marker}">[\\s\\S]*?<\\/style>\\n`, 'g'), '\n');
  html = html.replace(/https:\/\/fonts\.googleapis\.com\/css2\?family=JetBrains\+Mono[^"']*/g, fontUrl);
  html = html.replaceAll("'JetBrains Mono'", "'Share Tech Mono'");
  html = html.replace('</head>', `${theme}</head>`);
  await writeFile(path, html);
}
