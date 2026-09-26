const { z } = require("zod");

const addressFields = {
  label: z.string().trim().min(1).max(50).nullable().optional(),
  fullName: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(1).max(30),
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().min(1).max(255).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional(),
};

const createAddressSchema = z.object(addressFields).strict();

const updateAddressSchema = z
  .object({
    label: addressFields.label,
    fullName: addressFields.fullName.optional(),
    phone: addressFields.phone.optional(),
    addressLine1: addressFields.addressLine1.optional(),
    // Present in UPDATABLE_FIELDS/service+repository but previously omitted
    // here: PATCH carrying addressLine2 failed `.strict()` with 422, making
    // line 2 effectively create-only. Now patchable like every other field.
    addressLine2: addressFields.addressLine2,
    city: addressFields.city.optional(),
    state: addressFields.state.optional(),
    postalCode: addressFields.postalCode.optional(),
    country: addressFields.country.optional(),
    isDefault: addressFields.isDefault,
  })
  .strict();

module.exports = { createAddressSchema, updateAddressSchema };
