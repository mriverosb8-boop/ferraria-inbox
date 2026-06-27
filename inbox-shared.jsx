/* FerrarIA Inbox — capa compartida: tokens de tema, destello, avatares,
   iconos de línea y el toggle claro/oscuro. */

(function () {
  const SPARK = window.IBX.SPARK;

  // ── Tokens de tema (claro / oscuro) ───────────────────────────────
  if (!document.getElementById('ibx-tokens')) {
    const s = document.createElement('style');
    s.id = 'ibx-tokens';
    s.textContent = `
      :root[data-theme="light"]{
        --ink:#211c18; --ink-2:#6b6259; --ink-3:#9c9085;
        --bg:#ece7e0; --panel:#fffdfb; --panel-2:#f5f0ea; --panel-3:#ece6df;
        --line:#e8dfd5; --line-2:#f1ebe3;
        --red:#e5372a; --red-deep:#c42b20; --red-soft:#fbe9e6; --red-ink:#fff;
        --live:#1f9d63; --live-soft:#e6f3ec;
        --gold:#b07d2b;
        --shadow-sm:0 1px 2px rgba(40,30,20,.06);
        --shadow:0 2px 8px rgba(40,30,20,.07),0 1px 2px rgba(40,30,20,.05);
        --shadow-lg:0 12px 36px rgba(40,30,20,.14),0 2px 8px rgba(40,30,20,.06);
        --sel:#fffdfb;
      }
      :root[data-theme="dark"]{
        --ink:#f4efe9; --ink-2:#b4a99d; --ink-3:#7c7064;
        --bg:#15110e; --panel:#211b17; --panel-2:#2a231e; --panel-3:#1a1511;
        --line:#352c25; --line-2:#2a221c;
        --red:#fb5142; --red-deep:#e5372a; --red-soft:#3a201b; --red-ink:#fff;
        --live:#39cf83; --live-soft:#16301f;
        --gold:#d3a04f;
        --shadow-sm:0 1px 2px rgba(0,0,0,.3);
        --shadow:0 3px 12px rgba(0,0,0,.4);
        --shadow-lg:0 16px 44px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.4);
        --sel:#2c2520;
      }
      .ibx{ font-family:'Archivo',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
        text-rendering:optimizeLegibility; box-sizing:border-box; }
      .ibx *,.ibx *::before,.ibx *::after{ box-sizing:border-box; }
      .ibx ::selection{ background:var(--red); color:#fff; }
      /* scrollbars finos y modernos (cuando se usa fuera del canvas) */
      .ibx-scroll{ scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--ink) 22%,transparent) transparent; }
      .ibx-scroll::-webkit-scrollbar{ width:8px; height:8px; }
      .ibx-scroll::-webkit-scrollbar-thumb{ background:color-mix(in srgb,var(--ink) 20%,transparent);
        border-radius:99px; border:2px solid transparent; background-clip:padding-box; }
      .ibx-scroll::-webkit-scrollbar-thumb:hover{ background:color-mix(in srgb,var(--ink) 34%,transparent);
        background-clip:padding-box; }
      .ibx-scroll::-webkit-scrollbar-track{ background:transparent; }
      .mono{ font-family:'Space Mono',ui-monospace,monospace; }
      .grotesk{ font-family:'Space Grotesk',sans-serif; }
    `;
    document.head.appendChild(s);
  }

  // ── Destello ──────────────────────────────────────────────────────
  const Spark = ({ size = 18, color = 'var(--red)', style }) =>
    React.createElement('svg', { width: size, height: size, viewBox: '0 0 100 100', style, 'aria-hidden': true },
      React.createElement('path', { d: SPARK, fill: color }));

  // ── Avatar ────────────────────────────────────────────────────────
  // Tonos cálidos derivados del id para variedad sin salirse de la paleta.
  const AV_TONES = [
    ['#f0d9b5', '#8a6a36'], ['#e8c9c4', '#9c4f44'], ['#d8d3c4', '#6f6855'],
    ['#e6d2bd', '#8a6240'], ['#cdd6cb', '#4f6b56'], ['#e2cdd6', '#86566a'],
  ];
  function tone(id) {
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return AV_TONES[h % AV_TONES.length];
  }
  const Avatar = ({ c, size = 44, ring }) => {
    const [bg, fg] = tone(c.id || c.name || 'x');
    return React.createElement('div', {
      style: {
        width: size, height: size, borderRadius: size * 0.34, flex: '0 0 auto',
        background: bg, color: fg, display: 'grid', placeItems: 'center',
        fontWeight: 700, fontSize: size * (c.emoji ? 0.5 : 0.36), lineHeight: 1,
        fontFamily: c.emoji ? 'inherit' : "'Space Grotesk',sans-serif",
        boxShadow: ring ? `0 0 0 2px var(--panel), 0 0 0 ${2 + ring}px ${ring === true ? 'var(--red)' : ring}` : 'none',
        userSelect: 'none', overflow: 'hidden',
      },
    }, c.emoji ? c.emoji : c.initials);
  };

  // ── Iconos de línea ───────────────────────────────────────────────
  const I = (paths, props = {}) => ({ size = 16, w = 1.7, color = 'currentColor', style } = {}) =>
    React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
      strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round', style, 'aria-hidden': true, ...props,
    }, paths.map((d, i) => React.createElement('path', { key: i, d })));

  const Icons = {
    check: I(['M20 6L9 17l-5-5']),
    user: I(['M20 21a8 8 0 0 0-16 0', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z']),
    flag: I(['M4 21V4', 'M4 4h13l-2 4 2 4H4']),
    doc: I(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4']),
    search: I(['M21 21l-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z']),
    chevron: I(['M6 9l6 6 6-6']),
    chevronR: I(['M9 6l6 6-6 6']),
    phone: I(['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z']),
    whatsapp: I(['M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z', 'M8.5 8.5c0 4 3 7 6.5 7 .6 0 1-.5 1-1l-.2-1.3-2-.6-.9 1a6 6 0 0 1-2.8-2.8l1-.9-.6-2L9.5 7.5c-.5 0-1 .4-1 1z']),
    block: I(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8']),
    sun: I(['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4']),
    moon: I(['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z']),
    send: I(['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z']),
    image: I(['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M21 16l-5-5L5 21']),
    spark: ({ size = 16, color = 'currentColor', style } = {}) =>
      React.createElement('svg', { width: size, height: size, viewBox: '0 0 100 100', style, 'aria-hidden': true },
        React.createElement('path', { d: SPARK, fill: color })),
    help: I(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3', 'M12 17h.01']),
    logout: I(['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']),
    dot: ({ size = 8, color = 'currentColor', style } = {}) =>
      React.createElement('svg', { width: size, height: size, viewBox: '0 0 8 8', style },
        React.createElement('circle', { cx: 4, cy: 4, r: 4, fill: color })),
    refresh: I(['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 21v-5h5']),
  };

  // ── Toggle de tema (overlay fijo) ─────────────────────────────────
  function ThemeToggle({ value, onChange }) {
    const [local, setLocal] = React.useState(
      () => document.documentElement.getAttribute('data-theme') || 'light');
    const theme = value != null ? value : local;
    const set = (t) => {
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('ibx-theme', t); } catch (e) {}
      if (onChange) onChange(t); else setLocal(t);
    };
    const Seg = ({ id, label, icon: Ic }) => {
      const on = theme === id;
      return React.createElement('button', {
        onClick: () => set(id),
        style: {
          display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px 7px 11px',
          border: 'none', cursor: 'pointer', borderRadius: 999, fontFamily: "'Space Grotesk',sans-serif",
          fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
          background: on ? '#fff' : 'transparent', color: on ? '#1d1916' : 'rgba(255,255,255,.7)',
          boxShadow: on ? '0 1px 3px rgba(0,0,0,.2)' : 'none', transition: 'all .15s',
        },
      }, React.createElement(Ic, { size: 15, w: 1.9 }), label);
    };
    return React.createElement('div', {
      style: {
        position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
        display: 'flex', alignItems: 'center', gap: 4, padding: 4,
        background: 'rgba(29,25,22,.9)', backdropFilter: 'blur(12px)', borderRadius: 999,
        boxShadow: '0 8px 28px rgba(0,0,0,.3)', fontFamily: "'Space Grotesk',sans-serif",
      },
    },
      React.createElement('span', { style: { color: 'rgba(255,255,255,.45)', fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', padding: '0 8px 0 10px' } }, 'Tema'),
      React.createElement(Seg, { id: 'light', label: 'Claro', icon: Icons.sun }),
      React.createElement(Seg, { id: 'dark', label: 'Oscuro', icon: Icons.moon }),
    );
  }

  Object.assign(window, { Spark, Avatar, Icons, ThemeToggle });
})();
