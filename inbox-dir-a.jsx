/* Dirección A · Sereno — editorial, premium, jerarquía tipográfica fuerte.
   Tres paneles refinados. El rojo se reserva SOLO para "requiere atención".  */

(function () {
  const { Spark, Avatar, Icons } = window;

  if (!document.getElementById('inbox-a-css')) {
    const s = document.createElement('style');
    s.id = 'inbox-a-css';
    s.textContent = `
      .a-row{ cursor:pointer; transition:background .12s; }
      .a-row:hover{ background:var(--panel-2); }
      .a-row.sel{ background:var(--sel); }
      .a-pill{ cursor:pointer; transition:background .12s,color .12s; }
      .a-act{ cursor:pointer; transition:background .12s,border-color .12s; }
      .a-act:hover{ background:var(--panel-2); }
      .a-prim:hover{ background:var(--red-deep); }
      .a-ghost{ cursor:pointer; transition:background .12s; border-radius:8px; }
      .a-ghost:hover{ background:var(--panel-2); }
    `;
    document.head.appendChild(s);
  }

  const T = (s) => `var(--${s})`;

  function StatusToken({ state }) {
    if (state === 'attention')
      return React.createElement('span', { style: {
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px 3px 7px',
        background: T('red'), color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700,
        letterSpacing: '.01em', fontFamily: "'Space Grotesk',sans-serif" } },
        React.createElement(Icons.dot, { size: 6, color: 'rgba(255,255,255,.85)' }), 'Atención');
    const map = {
      ia: ['live', 'IA activa'], pending: ['gold', 'Pendiente'], done: ['ink-3', 'Resuelto'],
    };
    const [c, label] = map[state] || map.ia;
    return React.createElement('span', { style: {
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
      color: T('ink-3'), letterSpacing: '.01em' } },
      React.createElement(Icons.dot, { size: 7, color: T(c) }), label);
  }

  function Row({ c }) {
    const att = c.state === 'attention';
    return React.createElement('div', {
      className: 'a-row' + (c.selected ? ' sel' : ''),
      style: {
        position: 'relative', display: 'flex', gap: 13, padding: '15px 20px 15px 22px',
        borderBottom: `1px solid ${T('line-2')}`,
        boxShadow: c.selected ? T('shadow-sm') : 'none',
      },
    },
      att && React.createElement('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: T('red') } }),
      React.createElement(Avatar, { c, size: 42 }),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          React.createElement('span', { className: 'grotesk', style: { fontWeight: 600, fontSize: 14.5, color: T('ink'), letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            (c.emoji ? c.emoji + ' ' : '') + c.name),
          React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 11, color: T('ink-3'), whiteSpace: 'nowrap' } }, c.time)),
        React.createElement('div', { style: { fontSize: 13, color: c.unread ? T('ink') : T('ink-2'), fontWeight: c.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '4px 0 8px' } }, c.preview),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement(StatusToken, { state: c.state }),
          c.unread && React.createElement('span', { style: { marginLeft: 'auto', width: 8, height: 8, borderRadius: 999, background: T('red') } }))),
    );
  }

  function FilterPill({ f, active }) {
    return React.createElement('button', {
      className: 'a-pill',
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
        border: 'none', fontFamily: "'Space Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600,
        background: active ? T('ink') : T('panel-2'), color: active ? T('panel') : T('ink-2'),
      },
    }, f.label,
      React.createElement('span', { className: 'mono', style: { fontSize: 11, opacity: active ? .8 : .6, fontWeight: 700 } }, f.count));
  }

  function Bubble({ m }) {
    if (m.type === 'day')
      return React.createElement('div', { style: { textAlign: 'center', margin: '6px 0 16px' } },
        React.createElement('span', { className: 'mono', style: { fontSize: 11, color: T('ink-3'), letterSpacing: '.06em', textTransform: 'uppercase', background: T('panel-2'), padding: '5px 12px', borderRadius: 999 } }, m.label));
    if (m.from === 'system')
      return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', margin: '4px 0' } },
        React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: T('ink-2'), background: T('panel-2'), border: `1px dashed ${T('line')}`, padding: '7px 13px', borderRadius: 10 } },
          React.createElement(Icons.doc, { size: 14, color: T('ink-3') }), m.text));

    const guest = m.from === 'guest';
    const agent = m.from === 'agent';
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: guest ? 'flex-start' : 'flex-end', margin: '0 0 14px' } },
      !guest && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, margin: '0 4px 5px' } },
        agent
          ? React.createElement('span', { className: 'grotesk', style: { fontSize: 11, fontWeight: 700, color: T('ink-2'), letterSpacing: '.02em' } }, 'Tú · agente')
          : React.createElement(React.Fragment, null,
              React.createElement(Spark, { size: 12, color: T('red') }),
              React.createElement('span', { className: 'grotesk', style: { fontSize: 11, fontWeight: 700, color: T('red'), letterSpacing: '.02em' } }, 'FerrarIA'))),
      React.createElement('div', {
        style: {
          maxWidth: '74%', padding: '11px 15px', fontSize: 14.5, lineHeight: 1.5,
          borderRadius: guest ? '4px 16px 16px 16px' : '16px 16px 4px 16px',
          background: agent ? T('red') : guest ? T('panel-2') : T('panel'),
          color: agent ? '#fff' : T('ink'),
          border: !agent ? `1px solid ${guest ? 'transparent' : T('line')}` : 'none',
          boxShadow: T('shadow-sm'),
        },
      }, m.text),
      React.createElement('span', { className: 'mono', style: { fontSize: 10, color: T('ink-3'), margin: '5px 6px 0' } }, m.time));
  }

  function SecAction({ a }) {
    const Ic = Icons[a.icon] || Icons.doc;
    return React.createElement('button', {
      className: 'a-act',
      style: {
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
        padding: '11px 14px', borderRadius: 11, border: `1px solid ${T('line')}`,
        background: T('panel'), color: T('ink'), fontFamily: "'Space Grotesk',sans-serif",
        fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
      },
    }, React.createElement(Ic, { size: 17, color: T('ink-2') }), a.label);
  }

  function DataRow({ icon: Ic, label, value }) {
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderBottom: `1px solid ${T('line-2')}` } },
      React.createElement(Ic, { size: 16, color: T('ink-3') }),
      React.createElement('span', { style: { fontSize: 12.5, color: T('ink-3') } }, label),
      React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 12.5, color: T('ink'), fontWeight: 500 } }, value));
  }

  function InboxA() {
    const D = window.IBX;
    return React.createElement('div', { className: 'ibx', style: { width: '100%', height: '100%', background: T('bg'), color: T('ink'), display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // ── Header ──
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
          React.createElement('button', { className: 'a-ghost', style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', border: 'none', background: 'transparent', color: T('ink-2'), fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' } },
            React.createElement(Icons.help, { size: 16 }), 'Ayuda'),
          React.createElement('button', { className: 'a-ghost', style: { display: 'inline-flex', alignItems: 'center', padding: 9, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer' } },
            React.createElement(Icons.logout, { size: 17 })))),

      // ── Body ──
      React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '344px 1fr 326px' } },

        // ── Lista ──
        React.createElement('aside', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, background: T('panel'), borderRight: `1px solid ${T('line')}` } },
          React.createElement('div', { style: { padding: '18px 20px 14px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 } },
              React.createElement('h2', { className: 'grotesk', style: { margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: T('ink-2') } }, 'Cola operativa'),
              React.createElement('span', { className: 'mono', style: { marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: T('ink-3') } }, '196')),
            React.createElement('div', { style: { position: 'relative', marginBottom: 13 } },
              React.createElement('span', { style: { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' } }, React.createElement(Icons.search, { size: 16, color: T('ink-3') })),
              React.createElement('input', { placeholder: 'Buscar huésped o mensaje…', style: { width: '100%', padding: '11px 14px 11px 38px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-3'), color: T('ink'), fontSize: 13.5, fontFamily: 'inherit', outline: 'none' } })),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 13 } },
              D.filters.map((f, i) => React.createElement(FilterPill, { key: f.id, f, active: i === 0 }))),
            React.createElement('button', { className: 'a-act', style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 13px', borderRadius: 11, border: `1px solid ${T('line')}`, background: T('panel-2'), color: T('ink'), fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' } },
              React.createElement('span', { style: { fontSize: 15 } }, '🏨'),
              'ibis Barranquilla',
              React.createElement(Icons.chevron, { size: 16, color: T('ink-3'), style: { marginLeft: 'auto' } }))),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', borderTop: `1px solid ${T('line')}` } },
            D.conversations.map((c) => React.createElement(Row, { key: c.id, c })))),

        // ── Hilo ──
        React.createElement('main', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, background: T('bg') } },
          React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px', background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 40 }),
            React.createElement('div', null,
              React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 16, color: T('ink'), letterSpacing: '-0.01em' } }, '😎 JPC'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 12, color: T('ink-3') } },
                React.createElement(Icons.whatsapp, { size: 13, color: T('live') }), 'WhatsApp · ', React.createElement('span', { className: 'mono' }, '+57 301 372 0223'))),
            React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, background: T('red-soft'), color: T('red'), fontSize: 11.5, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif", marginLeft: 4 } },
              React.createElement(Icons.dot, { size: 6, color: T('red') }), 'Requiere atención'),
            React.createElement('button', { className: 'a-ghost', style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', border: `1px solid ${T('line')}`, background: T('panel'), color: T('ink-2'), borderRadius: 9, fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' } },
              React.createElement(Icons.block, { size: 15 }), 'Bloquear')),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 32px' } },
            D.thread.map((m, i) => React.createElement(Bubble, { key: i, m }))),
          React.createElement('div', { style: { flex: '0 0 auto', padding: '14px 24px 18px', background: T('panel'), borderTop: `1px solid ${T('line')}` } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px 7px 16px', borderRadius: 14, border: `1px solid ${T('line')}`, background: T('panel-3') } },
              React.createElement('button', { className: 'a-ghost', style: { display: 'grid', placeItems: 'center', width: 36, height: 36, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer', borderRadius: 9 } }, React.createElement(Icons.image, { size: 19 })),
              React.createElement('input', { placeholder: 'Responder como agente humano…', style: { flex: 1, border: 'none', background: 'transparent', color: T('ink'), fontSize: 14.5, fontFamily: 'inherit', outline: 'none' } }),
              React.createElement('button', { className: 'a-prim', style: { display: 'grid', placeItems: 'center', width: 40, height: 40, border: 'none', borderRadius: 11, background: T('red'), color: '#fff', cursor: 'pointer' } }, React.createElement(Icons.send, { size: 18, color: '#fff' }))))),

        // ── Panel derecho ──
        React.createElement('aside', { className: 'ibx-scroll', style: { display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', background: T('panel'), borderLeft: `1px solid ${T('line')}`, padding: '22px 20px' } },
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingBottom: 18, borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 72 }),
            React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 19, marginTop: 12, color: T('ink') } }, '😎 JPC'),
            React.createElement('div', { className: 'mono', style: { fontSize: 12.5, color: T('ink-3'), marginTop: 3 } }, '+57 301 372 0223'),
            React.createElement('div', { style: { display: 'flex', gap: 7, marginTop: 13 } },
              React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, background: T('red'), color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif" } },
                React.createElement(Icons.dot, { size: 6, color: 'rgba(255,255,255,.85)' }), 'Requiere atención'),
              React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', padding: '5px 11px', borderRadius: 999, border: `1px solid ${T('line')}`, color: T('ink-2'), fontSize: 11.5, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif" } }, 'Control humano'))),

          React.createElement('div', { style: { padding: '18px 0' } },
            React.createElement('div', { className: 'grotesk', style: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 12 } }, 'Acciones rápidas'),
            React.createElement('button', { className: 'a-prim', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: T('red'), color: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 14.5, fontWeight: 700, cursor: 'pointer', marginBottom: 9, boxShadow: T('shadow') } },
              React.createElement(Icons.check, { size: 18, color: '#fff', w: 2.2 }), 'Asunto resuelto'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              D.quickActions.filter((a) => !a.primary).map((a) => React.createElement(SecAction, { key: a.id, a })))),

          React.createElement('div', { style: { padding: '4px 0 18px' } },
            React.createElement('div', { className: 'grotesk', style: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 10 } }, 'Resumen del chat'),
            React.createElement('div', { style: { padding: '16px', borderRadius: 12, border: `1px dashed ${T('line')}`, background: T('panel-2'), textAlign: 'center', fontSize: 13, color: T('ink-3') } }, 'Sin resumen aún')),

          React.createElement('div', null,
            React.createElement('div', { className: 'grotesk', style: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: T('ink-3'), marginBottom: 4 } }, 'Datos de conversación'),
            React.createElement(DataRow, { icon: Icons.phone, label: 'Teléfono', value: '+57 301 372 0223' }),
            React.createElement(DataRow, { icon: Icons.whatsapp, label: 'Canal', value: 'WhatsApp' }),
            React.createElement(DataRow, { icon: Icons.flag, label: 'Hotel', value: 'ibis Barranquilla' })))));
  }

  window.InboxA = InboxA;
})();
