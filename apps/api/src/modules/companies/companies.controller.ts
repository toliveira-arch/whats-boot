import { asyncHandler } from '../../lib/http';
import * as companies from './companies.service';

export const listCompaniesController = asyncHandler(async (_req, res) => {
  res.json(await companies.listCompanies());
});

export const createCompanyController = asyncHandler(async (req, res) => {
  res.status(201).json(await companies.createCompany(req.body));
});

export const updateCompanyController = asyncHandler(async (req, res) => {
  res.json(await companies.updateCompany(req.params.id!, req.body));
});

export const deleteCompanyController = asyncHandler(async (req, res) => {
  res.json(await companies.deleteCompany(req.params.id!));
});
