import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { useLocal } from '../../Utils.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { isAuthenticated } from '../../utils/AuthUtils.js';
dotenv.config({ quiet: true });

function extractKeyFromUrl(url) {
  // Create a new URL object
  const parsedUrl = new URL(url);
  // Get the pathname of the URL
  const pathname = parsedUrl.pathname; // e.g. /mybucket/path/to/file.pdf (depends on baseUrl style)
  // Extract the filename from the pathname
  const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
  return filename;
}

function makeEndpoint(endpoint) {
  if (!endpoint) return '';

  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  return `https://${endpoint}`;
}

function makeS3Client() {
  const accessKeyId = process.env.DO_ACCESS_KEY_ID;

  const secretAccessKey = process.env.DO_SECRET_ACCESS_KEY;

  const region = process.env.DO_REGION;

  const endpoint = makeEndpoint(process.env.DO_ENDPOINT);

  return new S3Client({
    region,
    endpoint, // endpoint should be Url e.g. https://blr1.digitaloceanspaces.com)
    credentials: { accessKeyId, secretAccessKey },
  });
}

export default async function getPresignedUrl(url) {
  if (url?.includes('/files/')) {
    return presignedlocalUrl(url);
  } else {
    const client = makeS3Client();

    const bucket = process.env.DO_SPACE;

    const key = extractKeyFromUrl(url);

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    // Expires: 160 seconds
    const expiresIn = 160;

    // presignedGETURL return presignedUrl with expires time
    const presignedGETURL = await presign(client, command, { expiresIn });
    return presignedGETURL;
  }
}

// Does `url` actually appear on this document/template? Checked against the
// fields that legitimately carry file URLs, plus the audit trail, rather than
// trusting the caller.
function urlBelongsToObject(url, obj) {
  if (!url || !obj) return false;
  const direct = [obj.URL, obj.SignedUrl, obj.OriginalUrl];
  if (direct.some(u => u && u === url)) return true;
  const trail = Array.isArray(obj.AuditTrail) ? obj.AuditTrail : [];
  if (trail.some(e => e?.SignedUrl === url)) return true;
  return false;
}

export async function getSignedUrl(request) {
  try {
    const docId = request.params.docId || '';
    const templateId = request.params.templateId || '';
    const url = request.params.url;

    if (docId || templateId) {
      try {
        if (url?.includes('/files/')) {
          // SECURITY: this signed whatever `/files/` path the caller supplied,
          // using a key derived from MASTER_KEY, with no check that the path
          // belonged to the named document. That is a signing oracle for
          // arbitrary file paths. Require the URL to actually appear on the
          // object the caller named.
          const ownerQuery = new Parse.Query(docId ? 'contracts_Document' : 'contracts_Template');
          ownerQuery.equalTo('objectId', docId ? docId : templateId);
          ownerQuery.notEqualTo('IsArchive', true);
          const ownerRes = await ownerQuery.first({ useMasterKey: true });
          if (!ownerRes) {
            throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
          }
          if (!urlBelongsToObject(url, ownerRes.toJSON())) {
            throw new Parse.Error(
              Parse.Error.OPERATION_FORBIDDEN,
              'File is not associated with this document.'
            );
          }
          return presignedlocalUrl(url);
        } else if (useLocal !== 'true') {
          const query = new Parse.Query(docId ? 'contracts_Document' : 'contracts_Template');
          query.equalTo('objectId', docId ? docId : templateId);
          query.include('ExtUserPtr.TenantId');
          query.notEqualTo('IsArchive', true);
          const res = await query.first({ useMasterKey: true });
          if (!res) return url;

          const _resDoc = res?.toJSON();
          // Ensure user is authenticated if OTP is required
          if (_resDoc?.IsEnableOTP) {
            const isAuth = await isAuthenticated(request?.user);
            if (!isAuth) {
              throw new Parse.Error(
                Parse.Error.INVALID_SESSION_TOKEN,
                'User is not authenticated.'
              );
            }
          }

          const presignedUrl = await getPresignedUrl(url);
          return presignedUrl;
        } else {
          return url;
        }
      } catch (err) {
        console.log('Err in presigned url', err);
        throw err;
      }
    } else {
      const isAuth = await isAuthenticated(request?.user);
      if (!isAuth) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
      } else {
        if (url?.includes('/files/')) {
          return presignedlocalUrl(url);
        } else if (useLocal !== 'true') {
          const presignedUrl = await getPresignedUrl(url);
          return presignedUrl;
        } else {
          return url;
        }
      }
    }
  } catch (err) {
    console.log('error in getsignedurl', err);
    const code = err.code || 400;
    const msg = err.message;
    const error = new Parse.Error(code, msg);
    throw error;
  }
}

// File-URL JWTs were signed with MASTER_KEY, which made every issued URL a
// derivative of the Parse master credential and meant rotating that key
// invalidated all outstanding file links. Prefer a dedicated secret; fall back to
// MASTER_KEY so existing deployments keep working until FILE_URL_SIGNING_KEY is set.
function fileUrlSigningKey() {
  return process.env.FILE_URL_SIGNING_KEY || process.env.MASTER_KEY;
}

// Function to generate a signed URL with JWT
export function getSignedLocalUrl(fileUrl, expirationTimeInSeconds) {
  const secretKey = fileUrlSigningKey();
  const exp = expirationTimeInSeconds || 200;
  try {
    // Create the payload with the file URL and expiration time
    const payload = {
      fileUrl,
      exp: Math.floor(Date.now() / 1000) + exp, // Expiry time in seconds
    };

    // Generate the JWT token
    const token = jwt.sign(payload, secretKey);
    // Return the signed URL containing the token
    return `${fileUrl}?token=${token}`;
  } catch (err) {
    console.log('Err while siging local url', err);
    throw new Error('Invalid or expired token.');
  }
}

export function presignedlocalUrl(signedUrl, expirationTimeInSeconds) {
  if (signedUrl?.includes('/files/')) {
    const fileUrl = signedUrl.split('?')?.[0];
    const secretKey = fileUrlSigningKey();
    const exp = expirationTimeInSeconds || 200;
    try {
      // Create the payload with the file URL and expiration time
      const payload = {
        fileUrl,
        exp: Math.floor(Date.now() / 1000) + exp, // Expiry time in seconds
      };
      // Generate the JWT token
      const token = jwt.sign(payload, secretKey);
      // Return the signed URL containing the token
      return `${fileUrl}?token=${token}`;
    } catch (err) {
      throw new Error('Invalid or expired token.');
    }
  } else {
    return signedUrl;
  }
}

// Function to validate the signed URL
export async function validateSignedLocalUrl(signedUrl) {
  const urlParams = new URLSearchParams(signedUrl.split('?')[1]);
  const token = urlParams.get('token');
  try {
    if (!token) {
      throw new Error('No token provided.');
    }
    const secretKey = fileUrlSigningKey();
    // Now verify the token (validate signature and expiration automatically)
    const decoded = jwt.verify(token, secretKey);
    // Check if the file URL in the JWT matches the requested file URL
    const fileUrl = signedUrl.split('?')[0];
    if (decoded.fileUrl !== fileUrl) {
      throw new Error('Invalid file URL in token.');
    }
    // If the token is valid and not expired, return the file URL
    return signedUrl;
  } catch (error) {
    console.log('Error validating file', error.message);
    return 'Unauthorized';
  }
}
