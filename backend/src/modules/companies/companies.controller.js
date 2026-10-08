const companiesService = require("./companies.service");
const {
  companyIdParamSchema,
  createCompanySchema,
  updateCompanySchema,
  companyListQuerySchema,
  provisionAdminSchema,
  resetAdminPasswordSchema,
  deleteCompanySchema,
  companyDomainIdParamSchema,
  createCompanyDomainSchema,
  updateCompanyDomainSchema,
  updateGoogleSignInSchema,
} = require("./companies.validation");

async function list(req, res, next) {
  try {
    const query = companyListQuerySchema.parse(req.query);
    const { companies, pagination } = await companiesService.listCompanies(query);
    return res.status(200).json({ success: true, data: { companies }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const company = await companiesService.getCompany(params.id);
    return res.status(200).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function summary(req, res, next) {
  try {
    const summary = await companiesService.getPlatformSummary();
    return res.status(200).json({ success: true, data: { summary } });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const input = updateCompanySchema.parse(req.body);
    const company = await companiesService.updateCompany(params.id, input, { id: req.user.id });
    return res.status(200).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function uploadLogo(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const company = await companiesService.setCompanyLogo(params.id, req.file, { id: req.user.id });
    return res.status(201).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function removeLogo(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const company = await companiesService.clearCompanyLogo(params.id, { id: req.user.id });
    return res.status(200).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const input = createCompanySchema.parse(req.body);
    const company = await companiesService.createCompany(input, { id: req.user.id });
    return res.status(201).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function suspend(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const company = await companiesService.suspendCompany(params.id, { id: req.user.id });
    return res.status(200).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function restore(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const company = await companiesService.restoreCompany(params.id, { id: req.user.id });
    return res.status(200).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

async function provisionAdmin(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const input = provisionAdminSchema.parse(req.body);
    const admin = await companiesService.provisionAdmin(params.id, input, { id: req.user.id });
    return res.status(201).json({ success: true, data: { admin } });
  } catch (err) {
    return next(err);
  }
}

async function resetAdminPassword(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const input = resetAdminPasswordSchema.parse(req.body);
    const admin = await companiesService.resetAdminPassword(params.id, input, { id: req.user.id });
    return res.status(200).json({ success: true, data: { admin } });
  } catch (err) {
    return next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const input = deleteCompanySchema.parse(req.body);
    const deleted = await companiesService.deleteCompany(params.id, input.confirmName, { id: req.user.id });
    return res.status(200).json({ success: true, data: { deleted } });
  } catch (err) {
    return next(err);
  }
}

async function listDomains(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const { domains } = await companiesService.listCompanyDomains(params.id, { id: req.user.id });
    return res.status(200).json({ success: true, data: { domains } });
  } catch (err) {
    return next(err);
  }
}

async function createDomain(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const input = createCompanyDomainSchema.parse(req.body);
    const domain = await companiesService.createCompanyDomain(params.id, input, { id: req.user.id });
    return res.status(201).json({ success: true, data: { domain } });
  } catch (err) {
    return next(err);
  }
}

async function updateDomain(req, res, next) {
  try {
    const params = companyDomainIdParamSchema.parse({ id: req.params.id, domainId: req.params.domainId });
    const input = updateCompanyDomainSchema.parse(req.body);
    const domain = await companiesService.updateCompanyDomain(params.id, params.domainId, input, { id: req.user.id });
    return res.status(200).json({ success: true, data: { domain } });
  } catch (err) {
    return next(err);
  }
}

async function removeDomain(req, res, next) {
  try {
    const params = companyDomainIdParamSchema.parse({ id: req.params.id, domainId: req.params.domainId });
    const deleted = await companiesService.deleteCompanyDomain(params.id, params.domainId, { id: req.user.id });
    return res.status(200).json({ success: true, data: { deleted } });
  } catch (err) {
    return next(err);
  }
}

async function updateGoogleSignIn(req, res, next) {
  try {
    const params = companyIdParamSchema.parse({ id: req.params.id });
    const input = updateGoogleSignInSchema.parse(req.body);
    const company = await companiesService.setGoogleSignIn(params.id, input, { id: req.user.id });
    return res.status(200).json({ success: true, data: { company } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  list,
  getById,
  summary,
  create,
  update,
  uploadLogo,
  removeLogo,
  suspend,
  restore,
  provisionAdmin,
  resetAdminPassword,
  destroy,
  listDomains,
  createDomain,
  updateDomain,
  removeDomain,
  updateGoogleSignIn,
};
