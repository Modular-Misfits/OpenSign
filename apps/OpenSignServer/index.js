import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import express from 'express';
import cors from 'cors';
import { ParseServer } from 'parse-server';
import path from 'path';
const __dirname = path.resolve();
import http from 'http';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { ApiPayloadConverter } from 'parse-server-api-mail-adapter';
import S3Adapter from '@parse/s3-files-adapter';
import FSFilesAdapter from '@parse/fs-files-adapter';
import { app as customRoute } from './cloud/customRoute/customApp.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTransport } from 'nodemailer';
import { appName, cloudServerUrl, serverAppId, smtpenable, smtpsecure, useLocal } from './Utils.js';
import { SSOAuth } from './auth/authadapter.js';
import runDbMigrations from './migrationdb/index.js';
import { validateSignedLocalUrl } from './cloud/parsefunction/getSignedUrl.js';
let fsAdapter;
const execFileAsync = promisify(execFile);
let isReady = false;

function configuredOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.PUBLIC_URL || '';
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => new URL(value).origin);
}

function corsOptions() {
  const allowed = new Set(configuredOrigins());
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed'));
    },
    credentials: true,
  };
}

function postgresDatabaseUri() {
  const value = process.env.DATABASE_URI;
  if (!value?.startsWith('postgres')) {
    throw new Error('DATABASE_URI must be a PostgreSQL connection string');
  }
  return value;
}

if (useLocal !== 'true') {
  try {
    // const spacesEndpoint = new AWS.Endpoint(process.env.DO_ENDPOINT);
    const spacesEndpoint = process.env.DO_ENDPOINT?.includes('http')
      ? process.env.DO_ENDPOINT
      : `https://${process.env.DO_ENDPOINT}`; //"e.g https://blr1.digitaloceanspaces.com"
    const s3Options = {
      bucket: process.env.DO_SPACE,
      baseUrl: process.env.DO_BASEURL,
      fileAcl: 'none',
      region: process.env.DO_REGION,
      directAccess: true,
      preserveFileName: true,
      presignedUrl: true,
      presignedUrlExpires: 900,
      s3overrides: {
        credentials: {
          accessKeyId: process.env.DO_ACCESS_KEY_ID,
          secretAccessKey: process.env.DO_SECRET_ACCESS_KEY,
        },
        endpoint: spacesEndpoint,
        signatureVersion: 'v4',
      },
    };
    fsAdapter = new S3Adapter(s3Options);
  } catch {
    console.log('Please provide AWS credintials in env file! Defaulting to local storage.');
    fsAdapter = new FSFilesAdapter({
      filesSubDirectory: 'files', // optional, defaults to ./files
    });
  }
} else {
  fsAdapter = new FSFilesAdapter({
    filesSubDirectory: 'files', // optional, defaults to ./files
  });
}

let transporterMail;
let mailgunClient;
let mailgunDomain;
let isMailAdapter = false;
if (smtpenable) {
  try {
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
    transporterMail = createTransport(transporterConfig);
    await transporterMail.verify();
    isMailAdapter = true;
  } catch (err) {
    isMailAdapter = false;
    console.log(`Please provide valid SMTP credentials: ${err}`);
  }
} else if (process.env.MAILGUN_API_KEY) {
  try {
    const mailgun = new Mailgun(formData);
    mailgunClient = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
    });
    mailgunDomain = process.env.MAILGUN_DOMAIN;
    isMailAdapter = true;
  } catch {
    isMailAdapter = false;
    console.log('Please provide valid Mailgun credentials');
  }
}
const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
export const config = {
  databaseURI: postgresDatabaseUri(),
  cloud: function () {
    import('./cloud/main.js');
  },
  appId: serverAppId,
  logLevel: ['error'],
  maxLimit: 500,
  maxUploadSize: '100mb',
  masterKey: process.env.MASTER_KEY, //Add your master key here. Keep it secret!
  masterKeyIps: (process.env.MASTER_KEY_IPS || '127.0.0.1/32,::1/128')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  serverURL: cloudServerUrl, // Don't forget to change to https if needed
  verifyUserEmails: false,
  publicServerURL: process.env.SERVER_URL || cloudServerUrl,
  // Your apps name. This will appear in the subject and body of the emails that are sent.
  appName: appName,
  allowClientClassCreation: false,
  allowExpiredAuthDataToken: false,
  enableInsecureAuthAdapters: false,
  databaseOptions: { allowPublicExplain: false },
  encodeParseObjectInCloudFunction: true,
  ...(isMailAdapter === true
    ? {
      emailAdapter: {
        module: 'parse-server-api-mail-adapter',
        options: {
          // The email address from which emails are sent.
          sender: appName + ' <' + mailsender + '>',
          // The email templates.
          templates: {
            // The template used by Parse Server to send an email for password
            // reset; this is a reserved template name.
            passwordResetEmail: {
              subjectPath: './files/password_reset_email_subject.txt',
              textPath: './files/password_reset_email.txt',
              htmlPath: './files/password_reset_email.html',
            },
            // The template used by Parse Server to send an email for email
            // address verification; this is a reserved template name.
            verificationEmail: {
              subjectPath: './files/verification_email_subject.txt',
              textPath: './files/verification_email.txt',
              htmlPath: './files/verification_email.html',
            },
          },
          apiCallback: async ({ payload }) => {
            if (mailgunClient) {
              const mailgunPayload = ApiPayloadConverter.mailgun(payload);
              await mailgunClient.messages.create(mailgunDomain, mailgunPayload);
            } else if (transporterMail) await transporterMail.sendMail(payload);
          },
        },
      },
    }
    : {}),
  filesAdapter: fsAdapter,
  auth: { google: { clientId: process.env.GOOGLE_CLIENT_ID }, sso: SSOAuth },
  // for fix Adapter prototype don't match expected prototype
  push: { queueOptions: { disablePushWorker: true } },
};
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

