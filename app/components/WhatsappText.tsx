import type { CSSProperties, ReactNode } from "react";

/**
 * Renderiza texto con el formato liviano de WhatsApp:
 *   *negrita*  _itálica_  ~tachado~  ```monoespaciado```
 * Devuelve nodos de React (no usa dangerouslySetInnerHTML → sin riesgo XSS).
 * Respeta los saltos de línea vía `white-space: pre-wrap` en el contenedor.
 */

type Wrapper = { open: string; type: "bold" | "italic" | "strike" };

const WRAPPERS: Wrapper[] = [
  { open: "*", type: "bold" },
  { open: "_", type: "italic" },
  { open: "~", type: "strike" },
];

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-space-mono), ui-monospace, monospace",
  fontSize: "0.92em",
};

/** ¿El carácter permite un delimitador adyacente? (borde de palabra, estilo WhatsApp). */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || /[\s.,;:!?¿¡()[\]{}"'*_~\n]/.test(ch);
}

function styleFor(type: Wrapper["type"]): CSSProperties {
  if (type === "bold") return { fontWeight: 700 };
  if (type === "italic") return { fontStyle: "italic" };
  return { textDecoration: "line-through" };
}

function render(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  let k = 0;

  const flush = () => {
    if (buffer) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (i < text.length) {
    // Monoespaciado ```...``` (no se sigue formateando adentro).
    if (text.startsWith("```", i)) {
      const end = text.indexOf("```", i + 3);
      if (end !== -1 && end > i + 3) {
        flush();
        nodes.push(
          <code key={`${keyPrefix}-${k++}`} style={monoStyle}>
            {text.slice(i + 3, end)}
          </code>
        );
        i = end + 3;
        continue;
      }
    }

    const ch = text[i];
    const wrapper = WRAPPERS.find((w) => w.open === ch);
    if (wrapper) {
      const prev = i > 0 ? text[i - 1] : undefined;
      const next = text[i + 1];
      // Apertura válida: borde antes y contenido (no espacio) después.
      if (isBoundary(prev) && next !== undefined && !/\s/.test(next)) {
        let close = -1;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] !== wrapper.open) continue;
          const before = text[j - 1];
          const after = text[j + 1];
          if (before && !/\s/.test(before) && isBoundary(after)) {
            close = j;
            break;
          }
        }
        if (close > i + 1) {
          flush();
          nodes.push(
            <span key={`${keyPrefix}-${k++}`} style={styleFor(wrapper.type)}>
              {render(text.slice(i + 1, close), `${keyPrefix}-${k}`)}
            </span>
          );
          i = close + 1;
          continue;
        }
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return nodes;
}

export function WhatsappText({ text }: { text: string }) {
  if (!text) return null;
  return <>{render(text, "wa")}</>;
}

/** Quita los símbolos de formato para previews de una línea (lista). */
export function stripWhatsappMarkup(text: string): string {
  if (!text) return text;
  return text
    .replace(/```([\s\S]+?)```/g, "$1")
    .replace(/(^|[\s.,;:!?¿¡()[\]{}"'])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s.,;:!?¿¡()[\]{}"'])/g, "$1$2")
    .replace(/(^|[\s.,;:!?¿¡()[\]{}"'])_(\S(?:[^_\n]*\S)?)_(?=$|[\s.,;:!?¿¡()[\]{}"'])/g, "$1$2")
    .replace(/(^|[\s.,;:!?¿¡()[\]{}"'])~(\S(?:[^~\n]*\S)?)~(?=$|[\s.,;:!?¿¡()[\]{}"'])/g, "$1$2");
}
