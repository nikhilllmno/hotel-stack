import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import {
  businessEntsMatchHotelId,
  hotelIdFromBusinessEnts,
} from '../auth/auth-core/core-business-ents';
import { coreClaimsIncludeAdmin } from '../auth/auth-core/core-permissions';
import {
  routeUsesAuthCore,
  routeUsesTokenScopedHotelAuth,
} from '../auth/auth-core/route-uses-auth-core';
import { validateCoreJwt } from '../auth/auth-core/validate-core-jwt';
import config from '../config';
import { UserRole } from '../models/User';
import { userService } from '../services/user/userService';
import { AuthenticatedRequest } from '../types/customRequest';
import { HttpMethod } from '../types/enums';
import { getPublicKey } from '../utils/jwtIssuer';
import { KpiStat, logKpi } from '../utils/kpiLogger';
import logger from '../utils/logger';

export const authMiddleware: RequestHandler = async (req, res, next) => {
  const excludedPaths = [{ method: HttpMethod.POST, path: '/auth/login' }];

  const shouldSkip = excludedPaths.some(
    (route) =>
      req.method === route.method && req.originalUrl.startsWith(route.path),
  );

  // Skip authentication for excluded paths
  if (shouldSkip) return next();

  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (token == null || token.trim() === '') {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  // Auth-core path: for onboarded routes:
  // - permissions includes "admin" → SUPERADMIN (system admin), or
  // - businessEnts matches hotel id in the URL → ADMIN, or
  // - token-scoped routes: first Daisy hotel id from businessEnts → ADMIN;
  // otherwise fall through to standard Daisy JWT below.
  try {
    const route = { path: req.path, originalUrl: req.originalUrl };
    const usesAuthCore = routeUsesAuthCore({ method: req.method, ...route });
    logger.warn('authMiddleware: auth-core route check', {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      usesAuthCore,
      token,
    });

    if (usesAuthCore) {
      const coreAuth = await validateCoreJwt(token);
      if (coreAuth.ok) {
        if (coreClaimsIncludeAdmin(coreAuth.claims)) {
          const scopedHotelId = routeUsesTokenScopedHotelAuth(route)
            ? hotelIdFromBusinessEnts(coreAuth.claims)
            : undefined;
          logger.warn('authMiddleware: auth-core accepted as system admin', {
            email: coreAuth.email,
            path: req.path,
            originalUrl: req.originalUrl,
            hotelId: scopedHotelId,
          });
          (req as AuthenticatedRequest).user = {
            id: coreAuth.email,
            username: coreAuth.email,
            role: UserRole.SUPERADMIN,
            ...(scopedHotelId != null ? { hotel_id: scopedHotelId } : {}),
          };
          logKpi({
            stat: KpiStat.AuthCoreAccepted,
            value: 1,
            contextName: req.path,
            clientId: scopedHotelId ?? undefined,
          });
          next();
          return;
        }

        const hotelId =
          businessEntsMatchHotelId(coreAuth.claims, route) ??
          (routeUsesTokenScopedHotelAuth(route)
            ? hotelIdFromBusinessEnts(coreAuth.claims)
            : null);
        if (hotelId != null) {
          logger.warn('authMiddleware: auth-core accepted', {
            email: coreAuth.email,
            hotelId,
            path: req.path,
            originalUrl: req.originalUrl,
          });
          (req as AuthenticatedRequest).user = {
            id: coreAuth.email,
            username: coreAuth.email,
            role: UserRole.ADMIN,
            hotel_id: hotelId,
          };
          logKpi({
            stat: KpiStat.AuthCoreAccepted,
            value: 1,
            contextName: req.path,
            clientId: hotelId,
          });
          next();
          return;
        }
        logger.warn(
          'authMiddleware: auth-core JWT valid but neither admin permission nor businessEnts hotel match; falling back to Daisy JWT',
          {
            email: coreAuth.email,
            path: req.path,
            originalUrl: req.originalUrl,
            businessEnts: coreAuth.claims.businessEnts,
            permissions: coreAuth.claims.permissions,
            claimKeys: Object.keys(coreAuth.claims),
            token,
          },
        );
      } else {
        logger.warn(
          'authMiddleware: auth-core JWT validation failed; falling back to Daisy JWT',
          {
            error: coreAuth.error,
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl,
            token,
          },
        );
      }
    }
  } catch (error) {
    logger.error(
      `authMiddleware: auth-core validation exception, falling back to Daisy JWT: ${error}`,
      { token },
    );
  }

  try {
    const complete = jwt.decode(token, { complete: true });
    if (!complete || typeof complete === 'string') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const alg = complete.header.alg;
    let decoded: {
      id: string;
      username: string;
      role: UserRole;
      hotel_id?: string;
    };

    if (alg === 'RS256') {
      const publicKey = getPublicKey();
      if (!publicKey) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: config.JWT_ISS,
        audience: config.JWT_AUDIENCE,
      }) as typeof decoded;
    } else if (alg === 'HS256') {
      if (!config.JWT_SECRET) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      decoded = jwt.verify(token, config.JWT_SECRET) as typeof decoded;
    } else {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = await userService.getUserById(decoded.id);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    if (user.role !== decoded.role) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    // Superadmin can access any hotel. Non-superadmin users can only access their own hotel.
    if (
      user.role !== UserRole.SUPERADMIN &&
      (!user.hotel_id || user.hotel_id !== decoded.hotel_id)
    ) {
      res.status(403).json({
        error: `The user is not authorized to perform operations for the given hotel`,
      });
      return;
    }

    (req as AuthenticatedRequest).user = decoded;
    logKpi({
      stat: KpiStat.AuthNativeAccepted,
      value: 1,
      contextName: req.path,
      clientId: decoded.hotel_id,
    });
    next();
  } catch (_err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
};
