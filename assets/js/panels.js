// panels.js
export function wirePanelTogglesOnce() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.togglesWired === '1') return;
  sidebar.dataset.togglesWired = '1';

  sidebar.addEventListener('click', (e) => {
    const head = e.target.closest('.panel-head');
    if (!head || !sidebar.contains(head)) return;
    if (e.target.closest('input[type="checkbox"]')) return;
    const panel = head.closest('.panel');
    const body = document.getElementById(head.dataset.target);
    panel.classList.toggle('open');
    head.setAttribute('aria-expanded', String(panel.classList.contains('open')));
    if (body) body.style.display = panel.classList.contains('open') ? 'block' : 'none';
  });

  sidebar.addEventListener('keydown', (e) => {
    const head = e.target.closest('.panel-head');
    if (!head || !sidebar.contains(head)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const panel = head.closest('.panel');
      const body = document.getElementById(head.dataset.target);
      panel.classList.toggle('open');
      head.setAttribute('aria-expanded', String(panel.classList.contains('open')));
      if (body) body.style.display = panel.classList.contains('open') ? 'block' : 'none';
    }
  });
}
