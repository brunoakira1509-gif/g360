export const DEFAULT_ACCESSIBILITY_PREFERENCES = {
  textSize: 'normal',
  highContrast: false,
  reducedMotion: false,
};

const STORAGE_KEY = 'g360-accessibility-preferences';

export function readAccessibilityPreferences() {
  if (typeof localStorage === 'undefined') return DEFAULT_ACCESSIBILITY_PREFERENCES;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_ACCESSIBILITY_PREFERENCES;
  const parsed = JSON.parse(saved);
  return {
    textSize: parsed.textSize === 'large' ? 'large' : 'normal',
    highContrast: parsed.highContrast === true,
    reducedMotion: parsed.reducedMotion === true,
  };
}

export function saveAccessibilityPreferences(preferences) {
  const next = {
    textSize: preferences.textSize === 'large' ? 'large' : 'normal',
    highContrast: preferences.highContrast === true,
    reducedMotion: preferences.reducedMotion === true,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function applyAccessibilityPreferences(preferences) {
  const root = document.documentElement;
  root.dataset.textSize = preferences.textSize;
  root.dataset.highContrast = String(preferences.highContrast);
  root.dataset.reducedMotion = String(preferences.reducedMotion);
}
