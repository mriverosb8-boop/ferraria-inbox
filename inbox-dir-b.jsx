/* Dirección B · Centro de mando — cockpit operativo estilo Linear/Superhuman.
   Tira de estado de la cola, carriles de color por prioridad, meta en mono,
   acciones con atajos. Pensada para brillar en oscuro. */

(function () {
  const { Spark, Avatar, Icons } = window;
  const T = (s) => `var(--${s})`;
  const LANE = { attention: 'red', ia: 'live', pending: 'gold', done: 'ink-3' };

  if (!document.getElementById('inbox-b-css')) {
    const s = document.createElement('style');
    s.id = 'inbox-b-css';
    s.textContent = `
      .b-row{ cursor:pointer; transition:background .1s; }
      .b-row:hover{ background:var(--panel-2); }
      .b-row.sel{ background:var(--panel-2); }
      .b-cmd:hover{ border-color:var(--ink-3); }
      .b-act:hover{ background:var(--panel); border-color:var(--ink-3); }
      .b-prim:hover{ background:var(--red-deep); }
      .b-tab{ cursor:pointer; transition:color .12s; }
      @keyframes b-pulse{ 0%,100%{ opacity:1 } 50%{ opacity:.35 } }
      .b-pulse{ animation:b-pulse 1.8s ease-in-out infinite; }
    `;
    document.head.appendChild(s);
  }

  function Stat({ s }) {
    const c = s.tone === 'neutral' ? 'ink-2' : s.tone;
    return React.createElement('div', { style: { flex: 1, padding: '11px 13px', borderRadius: 12, background: T('panel'), border: `1px solid ${T('line')}`, position: 'relative', overflow: 'hidden' } },
      React.createElement('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: T(c) } }),
      React.createElement('div', { className: 'mono', style: { fontSize: 25, fontWeight: 700, color: s.tone === 'neutral' ? T('ink') : T(c), lineHeight: 1, fontVariantNumeric: 'tabular-nums' } }, s.value),
      React.createElement('div', { style: { fontSize: 10.5, color: T('ink-3'), marginTop: 5, letterSpacing: '.02em', lineHeight: 1.2 } }, s.label));
  }

  function Row({ c }) {
    return React.createElement('div', {
      className: 'b-row' + (c.selected ? ' sel' : ''),
      style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px 11px 18px', borderBottom: `1px solid ${T('line-2')}` },
    },
      React.createElement('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: c.selected ? 3 : 3, background: T(LANE[c.state]), opacity: c.selected || c.state === 'attention' ? 1 : .4 } }),
      React.createElement(Avatar, { c, size: 36 }),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          React.createElement('span', { className: 'grotesk', style: { fontWeight: 600, fontSize: 13.5, color: T('ink'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (c.emoji ? c.emoji + ' ' : '') + c.name),
          c.state === 'attention' && React.createElement('span', { className: 'mono', style: { fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: T('red'), border: `1px solid ${T('red')}`, padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase' } }, 'Atención'),
          React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 10.5, color: T('ink-3'), whiteSpace: 'nowrap' } }, c.time)),
        React.createElement('div', { style: { fontSize: 12.5, color: c.unread ? T('ink') : T('ink-2'), fontWeight: c.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 } }, c.preview)),
      c.unread && React.createElement('span', { style: { width: 7, height: 7, borderRadius: 999, background: T('red'), flex: '0 0 auto' } }));
  }

  function Msg({ m }) {
    if (m.type === 'day')
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 18px' } },
        React.createElement('div', { style: { flex: 1, height: 1, background: T('line') } }),
        React.createElement('span', { className: 'mono', style: { fontSize: 10, color: T('ink-3'), letterSpacing: '.1em', textTransform: 'uppercase' } }, m.label),
        React.createElement('div', { style: { flex: 1, height: 1, background: T('line') } }));
    if (m.from === 'system')
      return React.createElement('div', { className: 'mono', style: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', margin: '0 0 12px', fontSize: 11.5, color: T('ink-2'), background: T('panel-3'), borderRadius: 8, border: `1px solid ${T('line-2')}` } },
        React.createElement('span', { style: { color: T('ink-3') } }, '›'), React.createElement(Icons.doc, { size: 13, color: T('ink-3') }), m.text, React.createElement('span', { style: { marginLeft: 'auto', color: T('ink-3') } }, m.time));

    const guest = m.from === 'guest';
    const agent = m.from === 'agent';
    const tag = guest ? ['Huésped', 'ink-3'] : agent ? ['Agente', 'ink-2'] : ['FerrarIA · IA', 'red'];
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: guest ? 'flex-start' : 'flex-end', margin: '0 0 14px' } },
      React.createElement('div', { className: 'mono', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T(tag[1]), letterSpacing: '.04em', margin: '0 3px 5px', textTransform: 'uppercase' } },
        !guest && !agent && React.createElement(Spark, { size: 11, color: T('red') }), tag[0], React.createElement('span', { style: { color: T('ink-3') } }, '· ' + m.time)),
      React.createElement('div', {
        style: {
          maxWidth: '76%', padding: '10px 14px', fontSize: 14, lineHeight: 1.5, borderRadius: 10,
          background: agent ? T('red') : T('panel'),
          color: agent ? '#fff' : T('ink'),
          border: agent ? 'none' : `1px solid ${guest ? T('line') : T('red-soft')}`,
          borderLeft: !guest && !agent ? `2px solid ${T('red')}` : undefined,
        },
      }, m.text));
  }

  function CmdAction({ a, hint }) {
    const Ic = Icons[a.icon] || Icons.doc;
    return React.createElement('button', {
      className: 'b-act',
      style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 9, padding: '12px 13px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('ink'), cursor: 'pointer', textAlign: 'left' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
        React.createElement(Ic, { size: 17, color: T('ink-2') }),
        React.createElement('span', { className: 'mono', style: { fontSize: 10, color: T('ink-3'), border: `1px solid ${T('line')}`, borderRadius: 5, padding: '1px 5px' } }, hint)),
      React.createElement('span', { className: 'grotesk', style: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 } }, a.label));
  }

  function InboxB() {
    const D = window.IBX;
    const Tab = ({ label, count, active }) => React.createElement('button', {
      className: 'b-tab',
      style: { position: 'relative', padding: '20px 2px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, color: active ? T('ink') : T('ink-3'), display: 'flex', alignItems: 'center', gap: 6 } },
      label, count != null && React.createElement('span', { className: 'mono', style: { fontSize: 11, opacity: .6 } }, count),
      active && React.createElement('span', { style: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: T('red'), borderRadius: 2 } }));

    return React.createElement('div', { className: 'ibx', style: { width: '100%', height: '100%', background: T('panel-3'), color: T('ink'), display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // ── Header ──
      React.createElement('header', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 20, padding: '0 20px', height: 58, background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('div', { style: { width: 32, height: 32, borderRadius: 9, background: T('red'), display: 'grid', placeItems: 'center' } }, React.createElement(Spark, { size: 19, color: '#fff' })),
          React.createElement('span', { className: 'grotesk', style: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' } }, 'Ferrar', React.createElement('span', { style: { color: T('red') } }, 'IA')),
          React.createElement('span', { className: 'mono', style: { fontSize: 11, color: T('ink-3'), marginTop: 2 } }, '/ inbox')),
        React.createElement('div', { style: { flex: 1, maxWidth: 380, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 10, background: T('panel-3'), border: `1px solid ${T('line')}`, color: T('ink-3') } },
          React.createElement(Icons.search, { size: 15 }),
          React.createElement('span', { style: { fontSize: 13 } }, 'Buscar huésped, mensaje o hotel'),
          React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 10.5, border: `1px solid ${T('line')}`, borderRadius: 5, padding: '1px 6px' } }, '⌘K')),
        React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 } },
          React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: T('live'), fontFamily: "'Space Grotesk',sans-serif" } },
            React.createElement('span', { className: 'b-pulse' }, React.createElement(Icons.dot, { size: 8, color: T('live') })), 'Conectado'),
          React.createElement('button', { style: { padding: 8, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer', display: 'grid', placeItems: 'center' } }, React.createElement(Icons.help, { size: 17 })),
          React.createElement('button', { style: { padding: 8, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer', display: 'grid', placeItems: 'center' } }, React.createElement(Icons.logout, { size: 17 })),
          React.createElement(Avatar, { c: { id: 'me', initials: 'YO' }, size: 30 }))),

      // ── Body ──
      React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '360px 1fr 312px', gap: 1, background: T('line') } },

        // ── Lista ──
        React.createElement('aside', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, background: T('panel') } },
          React.createElement('div', { style: { padding: '14px 16px 12px', borderBottom: `1px solid ${T('line')}` } },
            React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 13 } }, D.stats.map((s) => React.createElement(Stat, { key: s.id, s }))),
            React.createElement('div', { style: { display: 'flex', gap: 6 } }, D.filters.map((f, i) =>
              React.createElement('button', { key: f.id, className: 'b-tab', style: { flex: f.id === 'all' ? '0 0 auto' : '1', padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: i === 0 ? T('ink') : T('panel-3'), color: i === 0 ? T('panel') : T('ink-2'), fontFamily: "'Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 } },
                f.label, React.createElement('span', { className: 'mono', style: { fontSize: 10, opacity: .65 } }, f.count))))),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            D.conversations.map((c) => React.createElement(Row, { key: c.id, c })))),

        // ── Hilo ──
        React.createElement('main', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, background: T('panel-3') } },
          React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 38 }),
            React.createElement('div', null,
              React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 15.5 } }, '😎 JPC'),
              React.createElement('div', { className: 'mono', style: { fontSize: 11, color: T('ink-3'), marginTop: 2 } }, 'WHATSAPP · +57 301 372 0223')),
            React.createElement('span', { className: 'mono', style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6, background: T('red'), color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginLeft: 4 } }, 'Requiere atención'),
            React.createElement('button', { className: 'b-cmd', style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('ink-2'), borderRadius: 8, fontFamily: "'Space Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600, cursor: 'pointer' } },
              React.createElement(Icons.block, { size: 15 }), 'Bloquear')),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px' } },
            D.thread.map((m, i) => React.createElement(Msg, { key: i, m }))),
          React.createElement('div', { style: { flex: '0 0 auto', padding: '14px 22px 18px', background: T('panel'), borderTop: `1px solid ${T('line')}` } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 14px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-3') } },
              React.createElement('button', { style: { display: 'grid', placeItems: 'center', width: 34, height: 34, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer', borderRadius: 8 } }, React.createElement(Icons.image, { size: 18 })),
              React.createElement('input', { placeholder: 'Responder como agente humano…  (Enter para enviar)', style: { flex: 1, border: 'none', background: 'transparent', color: T('ink'), fontSize: 14, fontFamily: 'inherit', outline: 'none' } }),
              React.createElement('button', { className: 'b-prim', style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 16px', height: 38, border: 'none', borderRadius: 9, background: T('red'), color: '#fff', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 13.5 } }, 'Enviar', React.createElement(Icons.send, { size: 15, color: '#fff' }))))),

        // ── Panel derecho ──
        React.createElement('aside', { className: 'ibx-scroll', style: { display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', background: T('panel'), padding: '18px 16px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 50 }),
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 16 } }, '😎 JPC'),
              React.createElement('div', { className: 'mono', style: { fontSize: 11, color: T('ink-3'), marginTop: 3 } }, '+57 301 372 0223'))),

          React.createElement('div', { style: { padding: '16px 0', borderBottom: `1px solid ${T('line')}` } },
            React.createElement('div', { className: 'mono', style: { fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 11 } }, 'Acciones'),
            React.createElement('button', { className: 'b-prim', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', padding: '12px', borderRadius: 11, border: 'none', background: T('red'), color: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 9 } },
              React.createElement(Icons.check, { size: 17, color: '#fff', w: 2.2 }), 'Asunto resuelto'),
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
              [['takeover', '⌘H'], ['reactivate', '⌘R'], ['complete', '⌘D'], ['summary', '⌘S']].map(([id, hint]) =>
                React.createElement(CmdAction, { key: id, a: D.quickActions.find((x) => x.id === id), hint })))),

          React.createElement('div', { style: { padding: '16px 0', borderBottom: `1px solid ${T('line')}` } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 11 } },
              React.createElement('span', { className: 'mono', style: { fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T('ink-3') } }, 'Resumen del chat'),
              React.createElement('button', { className: 'b-cmd', style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('red'), borderRadius: 7, cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 11.5, fontWeight: 700 } },
                React.createElement(Spark, { size: 12, color: T('red') }), 'Generar')),
            React.createElement('div', { className: 'mono', style: { fontSize: 12, color: T('ink-3'), padding: '10px 0' } }, 'Sin resumen aún.')),

          React.createElement('div', { style: { padding: '16px 0 0' } },
            React.createElement('div', { className: 'mono', style: { fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 8 } }, 'Datos'),
            [['Teléfono', '+57 301 372 0223'], ['Canal', 'WhatsApp'], ['Hotel', 'ibis Barranquilla'], ['Estado IA', 'En pausa']].map(([k, v]) =>
              React.createElement('div', { key: k, className: 'mono', style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', fontSize: 12, borderBottom: `1px solid ${T('line-2')}` } },
                React.createElement('span', { style: { color: T('ink-3') } }, k),
                React.createElement('span', { style: { color: T('ink'), fontWeight: 500, textAlign: 'right' } }, v)))))));
  }

  window.InboxB = InboxB;
})();
