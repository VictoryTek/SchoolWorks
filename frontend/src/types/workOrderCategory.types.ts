export type WorkOrderCategoryModule = 'TECHNOLOGY' | 'MAINTENANCE';

export interface WorkOrderCategory {
  id:               string;
  name:             string;
  module:           WorkOrderCategoryModule;
  isActive:         boolean;
  requiresAssetTag: boolean;
  sortOrder:        number;
  createdAt:        string;
  updatedAt:        string;
}

export interface CreateWorkOrderCategoryDto {
  name:              string;
  module:            WorkOrderCategoryModule;
  isActive?:         boolean;
  requiresAssetTag?: boolean;
  sortOrder?:        number;
}

export interface UpdateWorkOrderCategoryDto {
  name?:              string;
  isActive?:          boolean;
  requiresAssetTag?:  boolean;
  sortOrder?:         number;
}

export interface WorkOrderCategoryListResponse {
  items:      WorkOrderCategory[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

export interface WorkOrderCategoryQueryParams {
  page?:      number;
  limit?:     number;
  search?:    string;
  module?:    WorkOrderCategoryModule;
  isActive?:  boolean;
  sortBy?:    'name' | 'sortOrder' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}
