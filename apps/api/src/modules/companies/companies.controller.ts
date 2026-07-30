import { asyncHandler } from '../../lib/http';
import * as companies from './companies.service';

export const listCompaniesController = asyncHandler(async (_req, res) => {
  res.json(await companies.listCompanies());
});
