import { api } from './api';
import type {
  DeviceCartDetail,
  DeviceCartItemSummary,
  CreateCartRequest,
  UpdateCartRequest,
  AddCartItemRequest,
  ScanToCartRequest,
  CommitCartRequest,
  ReturnCartItemRequest,
  ReturnAllCartItemsRequest,
} from '../types/deviceCart.types';
import type { ListCartsResponse, ListCartsParams } from '../types/deviceCart.types';

const BASE = '/device-carts';

export const deviceCartService = {
  list: (params?: ListCartsParams): Promise<ListCartsResponse> =>
    api.get(BASE, { params }).then((r) => r.data),

  getById: (id: string): Promise<DeviceCartDetail> =>
    api.get(`${BASE}/${id}`).then((r) => r.data),

  create: (data: CreateCartRequest): Promise<DeviceCartDetail> =>
    api.post(BASE, data).then((r) => r.data),

  update: (id: string, data: UpdateCartRequest): Promise<DeviceCartDetail> =>
    api.put(`${BASE}/${id}`, data).then((r) => r.data),

  deleteCart: (id: string): Promise<void> =>
    api.delete(`${BASE}/${id}`).then(() => undefined),

  addItem: (cartId: string, data: AddCartItemRequest): Promise<DeviceCartItemSummary> =>
    api.post(`${BASE}/${cartId}/items`, data).then((r) => r.data),

  removeItem: (cartId: string, itemId: string): Promise<void> =>
    api.delete(`${BASE}/${cartId}/items/${itemId}`).then(() => undefined),

  scanToCart: (cartId: string, data: ScanToCartRequest): Promise<DeviceCartItemSummary> =>
    api.post(`${BASE}/${cartId}/scan`, data).then((r) => r.data),

  commit: (cartId: string, data?: CommitCartRequest): Promise<DeviceCartDetail> =>
    api.post(`${BASE}/${cartId}/commit`, data ?? {}).then((r) => r.data),

  returnItem: (cartId: string, itemId: string, data: ReturnCartItemRequest): Promise<DeviceCartDetail> =>
    api.post(`${BASE}/${cartId}/items/${itemId}/return`, data).then((r) => r.data),

  returnAll: (cartId: string, data: ReturnAllCartItemsRequest): Promise<DeviceCartDetail> =>
    api.post(`${BASE}/${cartId}/return-all`, data).then((r) => r.data),
};
