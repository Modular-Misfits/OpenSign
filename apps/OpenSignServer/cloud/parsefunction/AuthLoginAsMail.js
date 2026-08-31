import axios from 'axios';
import crypto from 'node:crypto';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { OTP_MAX_ATTEMPTS, hashOtp } from './SendMailOTPv1.js';

// Compare in constant time so a wrong code cannot be narrowed by timing.
function sameHash(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length || A.length === 0) return false;
  return crypto.timingSafeEqual(A, B);
}
async function AuthLoginAsMail(request) {
  try {
    //function for login user using user objectId without touching user's password
    const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
    const APPID = serverAppId;
    const masterKEY = process.env.MASTER_KEY;

    const otpN = request.params.otp;
    const email = request.params.email;

    let message;
    //checking otp is correct or not which already save in defaultdata_Otp class
    const checkOtp = new Parse.Query('defaultdata_Otp');
    checkOtp.equalTo('Email', email);
    const res = await checkOtp.first({ useMasterKey: true });

    if (res !== undefined) {
      // SECURITY (MM-07). This exchanges a matching OTP for a master-key loginAs
      // session, so it is an authentication endpoint and must behave like one:
      // codes expire, wrong guesses are counted and eventually lock the code out,
      // and a code is consumed the moment it succeeds. Without these, a 4-digit
      // code with unlimited attempts was a passwordless account takeover.
      const attempts = res.get('Attempts') || 0;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        console.log('OTP rejected: attempt limit reached for', email);
        return 'Invalid Otp';
      }

      const expiresAt = res.get('ExpiresAt');
      if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
        console.log('OTP rejected: expired or missing expiry for', email);
        return 'Invalid Otp';
      }

      const storedHash = res.get('OtpHash');
      const salt = res.get('OtpSalt');
      // A row with no hash predates this fix (or was written by an older
      // server). Refuse it rather than falling back to the plaintext column.
      if (!storedHash || !salt) {
        console.log('OTP rejected: no hashed code stored for', email);
        return 'Invalid Otp';
      }

      const supplied = String(otpN ?? '').trim();
      const ok = supplied.length > 0 && sameHash(storedHash, hashOtp(supplied, salt));

      if (!ok) {
        res.increment('Attempts');
        await res.save(null, { useMasterKey: true });
        return 'Invalid Otp';
      }

      // Correct: consume the code immediately so it cannot be replayed.
      res.unset('OtpHash');
      res.unset('OtpSalt');
      res.unset('OTP');
      res.set('Attempts', 0);
      res.set('ExpiresAt', new Date(0));
      await res.save(null, { useMasterKey: true });

      {
        var result = await getToken(request);
        if (result && !result?.emailVerified) {
          const userQuery = new Parse.Query(Parse.User);
          const user = await userQuery.get(result?.objectId, {
            sessionToken: result.sessionToken,
          });
          // Update the emailVerified field to true
          user.set('emailVerified', true);
          // Save the user object
          const res = await user.save(null, { useMasterKey: true });
          if (res) {
            return result;
          } else {
            reject('user not found!');
          }
        } else {
          return result;
        }

        async function getToken(request) {
          return new Promise(function (resolve, reject) {
            var query = new Parse.Query(Parse.User);
            query.equalTo('email', email);
            query
              .first({ useMasterKey: true })
              .then(user => {
                //call loginAs function to use login method passing user objectId as a userId

                const url = `${serverUrl}/loginAs`;
                axios({
                  method: 'POST',
                  url: url,
                  headers: {
                    'Content-Type': 'application/json;charset=utf-8',
                    'X-Parse-Application-Id': APPID,
                    'X-Parse-Master-Key': masterKEY,
                  },
                  params: {
                    userId: user.id,
                  },
                })
                  .then(function (res) {
                    // console.log(res.data)
                    if (res.data) {
                      resolve(res.data);
                    } else {
                      reject('user not found!');
                    }
                  })
                  .catch(err => {
                    reject('user not found!');
                  });

                // user couldn't find lets sign up!
              })
              .catch(() => {
                reject('user not found!');
              });
          });
        }
      }
    } else {
      message = 'user not found!';
      return message;
    }
  } catch (err) {
    console.log('err in Auth');
    console.log(err);
    return 'Result not found';
  }
}
export default AuthLoginAsMail;
