/**
 * Types for the Room Check Out feature.
 *
 * Room Check Out reassigns existing equipment.roomId/officeLocationId from a
 * scanned list of tags — it has no server-side session/history model (see
 * .github/docs/subagent_docs/ROOM_CHECKOUT_spec.md).
 */

export interface RoomCheckoutLookupResult {
  id: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  status: string;
  isDisposed: boolean;
  roomId: string | null;
  officeLocationId: string | null;
  room: { id: string; name: string } | null;
  officeLocation: { id: string; name: string } | null;
}

export interface CompleteRoomCheckoutRequest {
  officeLocationId: string;
  roomId: string;
  equipmentIds: string[];
}

export interface CompleteRoomCheckoutResult {
  moved: number;
  unassigned: number;
  failed: number;
  errors: Array<{ equipmentId: string; error: string }>;
}
