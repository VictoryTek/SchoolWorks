import { api } from './api';
import type {
  RoomCheckoutLookupResult,
  CompleteRoomCheckoutRequest,
  CompleteRoomCheckoutResult,
} from '../types/roomCheckout.types';

const BASE = '/room-checkout';

export const roomCheckoutService = {
  lookupTag: (tag: string): Promise<RoomCheckoutLookupResult> =>
    api.get(`${BASE}/lookup`, { params: { tag } }).then((r) => r.data),

  completeCheckout: (data: CompleteRoomCheckoutRequest): Promise<CompleteRoomCheckoutResult> =>
    api.post(`${BASE}/complete`, data).then((r) => r.data),
};
