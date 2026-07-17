/**
 * Add the provider-neutral fields used by the Modular Misfits portal bridge.
 * Defining them before the first bridge query is required by Parse's
 * PostgreSQL adapter, which cannot query a not-yet-created dynamic column.
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const documentSchema = new Parse.Schema('contracts_Document');
  documentSchema.addString('PortalRequestId');
  documentSchema.addString('PortalNdaCompany');
  documentSchema.addDate('PortalInitialMailSentAt');
  documentSchema.addDate('DocSentAt');
  documentSchema.addString('CertificateUrl');
  documentSchema.addBoolean('IsSendMail');
  await documentSchema.update();

  const contactSchema = new Parse.Schema('contracts_Contactbook');
  contactSchema.addBoolean('IsImported');
  await contactSchema.update();
};

/**
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const documentSchema = new Parse.Schema('contracts_Document');
  documentSchema.deleteField('PortalRequestId');
  documentSchema.deleteField('PortalNdaCompany');
  documentSchema.deleteField('PortalInitialMailSentAt');
  documentSchema.deleteField('DocSentAt');
  documentSchema.deleteField('CertificateUrl');
  documentSchema.deleteField('IsSendMail');
  await documentSchema.update();

  const contactSchema = new Parse.Schema('contracts_Contactbook');
  contactSchema.deleteField('IsImported');
  await contactSchema.update();
};
