// This optional date is an agreement term, not a creation or signing timestamp.
exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Document');
  if (!(await schema.get()).fields.PortalEffectiveDate) {
    schema.addString('PortalEffectiveDate');
    await schema.update();
  }
};
// Old code ignores the field. Do not destroy recorded dates on code rollback.
exports.down = async () => {};
