function toSafeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    phone: user.phone ?? null,
    isActive: user.isActive,
    roles: (user.roles || [])
      .filter((link) => link && link.role)
      .map((link) => link.role.name),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = { toSafeUser };
