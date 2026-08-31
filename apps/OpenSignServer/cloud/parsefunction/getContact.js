import { capabilityRequired, verifyCapability } from './docCapability.js';

export default async function getContact(request) {
  const contactId = request.params.contactId;
  // SECURITY (MM-02). This returned every field of any contact — including
  // soft-deleted ones — to anyone who knew an objectId, with no caller check.
  //
  // The legitimate unauthenticated caller is a guest signer loading their own
  // details on the signing page, and their link names both the document and
  // themselves. So an anonymous caller must present a capability token minted
  // for (docId, contactId), which proves the pairing rather than mere knowledge
  // of the id. Enforcement is opt-in (DOC_CAPABILITY_REQUIRED) so that links
  // already sitting in counterparties' inboxes keep working until reissued.
  if (capabilityRequired() && !request?.user) {
    const token = request?.params?.capability || request?.headers?.capability || '';
    const docId = request?.params?.docId || '';
    if (!docId || !verifyCapability(token, docId, contactId)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not authorized for this contact.');
    }
    // The token proves the pairing was issued; confirm the contact really is a
    // signer on that document so a token cannot be pointed at a third party.
    const doc = await new Parse.Query('contracts_Document')
      .select(['Signers'])
      .get(docId, { useMasterKey: true })
      .catch(() => null);
    const signers = doc?.toJSON()?.Signers || [];
    if (!signers.some(x => x?.objectId === contactId)) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not a signer on this document.');
    }
  }
  try {
    const contactCls = new Parse.Query('contracts_Contactbook');
    const contactRes = await contactCls.get(contactId, { useMasterKey: true });
    return contactRes;
  } catch (err) {
    console.log('Err in contracts_Contactbook class ', err);
    throw err;
  }
}
