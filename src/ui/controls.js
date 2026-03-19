import { enableCompareMode, disableCompareMode, resetHighlight, setVisible as setRiversVisible } from '../layers/rivers.js';
import { setVisible as setCurrentsVisible, setAnimating, setSpeedColoring } from '../layers/currents.js';
import { setVisible as setPollutionVisible, setDropMode, clearParticles } from '../layers/pollution.js';

let currentMode = 'rivers';

export function initControls() {
  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      switchMode(mode);
    });
  });

  // Compare button
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

  // Currents toggles
  document.getElementById('animate-toggle')?.addEventListener('change', e => {
    setAnimating(e.target.checked);
  });

  document.getElementById('speed-color-toggle')?.addEventListener('change', e => {
    setSpeedColoring(e.target.checked);
  });

  // Pollution drop toggle
  const dropToggle = document.getElementById('drop-toggle');
  dropToggle?.addEventListener('change', e => {
    setDropMode(e.target.checked);
    const clearBtn = document.getElementById('clear-pollution');
    if (e.target.checked) clearBtn?.classList.remove('hidden');
  });

  // Clear pollution
  document.getElementById('clear-pollution')?.addEventListener('click', () => {
    clearParticles();
    if (dropToggle) dropToggle.checked = false;
    setDropMode(false);
    document.getElementById('clear-pollution')?.classList.add('hidden');
  });
}

function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  // Update tabs
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  // Update panels
  document.querySelectorAll('.mode-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${mode}`);
    p.classList.toggle('hidden', p.id !== `panel-${mode}`);
  });

  // Toggle layers
  setRiversVisible(mode === 'rivers');
  setCurrentsVisible(mode === 'currents');
  setPollutionVisible(mode === 'pollution');

  // Reset river highlight when leaving rivers mode
  if (mode !== 'rivers') {
    resetHighlight();
    disableCompareMode();
    const compareBtn = document.getElementById('compare-btn');
    const compareClear = document.getElementById('compare-clear');
    const compareStatus = document.getElementById('compare-status');
    compareBtn?.classList.remove('hidden');
    compareClear?.classList.add('hidden');
    compareStatus?.classList.add('hidden');
  }

  // Reset drop mode when leaving pollution
  if (mode !== 'pollution') {
    setDropMode(false);
    const dropToggle = document.getElementById('drop-toggle');
    if (dropToggle) dropToggle.checked = false;
  }
}
