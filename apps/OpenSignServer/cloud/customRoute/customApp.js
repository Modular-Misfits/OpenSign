import express from 'express';
import dotenv from 'dotenv';

import docxtopdf, { upload as docxUpload } from './docxtopdf.js';
import decryptpdf, { upload as decryptUpload } from './decryptpdf.js';
import { deleteUserByAdmin, deleteUserPost } from './deleteAccount/deleteUser.js';
import { deleteUserGet } from './deleteAccount/deleteUserGet.js';
import { deleteUserOtp } from './deleteAccount/deleteUserOtp.js';
import { mountPortalNdaRoutes } from './portalNda.js';
import { mountPortalTelnyxFailoverRoutes } from './portalTelnyxFailover.js';

export const app = express();

dotenv.config({ quiet: true });
app.use(
  '/portal/nda/webhooks/telnyx/failover',
  express.raw({ type: 'application/json', limit: '128kb' })
);
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.post('/docxtopdf', docxUpload.single('file'), docxtopdf);
app.post('/decryptpdf', decryptUpload.single('file'), decryptpdf);
app.get('/delete-account/:userId', deleteUserGet);
app.post('/delete-account/:userId/otp', deleteUserOtp);
app.post('/delete-account/:userId', deleteUserPost);
app.post('/deleteuser/:userId', deleteUserByAdmin);
mountPortalNdaRoutes(app);
mountPortalTelnyxFailoverRoutes(app);
