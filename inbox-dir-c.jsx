/* Dirección C · Conversacional — mensajería cálida y premium.
   Avatares en el hilo, burbujas grandes, IA vs agente humano inconfundibles,
   barra de acciones rápidas flotante sobre el compositor. */

(function () {
  const { Spark, Avatar, Icons } = window;
  const T = (s) => `var(--${s})`;

  if (!document.getElementById('inbox-c-css')) {
    const s = document.createElement('style');
    s.id = 'inbox-c-css';
    s.textContent = `
      .c-row{ cursor:pointer; transition:background .12s; border-radius:16px; }
      .c-row:hover{ background:var(--panel-2); }
      .c-row.sel{ background:var(--panel-2); }
      .c-chip{ cursor:pointer; transition:transform .1s,background .12s,box-shadow .12s; }
      .c-chip:hover{ transform:translateY(-1px); }
      .c-prim:hover{ background:var(--red-deep); }
      .c-soft:hover{ background:var(--panel-2); }
    `;
    document.head.appendChild(s);
  }

  function Row({ c }) {
    const att = c.state === 'attention';
    return React.createElement('div', { className: 'c-row' + (c.selected ? ' sel' : ''), style: { display: 'flex', gap: 13, padding: '13px 14px', margin: '2px 8px' } },
      React.createElement('div', { style: { position: 'relative', flex: '0 0 auto' } },
        React.createElement(Avatar, { c, size: 50, ring: att ? true : undefined }),
        c.state === 'ia' && React.createElement('span', { style: { position: 'absolute', right: -1, bottom: -1, width: 16, height: 16, borderRadius: 999, background: T('live'), border: `2.5px solid ${T('panel')}`, display: 'grid', placeItems: 'center' } },
          React.createElement(Spark, { size: 8, color: '#fff' }))),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          React.createElement('span', { className: 'grotesk', style: { fontWeight: 600, fontSize: 15, color: T('ink'), letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (c.emoji ? c.emoji + ' ' : '') + c.name),
          React.createElement('span', { style: { marginLeft: 'auto', fontSize: 11.5, color: att ? T('red') : T('ink-3'), fontWeight: att ? 700 : 400, whiteSpace: 'nowrap' } }, c.time)),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 } },
          React.createElement('span', { style: { flex: 1, minWidth: 0, fontSize: 13.5, color: c.unread || att ? T('ink') : T('ink-2'), fontWeight: c.unread ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, c.preview),
          att
            ? React.createElement('span', { style: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: T('red'), color: '#fff', fontSize: 10.5, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif" } }, 'Atención')
            : c.unread && React.createElement('span', { style: { flex: '0 0 auto', minWidth: 19, height: 19, padding: '0 6px', borderRadius: 999, background: T('red'), color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', fontFamily: "'Space Grotesk',sans-serif" } }, '1'))));
  }

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
        React.createElement('div', {
          style: {
            padding: '12px 17px', fontSize: 15, lineHeight: 1.5,
            borderRadius: guest ? '6px 20px 20px 20px' : '20px 20px 6px 20px',
            background: agent ? T('red') : ia ? T('red-soft') : T('panel-2'),
            color: agent ? '#fff' : T('ink'),
            border: ia ? `1.5px solid color-mix(in srgb, var(--red) 35%, transparent)` : 'none',
          },
        }, m.text),
        React.createElement('span', { style: { fontSize: 10.5, color: T('ink-3'), margin: '6px 7px 0', fontFamily: "'Space Grotesk',sans-serif" } }, m.time)));
  }

  function ActionChip({ a }) {
    const Ic = Icons[a.icon] || Icons.doc;
    if (a.primary)
      return React.createElement('button', { className: 'c-chip c-prim', style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', border: 'none', borderRadius: 999, background: T('red'), color: '#fff', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: T('shadow') } },
        React.createElement(Ic, { size: 16, color: '#fff', w: 2.2 }), a.label);
    return React.createElement('button', { className: 'c-chip c-soft', style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', border: `1px solid ${T('line')}`, borderRadius: 999, background: T('panel'), color: T('ink'), fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' } },
      React.createElement(Ic, { size: 16, color: T('ink-2') }), a.label);
  }

  function InboxC() {
    const D = window.IBX;
    return React.createElement('div', { className: 'ibx', style: { width: '100%', height: '100%', background: T('bg'), color: T('ink'), display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // ── Header ──
      React.createElement('header', { style: { flex: '0 0 auto', height: 64, display: 'flex', alignItems: 'center', gap: 20, padding: '0 24px', background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 11 } },
          React.createElement(Spark, { size: 25, color: T('red') }),
          React.createElement('span', { className: 'grotesk', style: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' } }, 'Ferrar', React.createElement('span', { style: { color: T('red') } }, 'IA'))),
        React.createElement('div', { style: { display: 'flex', gap: 4, marginLeft: 8 } },
          React.createElement('button', { className: 'grotesk', style: { padding: '9px 16px', border: 'none', borderRadius: 999, background: T('red-soft'), color: T('red'), fontWeight: 700, fontSize: 13.5, cursor: 'pointer' } }, 'Conversaciones'),
          React.createElement('button', { className: 'grotesk', style: { padding: '9px 16px', border: 'none', borderRadius: 999, background: 'transparent', color: T('ink-2'), fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } }, 'Reservas 0')),
        React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 } },
          React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: T('live'), fontFamily: "'Space Grotesk',sans-serif" } },
            React.createElement(Icons.dot, { size: 8, color: T('live') }), 'Conectado'),
          React.createElement('button', { className: 'c-soft', style: { display: 'grid', placeItems: 'center', width: 38, height: 38, border: `1px solid ${T('line')}`, borderRadius: 999, background: T('panel'), color: T('ink-2'), cursor: 'pointer' } }, React.createElement(Icons.help, { size: 17 })),
          React.createElement(Avatar, { c: { id: 'me', initials: 'YO' }, size: 38 }))),

      // ── Body ──
      React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '358px 1fr 300px' } },

        // ── Lista ──
        React.createElement('aside', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, background: T('panel'), borderRight: `1px solid ${T('line')}` } },
          React.createElement('div', { style: { padding: '20px 18px 12px' } },
            React.createElement('h2', { className: 'grotesk', style: { margin: '0 6px 14px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' } }, 'Conversaciones'),
            React.createElement('div', { style: { position: 'relative', marginBottom: 6 } },
              React.createElement('span', { style: { position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)' } }, React.createElement(Icons.search, { size: 17, color: T('ink-3') })),
              React.createElement('input', { placeholder: 'Buscar…', style: { width: '100%', padding: '12px 16px 12px 42px', borderRadius: 999, border: 'none', background: T('panel-2'), color: T('ink'), fontSize: 14, fontFamily: 'inherit', outline: 'none' } }))),
          React.createElement('div', { style: { display: 'flex', gap: 7, padding: '4px 16px 12px', overflow: 'hidden' } },
            D.filters.map((f, i) => React.createElement('button', { key: f.id, className: 'grotesk', style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', border: 'none', borderRadius: 999, cursor: 'pointer', background: i === 0 ? T('ink') : T('panel-2'), color: i === 0 ? T('panel') : T('ink-2'), fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', flex: '0 0 auto' } },
              f.label, React.createElement('span', { style: { opacity: .6, fontSize: 11 } }, f.count)))),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 } },
            D.conversations.map((c) => React.createElement(Row, { key: c.id, c })))),

        // ── Hilo ──
        React.createElement('main', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: T('bg') } },
          React.createElement('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 26px', background: T('panel'), borderBottom: `1px solid ${T('line')}` } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 44, ring: true }),
            React.createElement('div', null,
              React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' } }, '😎 JPC'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 12.5, color: T('red'), fontWeight: 600 } },
                React.createElement(Icons.dot, { size: 7, color: T('red') }), 'Requiere atención humana')),
            React.createElement('button', { className: 'c-soft', style: { marginLeft: 'auto', display: 'grid', placeItems: 'center', width: 40, height: 40, border: `1px solid ${T('line')}`, borderRadius: 999, background: T('panel'), color: T('ink-3'), cursor: 'pointer' } }, React.createElement(Icons.block, { size: 17 }))),
          React.createElement('div', { className: 'ibx-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 40px 8px' } },
            D.thread.map((m, i) => React.createElement(Bubble, { key: i, m }))),
          // barra de acciones flotante + compositor
          React.createElement('div', { style: { flex: '0 0 auto', padding: '0 26px 20px' } },
            React.createElement('div', { className: 'ibx-scroll', style: { display: 'flex', gap: 9, padding: '14px 2px', overflowX: 'auto' } },
              D.quickActions.map((a) => React.createElement(ActionChip, { key: a.id, a }))),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px 9px 18px', borderRadius: 999, background: T('panel'), border: `1px solid ${T('line')}`, boxShadow: T('shadow') } },
              React.createElement('button', { style: { display: 'grid', placeItems: 'center', width: 38, height: 38, border: 'none', background: 'transparent', color: T('ink-3'), cursor: 'pointer', borderRadius: 999 } }, React.createElement(Icons.image, { size: 20 })),
              React.createElement('input', { placeholder: 'Escribe como agente humano…', style: { flex: 1, border: 'none', background: 'transparent', color: T('ink'), fontSize: 15, fontFamily: 'inherit', outline: 'none' } }),
              React.createElement('button', { className: 'c-prim', style: { display: 'grid', placeItems: 'center', width: 44, height: 44, border: 'none', borderRadius: 999, background: T('red'), color: '#fff', cursor: 'pointer' } }, React.createElement(Icons.send, { size: 19, color: '#fff' }))))),

        // ── Panel derecho (lean) ──
        React.createElement('aside', { className: 'ibx-scroll', style: { display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', background: T('panel'), borderLeft: `1px solid ${T('line')}`, padding: '28px 22px' } },
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' } },
            React.createElement(Avatar, { c: { id: 'jpc', emoji: '😎' }, size: 84 }),
            React.createElement('div', { className: 'grotesk', style: { fontWeight: 700, fontSize: 20, marginTop: 14 } }, '😎 JPC'),
            React.createElement('div', { style: { fontSize: 13, color: T('ink-3'), marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement(Icons.whatsapp, { size: 14, color: T('live') }), 'WhatsApp'),
            React.createElement('div', { className: 'mono', style: { fontSize: 13, color: T('ink-2'), marginTop: 8 } }, '+57 301 372 0223')),

          React.createElement('div', { style: { display: 'flex', gap: 8, margin: '22px 0', justifyContent: 'center' } },
            React.createElement('button', { className: 'c-soft', style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '13px 8px', border: `1px solid ${T('line')}`, borderRadius: 16, background: T('panel'), color: T('ink'), cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600 } },
              React.createElement(Icons.phone, { size: 18, color: T('ink-2') }), 'Llamar'),
            React.createElement('button', { className: 'c-soft', style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '13px 8px', border: `1px solid ${T('line')}`, borderRadius: 16, background: T('panel'), color: T('ink'), cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600 } },
              React.createElement(Icons.user, { size: 18, color: T('ink-2') }), 'Perfil'),
            React.createElement('button', { className: 'c-soft', style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '13px 8px', border: `1px solid ${T('line')}`, borderRadius: 16, background: T('panel'), color: T('ink'), cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600 } },
              React.createElement(Icons.flag, { size: 18, color: T('ink-2') }), 'Reserva')),

          React.createElement('div', { style: { padding: '18px', borderRadius: 18, background: T('panel-2') } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
              React.createElement(Spark, { size: 15, color: T('red') }),
              React.createElement('span', { className: 'grotesk', style: { fontSize: 13.5, fontWeight: 700 } }, 'Resumen del chat')),
            React.createElement('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.5, color: T('ink-3') } }, 'Sin resumen aún. Genera uno con IA cuando cierres el caso.'),
            React.createElement('button', { className: 'c-chip', style: { marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', border: 'none', borderRadius: 999, background: T('red'), color: '#fff', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontSize: 12.5, fontWeight: 700 } },
              React.createElement(Spark, { size: 13, color: '#fff' }), 'Generar resumen')))));
  }

  window.InboxC = InboxC;
})();
