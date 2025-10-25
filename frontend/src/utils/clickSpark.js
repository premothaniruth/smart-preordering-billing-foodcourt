// Lightweight ClickSpark utility without external deps
// Usage: import { clickSpark } from '../utils/clickSpark'; then call clickSpark(event)
let cssInjected = false;

function injectCssOnce() {
  if (cssInjected) return;
  cssInjected = true;
  const css = `
  @keyframes cs-pop { from { transform: scale(0.5); opacity: 1; } to { transform: scale(1); opacity: 0; } }
  .cs-container { position: fixed; pointer-events: none; inset: 0; z-index: 9999; }
  .cs-particle { position: absolute; width: 8px; height: 8px; border-radius: 50%; animation: cs-pop 600ms ease-out forwards; }
  `;
  const style = document.createElement('style');
  style.setAttribute('data-clickspark', '');
  style.textContent = css;
  document.head.appendChild(style);
}

export function clickSpark(e) {
  try {
    if (!e || !e.clientX) return;
    injectCssOnce();
    const root = document.querySelector('.cs-container') || (() => {
      const div = document.createElement('div');
      div.className = 'cs-container';
      document.body.appendChild(div);
      return div;
    })();

    const colors = ['#111', '#27ae60', '#e67e22', '#3498db', '#e74c3c', '#9b59b6'];
    const count = 12;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'cs-particle';
      el.style.background = colors[i % colors.length];
      const dx = (Math.random() - 0.5) * 60; // spread
      const dy = (Math.random() - 0.5) * 60;
      el.style.left = `${e.clientX + dx}px`;
      el.style.top = `${e.clientY + dy}px`;
      el.style.opacity = '0.9';
      el.style.transform = 'scale(0.5)';
      root.appendChild(el);
      setTimeout(() => el.remove(), 650);
    }
  } catch {}
}
