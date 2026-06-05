export const IBIS_BARRANQUILLA_HOTEL_ID = "df95ac5a-a2dd-41d4-8e66-e38fedf12ce5";

export type ReservaStatus = "pendiente" | "completada" | "rechazada";
export type ReservasTab = "pendientes" | "procesadas";

export type ReservaQuoteRequest = {
  id: string;
  sender_phone: string | null;
  guest_name: string | null;
  guest_email: string | null;
  fecha_entrada: string | null;
  fecha_salida: string | null;
  nights: number | null;
  num_rooms: number | null;
  room_type_requested: string | null;
  adults: number | null;
  children: number | null;
  pets: boolean | null;
  breakfast_included: boolean | null;
  total_amount: number | string | null;
  breakdown_json: Record<string, unknown> | null;
  conversation_id: string | null;
};

export type Reserva = {
  id: string;
  hotel_id: string;
  quote_request_id: string;
  conversation_id: string | null;
  titular_nombre: string;
  cedula: string;
  correo: string;
  notas: string | null;
  status: ReservaStatus;
  rejection_reason: string | null;
  created_at: string;
  completed_at: string | null;
  processed_by: string | null;
  quote_requests: ReservaQuoteRequest | null;
};

export type ReservasAvailableHotel = {
  id: string;
  name: string;
};

export type ReservasListResponse = {
  reservas?: Reserva[];
  count?: number;
  availableHotels?: ReservasAvailableHotel[];
  activeHotelId?: string | null;
  error?: string;
};

export type ReservaActionResponse = {
  ok: boolean;
  reserva?: Reserva;
  error?: string;
};
