/**
 * Reference Data Controller
 * CRUD handlers for Brands, Vendors, Categories, and Models.
 * Follows the FundingSource controller pattern exactly.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../utils/errors';
import {
  GetBrandsQuerySchema, CreateBrandSchema, UpdateBrandSchema,
  GetVendorsQuerySchema, CreateVendorSchema, UpdateVendorSchema,
  GetCategoriesQuerySchema, CreateCategorySchema, UpdateCategorySchema,
  GetModelsQuerySchema, CreateModelSchema, UpdateModelSchema,
} from '../validators/referenceData.validators';

// ─────────────────────────────────────────────────────
// BRANDS
// ─────────────────────────────────────────────────────

export const getBrands = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, search, isActive, sortBy, sortOrder } = GetBrandsQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {
      ...(isActive !== undefined && { isActive }),
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };
    const [items, total] = await Promise.all([
      prisma.brands.findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.brands.count({ where }),
    ]);
    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getBrand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const item = await prisma.brands.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('Brand not found');
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const createBrand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreateBrandSchema.parse(req.body);
    const item = await prisma.brands.create({ data });
    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const updateBrand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const data = UpdateBrandSchema.parse(req.body);
    const existing = await prisma.brands.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Brand not found');
    const item = await prisma.brands.update({ where: { id }, data });
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deleteBrand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.brands.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Brand not found');
    // Soft delete — set isActive = false
    const item = await prisma.brands.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Brand deactivated', item });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ─────────────────────────────────────────────────────
// VENDORS
// ─────────────────────────────────────────────────────

export const getVendors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, search, isActive, sortBy, sortOrder } = GetVendorsQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {
      ...(isActive !== undefined && { isActive }),
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };
    const [items, total] = await Promise.all([
      prisma.vendors.findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.vendors.count({ where }),
    ]);
    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getVendor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const item = await prisma.vendors.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('Vendor not found');
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const createVendor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreateVendorSchema.parse(req.body);
    const item = await prisma.vendors.create({ data });
    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const updateVendor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const data = UpdateVendorSchema.parse(req.body);
    const existing = await prisma.vendors.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vendor not found');
    const item = await prisma.vendors.update({ where: { id }, data });
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deleteVendor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.vendors.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vendor not found');
    await prisma.vendors.delete({ where: { id } });
    res.json({ message: 'Vendor deleted' });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      res.status(409).json({ message: 'Cannot delete vendor — it is referenced by existing equipment or purchase orders.' });
      return;
    }
    handleControllerError(error, res);
  }
};

// ─────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────

export const getCategories = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, search, parentId, sortBy, sortOrder } = GetCategoriesQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where: Prisma.categoriesWhereInput = {
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
      ...(parentId !== undefined && { parentId: parentId ?? null }),
    };
    const [items, total] = await Promise.all([
      prisma.categories.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { categories: true }, // include parent ref name
      }),
      prisma.categories.count({ where }),
    ]);
    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const item = await prisma.categories.findUnique({
      where: { id },
      include: { categories: true, other_categories: true },
    });
    if (!item) throw new NotFoundError('Category not found');
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreateCategorySchema.parse(req.body);
    const item = await prisma.categories.create({ data });
    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const data = UpdateCategorySchema.parse(req.body);
    const existing = await prisma.categories.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Category not found');
    const item = await prisma.categories.update({ where: { id }, data });
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.categories.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Category not found');
    // Check if category has equipment or child categories before deleting
    const [equipmentCount, childCount] = await Promise.all([
      prisma.equipment.count({ where: { categoryId: id } }),
      prisma.categories.count({ where: { parentId: id } }),
    ]);
    if (equipmentCount > 0 || childCount > 0) {
      res.status(409).json({
        error: 'Conflict',
        message: `Cannot delete category: it has ${equipmentCount} equipment item(s) and ${childCount} sub-categor(y/ies) assigned.`,
      });
      return;
    }
    await prisma.categories.delete({ where: { id } });
    res.json({ message: 'Category deleted' });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ─────────────────────────────────────────────────────
// MODELS
// ─────────────────────────────────────────────────────

export const getModels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, search, brandId, isActive, sortBy, sortOrder } = GetModelsQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = {
      ...(isActive !== undefined && { isActive }),
      ...(brandId && { brandId }),
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };
    const [items, total] = await Promise.all([
      prisma.models.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { brands: { select: { id: true, name: true } } },
      }),
      prisma.models.count({ where }),
    ]);
    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getModel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const item = await prisma.models.findUnique({
      where: { id },
      include: { brands: { select: { id: true, name: true } } },
    });
    if (!item) throw new NotFoundError('Model not found');
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const createModel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreateModelSchema.parse(req.body);
    // Verify brand exists
    const brand = await prisma.brands.findUnique({ where: { id: data.brandId } });
    if (!brand) throw new NotFoundError('Brand not found');
    const item = await prisma.models.create({
      data,
      include: { brands: { select: { id: true, name: true } } },
    });
    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const updateModel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const data = UpdateModelSchema.parse(req.body);
    const existing = await prisma.models.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Model not found');
    if (data.brandId) {
      const brand = await prisma.brands.findUnique({ where: { id: data.brandId } });
      if (!brand) throw new NotFoundError('Brand not found');
    }
    const item = await prisma.models.update({
      where: { id },
      data,
      include: { brands: { select: { id: true, name: true } } },
    });
    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deleteModel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.models.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Model not found');
    const item = await prisma.models.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Model deactivated', item });
  } catch (error) {
    handleControllerError(error, res);
  }
};
