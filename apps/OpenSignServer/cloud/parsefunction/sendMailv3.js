import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { appName, smtpenable, smtpsecure, updateMailCount } from '../../Utils.js';
import { createTransport } from 'nodemailer';
import { deliverPortalSystemEmail } from '../portal/portalWebhook.js';
import { capabilityRequired, mintCapability } from './docCapability.js';
import { buildMailContent } from '../portal/mailContent.js';
async function sendMailProvider(req) {
  const app = appName;
  const extUserId = req.params?.extUserId || '';
  const reportMsg = `<p style="font-size: 13px; color:grey; text-align: center;">If you think this email is inappropriate or spam, you may file a complaint with OpenSign™ <a href="mailto:complaints@opensignlabs.com?subject=Spam%20report%20for%20user%20ID%20${extUserId}&body=Hello%20Support%20Team%2C%0D%0A%0D%0AI%E2%80%99m%20reporting%20spam%20activity%20coming%20from%20a%20sender%20using%20your%20platform.%0D%0A%0D%0AThe%20messages%20I%20received%20appear%20unsolicited%20and%20suspicious.%20The%20user%20ID%20associated%20with%20the%20emails%20is%3A%20${extUserId}.%20Please%20investigate%20this%20account%20and%20take%20appropriate%20action%20to%20prevent%20further%20abuse.%0D%0A%0D%0AIf%20you%20need%20additional%20details%2C%20I%E2%80%99m%20happy%20to%20provide%20the%20original%20email%20headers%20or%20screenshots.%0D%0A%0D%0AThank%20you%20for%20looking%20into%20this.%0D%0A%0D%0ABest%20regards%2C%0D%0A%5BYour%20Name%5D">here</a>.</p>`;

  const mailgunApiKey = process.env.MAILGUN_API_KEY;
  let transporterSMTP;
  try {
    let mailgunClient;
    let mailgunDomain;
    if (smtpenable) {
      const transporterConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 465,
        secure: smtpsecure,
      };

      // ✅ Add auth only if BOTH username & password exist
      const smtpUser = process.env.SMTP_USERNAME;
      const smtpPass = process.env.SMTP_PASS;

      if (smtpUser && smtpPass) {
        transporterConfig.auth = {
          user: process.env.SMTP_USERNAME ? process.env.SMTP_USERNAME : process.env.SMTP_USER_EMAIL,
          pass: smtpPass,
        };
      }
      transporterSMTP = createTransport(transporterConfig);
    } else {
      if (mailgunApiKey) {
        const mailgun = new Mailgun(formData);
        mailgunClient = mailgun.client({ username: 'api', key: mailgunApiKey });
        mailgunDomain = process.env.MAILGUN_DOMAIN;
      }
    }

    const from = req.params.from || '';
    const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
    const replyto = req.params?.replyto || '';
    const portalMode = Boolean(process.env.PORTAL_WEBHOOK_URL && process.env.PORTAL_WEBHOOK_SECRET);
    const content = buildMailContent({
      html: req.params?.html,
      portalMode,
      reportHtml: reportMsg,
      subject: req.params.subject,
      text: req.params.text,
    });
    const messageParams = {
      from: from + ' <' + mailsender + '>',
      to: req.params.recipient,
      subject: req.params.subject,
      text: content.text,
      html: content.html,
      bcc: req.params.bcc ? req.params.bcc : undefined,
      cc: req.params.cc ? req.params.cc : undefined,
      replyTo: replyto ? replyto : undefined,
    };

    // Sequential signer invitations are sent through sendmailv3. Route them
    // through the same signed Cloudflare Worker relay as the initial invitation
    // so they do not fall back to the Lightsail host's location-restricted SMTP.
    if (portalMode) {
      await deliverPortalSystemEmail({
        recipient: req.params.recipient,
        subject: req.params.subject,
        text: messageParams.text,
        html: messageParams.html,
        replyTo: messageParams.replyTo,
        fromName: from || app,
      });
      console.log('portal email relay accepted');
      if (extUserId) {
        await updateMailCount(extUserId);
      }
      return { status: 'success' };
    }

    if (transporterSMTP) {
      const res = await transporterSMTP.sendMail(messageParams);
      console.log('smtp transporter res: ', res?.response);
      if (!res.err) {
        if (extUserId) {
          await updateMailCount(extUserId);
        }
        return { status: 'success' };
      }
    } else {
      if (mailgunApiKey) {
        const res = await mailgunClient.messages.create(mailgunDomain, messageParams);
        console.log('mailgun res: ', res?.status);
        if (res.status === 200) {
          if (extUserId) {
            await updateMailCount(extUserId);
          }
          return { status: 'success' };
        }
      } else {
        return { status: 'error' };
      }
    }
  } catch (err) {
    console.log(`sendmailv3 Error: ${err}`);
    if (err) {
      return { status: 'error' };
    }
  } finally {
    if (transporterSMTP) {
      transporterSMTP?.close?.();
    }
  }
}


