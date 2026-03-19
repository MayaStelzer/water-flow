let tooltip;

export function initTooltip() {
  tooltip = document.getElementById('tooltip');
}

export function showTooltip(x, y, html) {
  if (!tooltip) return;
  tooltip.innerHTML = html;
  tooltip.classList.remove('hidden');

  // Keep within viewport
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  const left = x + 14 + tw > window.innerWidth ? x - tw - 14 : x + 14;
  const top  = y + 14 + th > window.innerHeight ? y - th - 14 : y + 14;

  tooltip.style.left = `${left}px`;
  tooltip.style.top  = `${top}px`;
}

export function hideTooltip() {
  if (tooltip) tooltip.classList.add('hidden');
}
