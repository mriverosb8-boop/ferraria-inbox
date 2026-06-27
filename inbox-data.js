/* FerrarIA Inbox — datos compartidos para las 3 direcciones de rediseño.
   Datos de ejemplo basados en la app real (ibis Barranquilla, WhatsApp, IA + agente). */

window.IBX = (function () {
  // Destello puro — el logo (chispa de IA), 4 puntas.
  const SPARK = 'M50,18 C53,40 60,47 82,50 C60,53 53,60 50,82 C47,60 40,53 18,50 C40,47 47,40 50,18 Z';

  // estado: 'attention' (requiere humano YA · rojo) · 'ia' (IA atendiendo · calmo)
  //         'pending' (esperando) · 'done' (resuelto)
  const conversations = [
    { id: 'jpc', name: 'JPC', emoji: '😎', initials: 'JP', time: '14:31',
      preview: 'Perfecto, te reenvío el forms 😊', state: 'attention', lastFrom: 'agent',
      phone: '+57 301 372 0223', channel: 'WhatsApp', hotel: 'ibis Barranquilla',
      unread: false, selected: true },
    { id: 'lucia', name: 'Lucía', emoji: '🌸', initials: 'LU', time: '13:58',
      preview: 'Quisiera cancelar mi reserva del jueves', state: 'attention', lastFrom: 'guest',
      phone: '+57 320 118 9042', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: true },
    { id: 'andres', name: 'Andrés', emoji: '', initials: 'AN', time: '13:24',
      preview: 'El aire de la 412 no enfría 🥵', state: 'attention', lastFrom: 'guest',
      phone: '+57 311 540 7781', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: true },
    { id: 'diana', name: 'Diana', emoji: '💎', initials: 'DV', time: '12:41',
      preview: 'Ok, igual llego ya como a las 4 o 5 pm', state: 'pending', lastFrom: 'guest',
      phone: '+57 312 555 0144', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: false },
    { id: 'mariajose', name: 'María José', emoji: '✨', initials: 'MJ', time: '11:07',
      preview: '¿Tienen disponibilidad para el 24 de junio?', state: 'ia', lastFrom: 'guest',
      phone: '+57 300 771 2280', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: false },
    { id: 'arg', name: 'Argentina', emoji: '😎', initials: 'AR', time: '09:52',
      preview: 'Las habitaciones cuentan con televisor, pero no son Smart TV…', state: 'ia', lastFrom: 'ia',
      phone: '+54 9 11 2222 3344', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: false },
    { id: 'matias', name: 'Matías', emoji: '', initials: 'MA', time: 'Ayer',
      preview: 'hola', state: 'ia', lastFrom: 'guest',
      phone: '+54 9 11 5555 7788', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: false },
    { id: 'carlos', name: 'Carlos R.', emoji: '', initials: 'CR', time: 'Ayer',
      preview: '¡Mil gracias por la ayuda! 🙌', state: 'done', lastFrom: 'guest',
      phone: '+57 315 880 1190', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: false },
    { id: 'paula', name: 'Paula', emoji: '', initials: 'PA', time: 'Ayer',
      preview: '¿El desayuno está incluido en la tarifa?', state: 'ia', lastFrom: 'guest',
      phone: '+57 317 442 9015', channel: 'WhatsApp', hotel: 'ibis Barranquilla', unread: false },
  ];

  // Hilo del chat activo (JPC).
  const thread = [
    { type: 'day', label: '21 de junio' },
    { from: 'ia', text: 'Estoy contactando con un asistente humano para darte una respuesta lo antes posible ⏳.', time: '14:30' },
    { from: 'guest', text: 'Cotizar otra vez', time: '14:31' },
    { from: 'system', text: 'Se reenvió el formulario de cotización al huésped', time: '14:31' },
    { from: 'agent', text: 'Perfecto, te reenvío el forms 😊', time: '14:31' },
  ];

  const quickActions = [
    { id: 'resolved', label: 'Asunto resuelto', icon: 'check', primary: true },
    { id: 'takeover', label: 'Tomar control humano', icon: 'user' },
    { id: 'reactivate', label: 'Reactivar IA', icon: 'spark' },
    { id: 'complete', label: 'Marcar como completado', icon: 'flag' },
    { id: 'summary', label: 'Crear resumen del chat', icon: 'doc' },
  ];

  const filters = [
    { id: 'all', label: 'Todas', count: 196 },
    { id: 'unread', label: 'Sin leer', count: 0 },
    { id: 'ia', label: 'IA activa', count: 44 },
    { id: 'att', label: 'Atención', count: 3 },
  ];

  const stats = [
    { id: 'att', label: 'Requieren atención', value: 3, tone: 'red' },
    { id: 'ia', label: 'IA atendiendo', value: 44, tone: 'live' },
    { id: 'queue', label: 'En cola', value: 196, tone: 'neutral' },
  ];

  const active = {
    name: 'JPC', emoji: '😎', initials: 'JP',
    phone: '+57 301 372 0223', channel: 'WhatsApp', hotel: 'ibis Barranquilla',
  };

  return { SPARK, conversations, thread, quickActions, filters, stats, active };
})();
