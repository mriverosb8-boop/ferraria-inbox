export const ACTIVE_HOTEL_STORAGE_KEY = "ferraria:activeHotelId";

export function readStoredActiveHotelId(): string | null {
  if (typeof window === "undefined") return null;
  const value = sessionStorage.getItem(ACTIVE_HOTEL_STORAGE_KEY)?.trim();
  return value || null;
}

export function writeStoredActiveHotelId(hotelId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const trimmed = typeof hotelId === "string" ? hotelId.trim() : "";
  if (trimmed) {
    sessionStorage.setItem(ACTIVE_HOTEL_STORAGE_KEY, trimmed);
  } else {
    sessionStorage.removeItem(ACTIVE_HOTEL_STORAGE_KEY);
  }
}
