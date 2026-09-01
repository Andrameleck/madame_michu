// Fabrique de noeuds DOM. Tout ce qui est affiche passe par `textContent` :
// les reponses du modele et les contenus de mails ne sont jamais du HTML de
// confiance, et cette regle doit tenir sans effort de vigilance a chaque appel.

/**
 * @param {string} tag
 * @param {object} [attributes] classe, dataset, ecouteurs `onX`, attributs
 * @param {...(Node|string|null|undefined|false)} children
 */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && typeof value !== "object") {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function replace(node, ...children) {
  clear(node);
  for (const child of children.flat().filter(Boolean)) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Champ de formulaire etiquete, forme unique pour toute l'interface. */
export function field(label, control, hint) {
  return el("label", { class: "field" },
    el("span", { class: "field-label", text: label }),
    control,
    hint ? el("span", { class: "field-hint", text: hint }) : null
  );
}

export function select(options, value, onChange) {
  const node = el("select", { onchange: (event) => onChange?.(event.target.value) });
  for (const option of options) {
    node.append(el("option", {
      value: option.value,
      text: option.label,
      selected: option.value === value,
    }));
  }
  node.value = value ?? "";
  return node;
}

/** Bandeau de statut : un seul message a la fois, jamais de HTML injecte. */
export function createStatusBar(node) {
  let timer = null;
  return {
    show(message, tone = "info", { sticky = false } = {}) {
      clearTimeout(timer);
      node.textContent = message;
      node.className = `status status-${tone}`;
      node.hidden = false;
      if (!sticky) timer = setTimeout(() => { node.hidden = true; }, 6000);
    },
    hide() {
      clearTimeout(timer);
      node.hidden = true;
    },
  };
}

/** Date lisible, locale de l'utilisateur, sans dependance de formatage. */
export function formatDateTime(value, language = "fr") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(language === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(value, language = "fr") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(language === "en" ? "en-GB" : "fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
