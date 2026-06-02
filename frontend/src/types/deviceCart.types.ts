import type {
  CartStatus,
  AssigneeType,
  CheckoutCondition,
  DeviceCartAssignedUser,
  DeviceCartUser,
  DeviceCartEquipmentSummary,
  DeviceCartItemSummary,
  DeviceCartSummary,
  DeviceCartDetail,
  CreateCartRequest,
  UpdateCartRequest,
  AddCartItemRequest,
  ScanToCartRequest,
  CommitCartRequest,
  ReturnCartItemRequest,
  ReturnAllCartItemsRequest,
} from '@mgspe/shared-types';

// Re-export shared types for convenience
export type {
  CartStatus,
  AssigneeType,
  CheckoutCondition,
  DeviceCartAssignedUser,
  DeviceCartUser,
  DeviceCartEquipmentSummary,
  DeviceCartItemSummary,
  DeviceCartSummary,
  DeviceCartDetail,
  CreateCartRequest,
  UpdateCartRequest,
  AddCartItemRequest,
  ScanToCartRequest,
  CommitCartRequest,
  ReturnCartItemRequest,
  ReturnAllCartItemsRequest,
};

export interface ListCartsResponse {
  data: DeviceCartSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListCartsWithItemsResponse {
  data: DeviceCartDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListCartsParams {
  status?: CartStatus;
  statusIn?: string;
  page?: number;
  pageSize?: number;
  tagNumber?: string;
  userSearch?: string;
  search?: string;
  locationId?: string;
  createdById?: string;
  includeItems?: boolean;
}
