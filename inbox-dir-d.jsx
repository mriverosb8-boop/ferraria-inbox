/* Dirección D · Combinada — lo mejor de las tres:
   · IZQUIERDA: lista editorial de A (Cola operativa, StatusToken, filtros, hotel)
   · CENTRO: hilo conversacional de C (avatares, IA vs humano, chips + compositor píldora)
   · DERECHA: panel cockpit de B (acciones con atajos, resumen IA, datos en mono) */

(function () {
  const { Spark, Avatar, Icons } = window;
  const T = (s) => `var(--${s})`;

  if (!document.getElementById('inbox-d-css')) {
    const s = document.createElement('style');
    s.id = 'inbox-d-css';
    s.textContent = `
      .d-row{ cursor:pointer; transition:background .12s; }
      .d-row:hover{ background:var(--panel-2); }
      .d-row.sel{ background:var(--sel); }
      .d-pill{ cursor:pointer; transition:background .12s,color .12s; }
      .d-act{ cursor:pointer; transition:background .12s,border-color .12s; }
      .d-act:hover{ background:var(--panel); border-color:var(--ink-3); }
      .d-soft{ cursor:pointer; transition:background .12s; }
      .d-soft:hover{ background:var(--panel-2); }
      .d-chip{ cursor:pointer; transition:transform .1s,background .12s; }
      .d-chip:hover{ transform:translateY(-1px); }
      .d-prim:hover{ background:var(--red-deep); }
    `;
    document.head.appendChild(s);
  }

  // ── IZQUIERDA (de A) ──────────────────────────────────────────────
  function StatusToken({ state }) {
    if (state === 'attention')
      return React.createElement('span', { style: {
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px 3px 7px',
        background: T('red'), color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700,
        letterSpacing: '.01em', fontFamily: "'Space Grotesk',sans-serif" } },
        React.createElement(Icons.dot, { size: 6, color: 'rgba(255,255,255,.85)' }), 'Atención');
    const map = { ia: ['live', 'IA activa'], pending: ['gold', 'Pendiente'], done: ['ink-3', 'Resuelto'] };
    const [c, label] = map[state] || map.ia;
    return React.createElement('span', { style: {
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
      color: T('ink-3'), letterSpacing: '.01em' } },
      React.createElement(Icons.dot, { size: 7, color: T(c) }), label);
  }

  function Row({ c }) {
    const att = c.state === 'attention';
    return React.createElement('div', {
      className: 'd-row' + (c.selected ? ' sel' : ''),
      style: { position: 'relative', display: 'flex', gap: 13, padding: '15px 20px 15px 22px', borderBottom: `1px solid ${T('line-2')}`, boxShadow: c.selected ? T('shadow-sm') : 'none' },
    },
      att && React.createElement('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: T('red') } }),
      React.createElement(Avatar, { c, size: 42 }),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          React.createElement('span', { className: 'grotesk', style: { fontWeight: 600, fontSize: 14.5, color: T('ink'), letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (c.emoji ? c.emoji + ' ' : '') + c.name),
          React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 11, color: T('ink-3'), whiteSpace: 'nowrap' } }, c.time)),
        React.createElement('div', { style: { fontSize: 13, color: c.unread ? T('ink') : T('ink-2'), fontWeight: c.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '4px 0 8px' } }, c.preview),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement(StatusToken, { state: c.state }),
          c.unread && React.createElement('span', { style: { marginLeft: 'auto', width: 8, height: 8, borderRadius: 999, background: T('red') } }))));
  }

  function FilterPill({ f, active }) {
    return React.createElement('button', { className: 'd-pill', style: {
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
      border: 'none', fontFamily: "'Space Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600,
      background: active ? T('ink') : T('panel-2'), color: active ? T('panel') : T('ink-2') } },
      f.label, React.createElement('span', { className: 'mono', style: { fontSize: 11, opacity: active ? .8 : .6, fontWeight: 700 } }, f.count));
  }

  // ── CENTRO (de C) ─────────────────────────────────────────────────
  function Bubble({ m }) {
    if (m.type === 'day')
      return React.createElement('div', { style: { textAlign: 'center', margin: '8px 0 20px' } },
        React.createElement('span', { style: { fontSize: 11.5, fontWeight: 600, color: T('ink-3'), background: T('panel-2'), padding: '6px 14px', borderRadius: 999, fontFamily: "'Space Grotesk',sans-serif" } }, m.label));
    if (m.from === 'system')
      return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', margin: '2px 0 16px' } },
        React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T('ink-2'), background: T('panel-2'), padding: '8px 15px', borderRadius: 999 } },
          React.createElement(Icons.doc, { size: 14, color: T('ink-3') }), m.text));

    const guest = m.from === 'guest';
    const agent = m.from === 'agent';
    const ia = m.from === 'ia';
    return React.createElement('div', { style: { display: 'flex', flexDirection: guest ? 'row' : 'row-reverse', alignItems: 'flex-end', gap: 10, margin: '0 0 18px' } },
      guest
        ? React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 34 })
        : React.createElement('div', { style: { width: 34, height: 34, flex: '0 0 auto', borderRadius: 12, display: 'grid', placeItems: 'center', background: ia ? T('red-soft') : T('red'), border: ia ? `1.5px solid ${T('red')}` : 'none' } },
            ia ? React.createElement(Spark, { size: 17, color: T('red') }) : React.createElement(Icons.user, { size: 17, color: '#fff' })),
      React.createElement('div', { style: { maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: guest ? 'flex-start' : 'flex-end' } },
        !guest && React.createElement('span', { className: 'grotesk', style: { fontSize: 11, fontWeight: 700, color: ia ? T('red') : T('ink-2'), letterSpacing: '.02em', margin: '0 6px 5px' } }, ia ? 'FerrarIA · IA' : 'Tú · agente'),
        React.createElement('div', { style: {
          padding: '12px 17px', fontSize: 15, lineHeight: 1.5,
          borderRadius: guest ? '6px 20px 20px 20px' : '20px 20px 6px 20px',
          background: agent ? T('red') : ia ? T('red-soft') : T('panel-2'),
          color: agent ? '#fff' : T('ink'),
          border: ia ? `1.5px solid color-mix(in srgb, var(--red) 35%, transparent)` : 'none' } }, m.text),
        React.createElement('span', { style: { fontSize: 10.5, color: T('ink-3'), margin: '6px 7px 0', fontFamily: "'Space Grotesk',sans-serif" } }, m.time)));
  }

  function ActionChip({ a }) {
    const Ic = Icons[a.icon] || Icons.doc;
    if (a.primary)
      return React.createElement('button', { className: 'd-chip d-prim', style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', border: 'none', borderRadius: 999, background: T('red'), color: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: T('shadow'), whiteSpace: 'nowrap' } },
        React.createElement(Ic, { size: 16, color: '#fff', w: 2.2 }), a.label);
    return React.createElement('button', { className: 'd-chip d-soft', style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', border: `1px solid ${T('line')}`, borderRadius: 999, background: T('panel'), color: T('ink'), fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' } },
      React.createElement(Ic, { size: 16, color: T('ink-2') }), a.label);
  }

  // ── DERECHA (de B) ────────────────────────────────────────────────
  function CmdAction({ a, hint }) {
    const Ic = Icons[a.icon] || Icons.doc;
    return React.createElement('button', { className: 'd-act', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 9, padding: '12px 13px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('ink'), cursor: 'pointer', textAlign: 'left' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
        React.createElement(Ic, { size: 17, color: T('ink-2') }),
        React.createElement('span', { className: 'mono', style: { fontSize: 10, color: T('ink-3'), border: `1px solid ${T('line')}`, borderRadius: 5, padding: '1px 5px' } }, hint)),
      React.createElement('span', { className: 'grotesk', style: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 } }, a.label));
  }

  function InboxD() {
    const D = window.IBX;
    return React.createElement('div', { className: 'ibx', style: { width: '100%', height: '100%', background: T('bg'), color: T('ink'), display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // ── Header (de A) ──
      React.createElement('header', { style: { flex: '0 0 auto', height: 62, display: 'flex', alignItems: 'center', gap: 22, padding: '0 22px', background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 11 } },
          React.createElement(Spark, { size: 24, color: T('red') }),
          React.createElement('span', { className: 'grotesk', style: { fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T('ink') } }, 'Ferrar', React.createElement('span', { style: { color: T('red') } }, 'IA'))),
        React.createElement('div', { style: { display: 'flex', gap: 2, marginLeft: 6, background: T('panel-2'), borderRadius: 10, padding: 3 } },
          React.createElement('button', { className: 'grotesk', style: { padding: '7px 15px', border: 'none', borderRadius: 7, background: T('panel'), color: T('ink'), fontWeight: 600, fontSize: 13.5, cursor: 'pointer', boxShadow: T('shadow-sm') } }, 'Conversaciones'),
          React.createElement('button', { className: 'grotesk', style: { padding: '7px 15px', border: 'none', borderRadius: 7, background: 'transparent', color: T('ink-2'), fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Reservas ', React.createElement('span', { className: 'mono', style: { opacity: .6 } }, '0'))),
        React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 999, background: T('live-soft'), color: T('live'), fontSize: 12.5, fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif" } },
            React.createElement(Icons.dot, { size: 7, color: T('live') }), 'Conectado'),
          React.createElement('button', { className: 'd-soft', style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', border: 'none', background: 'transparent', color: T('ink-2'), fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 8 } },
            React.createElement(Icons.help, { size: 16 }), 'Ayuda'),
          React.createElement(Avatar, { c: { id: 'me', initials: 'YO' }, size: 32 }))),

      // ── Body ──
      React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '344px 1fr 312px' } },

        // ── IZQUIERDA · lista de A ──
        React.createElement('aside', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: T('panel'), borderRight: `1px solid ${T('line')}` } },
          React.createElement('div', { style: { padding: '18px 20px 14px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 } },
              React.createElement('h2', { className: 'grotesk', style: { margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: T('ink-2') } }, 'Cola operativa'),
              React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: T('ink-3') } }, '196')),
            React.createElement('div', { style: { position: 'relative', marginBottom: 13 } },
              React.createElement('span', { style: { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' } }, React.createElement(Icons.search, { size: 16, color: T('ink-3') })),
              React.createElement('input', { placeholder: 'Buscar huésped o mensaje…', style: { width: '100%', padding: '11px 14px 11px 38px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-3'), color: T('ink'), fontSize: 13.5, fontFamily: 'inherit', outline: 'none' } })),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 13 } },
              D.filters.map((f, i) => React.createElement(FilterPill, { key: f.id, f, active: i === 0 }))),
            React.createElement('button', { className: 'd-act', style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 13px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('ink'), fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' } },
              React.createElement('span', { style: { fontSize: 15 } }, '🏨'), 'ibis Barranquilla',
              React.createElement(Icons.chevron, { size: 16, color: T('ink-3'), style: { marginLeft: 'auto' } }))),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', borderTop: `1px solid ${T('line')}` } },
            D.conversations.map((c) => React.createElement(Row, { key: c.id, c })))),

        // ── CENTRO · hilo de C ──
        React.createElement('main', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: T('bg') } },
          React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 26px', background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 44, ring: true }),
            React.createElement('div', null,
              React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' } }, '😎 JPC'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 12.5, color: T('red'), fontWeight: 600 } },
                React.createElement(Icons.dot, { size: 7, color: T('red') }), 'Requiere atención humana')),
            React.createElement('button', { className: 'd-soft', style: { marginLeft: 'auto', display: 'grid', placeItems: 'center', width: 40, height: 40, border: `1px solid ${T('line')}`, borderRadius: 999, background: T('panel'), color: T('ink-3'), cursor: 'pointer' } }, React.createElement(Icons.block, { size: 17 }))),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 40px 8px' } },
            D.thread.map((m, i) => React.createElement(Bubble, { key: i, m }))),
          React.createElement('div', { style: { flex: '0 0 auto', padding: '0 26px 20px' } },
            React.createElement('div', { className: 'ibx-scroll', style: { display: 'flex', gap: 9, padding: '14px 2px', overflowX: 'auto' } },
              D.quickActions.map((a) => React.createElement(ActionChip, { key: a.id, a }))),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px 9px 18px', borderRadius: 999, background: T('panel'), border: `1px solid ${T('line')}`, boxShadow: T('shadow') } },
              React.createElement('button', { style: { display: 'grid', placeItems: 'center', width: 38, height: 38, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer', borderRadius: 999 } }, React.createElement(Icons.image, { size: 20 })),
              React.createElement('input', { placeholder: 'Escribe como agente humano…', style: { flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: T('ink'), fontSize: 15, fontFamily: 'inherit', outline: 'none' } }),
              React.createElement('button', { className: 'd-prim', style: { display: 'grid', placeItems: 'center', width: 44, height: 44, border: 'none', borderRadius: 999, background: T('red'), color: '#fff', cursor: 'pointer' } }, React.createElement(Icons.send, { size: 19, color: '#fff' }))))),

        // ── DERECHA · panel cockpit de B ──
        React.createElement('aside', { className: 'ibx-scroll', style: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflowY: 'auto', background: T('panel'), borderLeft: `1px solid ${T('line')}`, padding: '18px 16px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 50 }),
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 16 } }, '😎 JPC'),
              React.createElement('div', { className: 'mono', style: { fontSize: 11, color: T('ink-3'), marginTop: 3 } }, '+57 301 372 0223'))),

          React.createElement('div', { style: { padding: '16px 0', borderBottom: `1px solid ${T('line')}` } },
            React.createElement('div', { className: 'mono', style: { fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 11 } }, 'Acciones'),
            React.createElement('button', { className: 'd-prim', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', padding: '12px', borderRadius: 11, border: 'none', background: T('red'), color: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 9 } },
              React.createElement(Icons.check, { size: 17, color: '#fff', w: 2.2 }), 'Asunto resuelto'),
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
              [['takeover', '⌘H'], ['reactivate', '⌘R'], ['complete', '⌘D'], ['summary', '⌘S']].map(([id, hint]) =>
                React.createElement(CmdAction, { key: id, a: D.quickActions.find((x) => x.id === id), hint })))),

          React.createElement('div', { style: { padding: '16px 0', borderBottom: `1px solid ${T('line')}` } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 11 } },
              React.createElement('span', { className: 'mono', style: { fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T('ink-3') } }, 'Resumen del chat'),
              React.createElement('button', { className: 'd-act', style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('red'), borderRadius: 7, cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 11.5, fontWeight: 700 } },
                React.createElement(Spark, { size: 12, color: T('red') }), 'Generar')),
            React.createElement('div', { className: 'mono', style: { fontSize: 12, color: T('ink-3'), padding: '10px 0' } }, 'Sin resumen aún.')),

          React.createElement('div', { style: { padding: '16px 0 0' } },
            React.createElement('div', { className: 'mono', style: { fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 8 } }, 'Datos'),
            [['Teléfono', '+57 301 372 0223'], ['Canal', 'WhatsApp'], ['Hotel', 'ibis Barranquilla'], ['Estado IA', 'En pausa']].map(([k, v]) =>
              React.createElement('div', { key: k, className: 'mono', style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', fontSize: 12, borderBottom: `1px solid ${T('line-2')}` } },
                React.createElement('span', { style: { color: T('ink-3') } }, k),
                React.createElement('span', { style: { color: T('ink'), fontWeight: 500, textAlign: 'right' } }, v)))))));
  }

  window.InboxD = InboxD;
})();