/**
 * Is `recipient` an address this mail is legitimately allowed to reach?
 *
 * SECURITY (MM-07). sendmailv3 took recipient, subject, html, cc and bcc from an
 * unauthenticated caller and sent branded mail from the deployment's own domain
 * and SMTP identity. That is an open relay: anyone could send convincing
 * phishing "from" this tenant, to anyone.
 *
 * It cannot simply require a session. After a guest signs, the guest's own
 * browser calls sendmailv3 to notify the NEXT signer, with no session at all
 * (apps/OpenSign/src/pages/PdfRequestFiles.jsx). Blocking sessionless callers
 * silently breaks sequential signing — the signature lands and the next signer is
 * never told.
 *
 * What every legitimate call does have is an `extUserId` (the sending
 * contracts_Users owner) and a `recipient` that already appears on that owner's
 * documents. So scope delivery to addresses the owner is already corresponding
 * with: their own address, anyone on their documents' Placeholders, and their
 * contacts. An attacker can then only mail people the tenant already mails,
 * which removes the arbitrary-recipient primitive without touching the client.
 */
async function recipientAllowedForOwner(recipient, extUserId) {
  const email = String(recipient || '')
    .toLowerCase()
    .trim();
  if (!email || !extUserId) return false;

  const owner = await new Parse.Query('contracts_Users')
    .equalTo('objectId', extUserId)
    .first({ useMasterKey: true });
  if (!owner) return false;

  // 1. the owner themselves (completion notices, decline notices)
  if (String(owner.get('Email') || '').toLowerCase() === email) return true;

  // 2. anyone placed on one of the owner's own documents
  const docs = await new Parse.Query('contracts_Document')
    .equalTo('ExtUserPtr', {
      __type: 'Pointer',
      className: 'contracts_Users',
      objectId: extUserId,
    })
    .select(['Placeholders'])
    .limit(1000)
    .find({ useMasterKey: true });
  for (const doc of docs) {
    const placeholders = doc.get('Placeholders') || [];
    if (
      Array.isArray(placeholders) &&
      placeholders.some(ph => String(ph?.email || '').toLowerCase() === email)
    ) {
      return true;
    }
  }

  // 3. the owner's own contacts
  const contact = await new Parse.Query('contracts_Contactbook')
    .equalTo('Email', email)
    .notEqualTo('IsDeleted', true)
    .first({ useMasterKey: true });
  if (contact) return true;

  return false;
}

/**
 * Add a capability token to any /login/<base64> signing links in the mail body.
 *
 * The guest who signs cannot mint a token — minting requires a session — yet
 * their browser is what notifies the next signer. Rather than leave that link
 * tokenless (and therefore broken once enforcement is on), the server mints it
 * here, where the document and signer are already known and the master key is
 * available. Links that already carry a token are left alone.
 */
function addCapabilityToLinks(html, docId) {
  if (!html || !docId) return html;
  // The lookahead must sit after the FULL base64 run, and `=` is both a base64
  // pad character and part of `?t=`, so a naive negative lookahead still matches
  // a shorter prefix and double-appends on a resend. Match the optional existing
  // query explicitly and skip links that already carry a token.
  return String(html).replace(/(\/login\/[A-Za-z0-9+/=_-]+)(\?t=[^"'\s>&]*)?/g, (match, link, existing) => {
    if (existing) return match;
    try {
      // The base64 payload is `${docId}/${email}/${contactId}` — recover the
      // contact so the token binds to this specific signer where possible.
      const decoded = Buffer.from(link.split('/login/')[1], 'base64').toString('utf8');
      const parts = decoded.split('/');
      const contactId = parts.length >= 3 ? parts[2] : '';
      return `${link}?t=${encodeURIComponent(mintCapability(docId, contactId))}`;
    } catch {
      return `${link}?t=${encodeURIComponent(mintCapability(docId, ''))}`;
    }
  });
}

async function sendmailv3(req) {
  // An authenticated caller is the tenant acting on its own behalf and keeps the
  // existing behaviour. Everything else must be a mail this owner could already
  // legitimately send.
  if (!req?.user) {
    const allowed = await recipientAllowedForOwner(req.params?.recipient, req.params?.extUserId);
    if (!allowed) {
      console.log('sendmailv3 refused: recipient not associated with this sender');
      return { status: 'error' };
    }
    // cc/bcc are attacker-controlled fan-out and no unauthenticated caller needs
    // them: the guest next-signer notification sets neither.
    if (req.params?.cc || req.params?.bcc) {
      console.log('sendmailv3 refused: cc/bcc not permitted without a session');
      return { status: 'error' };
    }
  }
  // Mint capability tokens into signing links when enforcement is on, so mails
  // sent on behalf of a sessionless guest still produce usable links.
  if (capabilityRequired() && req.params?.docId && req.params?.html) {
    req.params.html = addCapabilityToLinks(req.params.html, req.params.docId);
  }
  const nonCustomMail = await sendMailProvider(req);
  return nonCustomMail;
}

export default sendmailv3;
