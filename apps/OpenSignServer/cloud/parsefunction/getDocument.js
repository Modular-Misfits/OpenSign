import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { capabilityRequired, verifyCapability } from './docCapability.js';
export default async function getDocument(request) {
  const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
  const docId = request.params.docId;
  const include = request?.params?.include || '';
  const sessiontoken = request?.headers?.sessiontoken || '';
  try {
    if (docId) {
      try {
        const query = new Parse.Query('contracts_Document');
        query.equalTo('objectId', docId);
        query.include('ExtUserPtr');
        query.include('ExtUserPtr.TenantId');
        query.include('CreatedBy');
        query.include('Signers');
        query.include('AuditTrail.UserPtr');
        query.include('Placeholders');
        query.include('DeclineBy');
        query.notEqualTo('IsArchive', true);
        if (include) {
          query?.include(include);
        }
        const res = await query.first({ useMasterKey: true });
        if (res) {
          // SECURITY (MM-02). A non-OTP document was returned in full to anyone
          // who knew its objectId. Ids are short and travel through invitation
          // URLs, browser history, referrers and forwarded mail, so knowing one
          // is not authorization. When capability enforcement is on, an
          // unauthenticated caller must also present a token this server minted
          // for this document.
          //
          // Enforcement is opt-in via DOC_CAPABILITY_REQUIRED because invitation
          // links already in external counterparties' inboxes carry no token,
          // and refusing them would break signing mid-agreement.
          if (capabilityRequired() && !request?.user) {
            const token = request?.params?.capability || request?.headers?.capability || '';
            const contactId = request?.params?.contactId || '';
            if (!verifyCapability(token, docId, contactId) && !verifyCapability(token, docId, '')) {
              return { error: "You don't have access of this document!" };
            }
          }
          const IsEnableOTP = res?.get('IsEnableOTP') || false;
          const document = JSON.parse(JSON.stringify(res));
          delete document.ExtUserPtr.TenantId.FileAdapters;
          delete document?.ExtUserPtr?.TenantId?.PfxFile;
          if (!IsEnableOTP) {
            return document;
          } else {
            if (sessiontoken) {
              try {
                const userRes = await axios.get(serverUrl + '/users/me', {
                  headers: {
                    'X-Parse-Application-Id': serverAppId,
                    'X-Parse-Session-Token': sessiontoken,
                  },
                });
                const userId = userRes.data && userRes.data?.objectId;
                const acl = res.getACL();
                if (userId && acl && acl.getReadAccess(userId)) {
                  return document;
                } else {
                  return { error: "You don't have access of this document!" };
                }
              } catch (err) {
                console.log('err user in not authenticated', err);
                return { error: "You don't have access of this document!" };
              }
            } else {
              return { error: "You don't have access of this document!" };
            }
          }
        } else {
          return { error: "document deleted or you don't have access." };
        }
      } catch (err) {
        console.log('err', err);
        return err;
      }
    } else {
      return { error: 'Please pass required parameters!' };
    }
  } catch (err) {
    console.log('err', err);
    if (err.code == 209) {
      return { error: 'Invalid session token' };
    } else {
      return { error: "You don't have access of this document!" };
    }
  }
}
