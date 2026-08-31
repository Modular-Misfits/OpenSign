import crypto from 'node:crypto';
import { appName, smtpenable, updateMailCount } from '../../Utils.js';

// SECURITY (MM-07). OTPs were generated with Math.random() -- not a CSPRNG, so
// the sequence is predictable from observed values -- stored in plaintext, keyed
// only by email, with no expiry, no attempt counter and no consumption on use.
// A code therefore stayed valid forever and could be brute-forced offline-fast
// against a live endpoint, and AuthLoginAsMail trades a matching code for a
// master-key loginAs session.
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

// 6 digits from a CSPRNG, rejection-sampled so every value is equally likely.
export function generateOtpCode() {
  const RANGE = 900000; // 100000..999999
  const LIMIT = Math.floor(0xffffffff / RANGE) * RANGE;
  let n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= LIMIT);
  return String(100000 + (n % RANGE));
}

// Store only a salted hash: a database read must not yield a usable code.
export function hashOtp(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
async function getDocument(docId) {
  try {
    const query = new Parse.Query('contracts_Document');
    query.equalTo('objectId', docId);
    query.include('ExtUserPtr');
    query.include('CreatedBy');
    query.include('Signers');
    query.include('AuditTrail.UserPtr');
    query.include('ExtUserPtr.TenantId');
    query.include('Placeholders');
    query.notEqualTo('IsArchive', true);
    const res = await query.first({ useMasterKey: true });
    const _res = res?.toJSON();
    return _res?.ExtUserPtr?.objectId;
  } catch (err) {
    console.log('err ', err);
  }
}
async function sendMailOTPv1(request) {
  try {
    const code = generateOtpCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOtp(code, salt);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    let email = request.params.email;
    let TenantId = request.params.TenantId ? request.params.TenantId : undefined;
    const AppName = appName;

    if (email) {
      const recipient = request.params.email;
      const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
      try {
        await Parse.Cloud.sendEmail({
          sender: AppName + ' <' + mailsender + '>',
          recipient: recipient,
          subject: `Your ${AppName} OTP`,
          text: 'otp email',
          html:
            `<html><head><meta http-equiv='Content-Type' content='text/html;charset=UTF-8' /></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white;'><div style='background-color:red;padding:2px;font-family:system-ui;background-color:#47a3ad;'><p style='font-size:20px;font-weight:400;color:white;padding-left:20px;'>OTP Verification</p></div><div style='padding:20px;'><p style='font-family:system-ui;font-size:14px;'>Your OTP for ${AppName} verification is:</p><p style='text-decoration:none;font-weight:bolder;color:blue;font-size:45px;margin:20px;'>` +
            code +
            '</p></div></div></div></body></html>',
        });
        console.log('OTP sent to', recipient);
        if (request.params?.docId) {
          const extUserId = await getDocument(request.params?.docId);
          if (extUserId) {
            updateMailCount(extUserId);
          }
        }
      } catch (err) {
        console.log('error in send OTP mail', err);
      }
      const tempOtp = new Parse.Query('defaultdata_Otp');
      tempOtp.equalTo('Email', email);
      const resultOTP = await tempOtp.first({ useMasterKey: true });
      // console.log('resultOTP', resultOTP);
      // Store the hash, never the code. Reset the attempt counter and set a
      // fresh expiry on every issue, and clear any legacy plaintext OTP column.
      if (resultOTP !== undefined) {
        const updateOtpQuery = new Parse.Query('defaultdata_Otp');
        const updateOtp = await updateOtpQuery.get(resultOTP.id, {
          useMasterKey: true,
        });
        updateOtp.set('OtpHash', otpHash);
        updateOtp.set('OtpSalt', salt);
        updateOtp.set('ExpiresAt', expiresAt);
        updateOtp.set('Attempts', 0);
        // Only unset the legacy plaintext column if this row has one: Parse adds
        // columns lazily, so unsetting a column that was never created fails the
        // whole save with `column "OTP" ... does not exist`.
        if (updateOtp.get('OTP') !== undefined) {
          updateOtp.unset('OTP');
        }
        await updateOtp.save(null, { useMasterKey: true });
      } else {
        const otpClass = Parse.Object.extend('defaultdata_Otp');
        const newOtpQuery = new otpClass();
        newOtpQuery.set('OtpHash', otpHash);
        newOtpQuery.set('OtpSalt', salt);
        newOtpQuery.set('ExpiresAt', expiresAt);
        newOtpQuery.set('Attempts', 0);
        newOtpQuery.set('Email', email);
        newOtpQuery.set('TenantId', TenantId);
        await newOtpQuery.save(null, { useMasterKey: true });
      }
      return 'Otp send';
    } else {
      return 'Please Enter valid email';
    }
  } catch (err) {
    console.log('err in sendMailOTPv1');
    console.log(err);
    return err;
  }
}
export default sendMailOTPv1;
