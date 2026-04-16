import { enableCompareMode, disableCompareMode, resetHighlight, setVisible as setRiversVisible } from '../layers/rivers.js';
import { setVisible as setCurrentsVisible, setAnimating, setSpeedColoring } from '../layers/currents.js';
import { setDropMode, clearParticles } from '../layers/pollution.js';
import { setAutoSourcesVisible } from '../layers/autoParticles.js';
import { setGyresVisible } from '../layers/gyres.js';

function applyMapLayers() {
  const riversOn = document.getElementById('layer-rivers-toggle')?.checked ?? true;
  const currentsOn = document.getElementById('layer-currents-toggle')?.checked ?? false;
  setRiversVisible(riversOn);
  setCurrentsVisible(currentsOn);
}

export function initControls() {
  document.getElementById('layer-rivers-toggle')?.addEventListener('change', e => {
    if (!e.target.checked) {
      resetHighlight();
      disableCompareMode();
      const compareBtn = document.getElementById('compare-btn');
      const compareClear = document.getElementById('compare-clear');
      const compareStatus = document.getElementById('compare-status');
      compareBtn?.classList.remove('hidden');
      compareClear?.classList.add('hidden');
      compareStatus?.classList.add('hidden');
      document.getElementById('river-stats')?.classList.add('hidden');
    }
    applyMapLayers();
  });

  document.getElementById('layer-currents-toggle')?.addEventListener('change', () => {
    applyMapLayers();
  });

  document.getElementById('layer-gyres-toggle')?.addEventListener('change', e => {
    setGyresVisible(e.target.checked);
  });

  const compareBtn = document.getElementById('compare-btn');
  const compareClear = document.getElementById('compare-clear');
  const compareStatus = document.getElementById('compare-status');

  compareBtn?.addEventListener('click', () => {
    compareBtn.classList.add('hidden');
    compareClear.classList.remove('hidden');
    compareStatus.classList.remove('hidden');
    enableCompareMode();
  });

  compareClear?.addEventListener('click', () => {
    compareBtn.classList.remove('hidden');
    compareClear.classList.add('hidden');
    compareStatus.classList.add('hidden');
    disableCompareMode();
    document.getElementById('river-stats')?.classList.add('hidden');
  });

  document.getElementById('animate-toggle')?.addEventListener('change', e => {
    setAnimating(e.target.checked);
  });

  document.getElementById('speed-color-toggle')?.addEventListener('change', e => {
    setSpeedColoring(e.target.checked);
  });

  const dropToggle = document.getElementById('drop-toggle');
  dropToggle?.addEventListener('change', e => {
    setDropMode(e.target.checked);
    const clearBtn = document.getElementById('clear-pollution');
    if (e.target.checked) clearBtn?.classList.remove('hidden');
  });

  const autoSourcesToggle = document.getElementById('auto-sources-toggle');
  const autoSourcesInfo = document.getElementById('auto-sources-info');

  autoSourcesToggle?.addEventListener('change', e => {
    setAutoSourcesVisible(e.target.checked);
    autoSourcesInfo?.classList.toggle('hidden', !e.target.checked);
  });

  document.getElementById('clear-pollution')?.addEventListener('click', () => {
    clearParticles();
    if (dropToggle) dropToggle.checked = false;
    setDropMode(false);
    document.getElementById('clear-pollution')?.classList.add('hidden');
  });

  applyMapLayers();
}
