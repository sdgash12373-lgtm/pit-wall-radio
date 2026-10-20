export function element(tag, className = '', text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(label, action, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => action());
  return node;
}
export function confirmPanel(parent, message, label, action) {
  const panel = element('section', 'confirm-panel');
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-label', message);
  panel.append(element('p', '', message), button(label, () => { panel.remove(); action(); }, 'danger'), button('取消', () => panel.remove()));
  parent.append(panel);
  panel.querySelector('button:last-child').focus();
}
