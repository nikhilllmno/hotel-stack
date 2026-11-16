/**
 * Central router for the application
 */

import { Router } from 'express';
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
import { authMiddleware } from '../middleware/authMiddleware';
import alfredRouter from './alfredRouter';
import coreRouter from './api/coreRoutes';
import emailRouter from './api/emailRouter';
import pmsProviderRouter from './api/pmsProviderRouter';
import authRouter from './authRouter';
import { conversationRouter } from './conversationRouter';
import debugRouter from './debugRouter';
import escalationRouter from './escalationRoute';
import internalRouter from './internalRouter';
import logsRouter from './logsRouter';
import notificationRouter from './notification';
import oauthRouter from './oauthRouter';
import remoteLockOAuthRouter from './remoteLockOAuthRouter';
import roomReservationRouter from './roomReservationRouter';
import scheduledJobsRouter from './scheduledJobsRouter';
import sessionRouter from './sessionRouter';
import shift4Router from './shift4Router';
import uploadRouter from './uploadRouter';
import userRouter from './userRoute';
import vapiOutboundRouter from './vapiOutboundRouter';
import webhookRouter from './webhookRoutes';
import pmsWebhookRouter from './webhooksRoutes';
import webRoomReservationRouter from './webRoomReservationRouter';
import wellKnownRouter from './wellKnownRouter';
const router = Router();

//------------------------------------------------------------------------------------
// Public-facing routes (should NOT be authenticated)

router.use('/.well-known', wellKnownRouter);

router.use('/oauth', oauthRouter);

router.use('/webhook', webhookRouter);

router.use('/webhooks', pmsWebhookRouter);

router.use('/remotelock/oauth', remoteLockOAuthRouter);

// Used by the frontend to pass certain logs to the backend.
router.use('/logs', logsRouter);

// These come from website bookings for hotels where we handle the website (such as The Kern Lodge, The Henderson). Shouldn't be authenticated.
router.use('/book', webRoomReservationRouter);

//------------------------------------------------------------------------------------

//------------------------------------------------------------------------------------
// The routes under this section require x-api-key header (apiKeyMiddleware) authentication in some or all of the subroutes

// This is invoked from the Dextr frontend (public-facing APIs - booking review page for instance), voice agents (Vapi), text agents (dextr-support-ops-svc), Alfred, and lambdas. Everything except the public-facing APIs should be authenticated using the apiKeyMiddleware.
router.use('/daisy', roomReservationRouter);

// Vapi REST helpers
router.use('/vapi', apiKeyMiddleware, vapiOutboundRouter);

// Access Alfred endpoints from Daisy
router.use('/alfred', apiKeyMiddleware, alfredRouter);

// Currently used to generate a Shift4 access token
router.use('/shift4', apiKeyMiddleware, shift4Router);

// Scheduled job endpoints — invokable from AWS Lambda.
router.use('/jobs', apiKeyMiddleware, scheduledJobsRouter);

router.use('/sessions', sessionRouter);

router.use('/email', apiKeyMiddleware, emailRouter);

router.use('/internal', apiKeyMiddleware, internalRouter);

router.use('/debug', apiKeyMiddleware, debugRouter);

router.use('/pms-providers', apiKeyMiddleware, pmsProviderRouter);

router.use('/uploads', apiKeyMiddleware, uploadRouter);

router.use('/notifications', apiKeyMiddleware, notificationRouter);

router.use('/conversations', apiKeyMiddleware, conversationRouter);

router.use('/escalations', apiKeyMiddleware, escalationRouter);

//------------------------------------------------------------------------------------

//------------------------------------------------------------------------------------
// Protected routes (require JWT authentication, aka authMiddleware)
router.use('/api', authMiddleware, coreRouter);
router.use('/user', authMiddleware, userRouter);
router.use('/auth', authMiddleware, authRouter);
//------------------------------------------------------------------------------------

export default router;