export const app = express();
app.disable('x-powered-by');
app.use(cors(corsOptions()));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(function (req, res, next) {
  req.headers['x-real-ip'] = getUserIP(req);
  const publicUrl = 'https://' + req?.get('host');
  req.headers['public_url'] = publicUrl;
  next();
});
function getUserIP(request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    if (forwardedFor.indexOf(',') > -1) {
      return forwardedFor.split(',')[0];
    } else {
      return forwardedFor;
    }
  } else {
    return request.socket.remoteAddress;
  }
}

app.use(async function (req, res, next) {
  const isFilePath = req.path?.includes('/files/') || false;
  if (isFilePath && req.method.toLowerCase() === 'get') {
    const serverUrl = new URL(process.env.SERVER_URL);
    const origin = serverUrl.pathname === '/api/app' ? serverUrl.origin + '/api' : serverUrl.origin;
    const fileUrl = origin + req.originalUrl;
    const params = fileUrl?.split('?')?.[1];
    if (params) {
      const fileRes = await validateSignedLocalUrl(fileUrl);
      if (fileRes === 'Unauthorized') {
        return res.status(400).json({ message: 'unauthorized' });
      }
    } else {
      return res.status(400).json({ message: 'unauthorized' });
    }
    next();
  } else {
    next();
  }
});

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
if (!process.env.TESTING) {
  const mountPath = process.env.PARSE_MOUNT || '/app';
  try {
    const server = new ParseServer(config);
    await server.start();
    app.use(mountPath, server.app);
  } catch (err) {
    console.log(err);
    process.exit();
  }
}
// Mount your custom express app
app.use('/', customRoute);

app.get('/healthz', function (_req, res) {
  res.status(isReady ? 200 : 503).json({ status: isReady ? 'ready' : 'starting' });
});

// Parse Server plays nicely with the rest of your web routes
app.get('/', function (req, res) {
  res.status(200).send('opensign-server is running !!!');
});

if (!process.env.TESTING) {
  const port = process.env.PORT || 8080;
  const httpServer = http.createServer(app);
  // Set the Keep-Alive and headers timeout to 100 seconds
  httpServer.keepAliveTimeout = 100000; // in milliseconds
  httpServer.headersTimeout = 100000; // in milliseconds
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', resolve);
  });
  console.log('opensign-server running on port ' + port + '.');
  try {
    const executable = path.join(__dirname, 'node_modules', '.bin', 'parse-dbtool');
    const { stdout, stderr } = await execFileAsync(executable, ['migrate'], {
      env: {
        ...process.env,
        APPLICATION_ID: serverAppId,
        SERVER_URL: cloudServerUrl,
        MASTER_KEY: process.env.MASTER_KEY,
      },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.warn(stderr.trim());
    await runDbMigrations();
    isReady = true;
    console.log('opensign-server database migrations completed.');
  } catch (error) {
    console.error('OpenSign startup migration failed:', error);
    await new Promise(resolve => httpServer.close(resolve));
    process.exit(1);
  }
}
