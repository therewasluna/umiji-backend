import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { getQuery } from 'ufo';

import { Logger } from '@nestjs/common';

import { RawCacheService } from '@common/raw-cache';
import { isDevelopment } from '@common/utils/startup-app';
import { BACKEND_TOOLS_ROOT, ROOT } from '@libs/contracts/api';
import {
    BACKEND_TOOLS_AUTH_COOKIE_NAME,
    BACKEND_TOOLS_JWT_ISSUER,
    BACKEND_TOOLS_JWT_LIFETIME_HOURS,
    BACKEND_TOOLS_JWT_SCOPES,
    ERRORS,
    TBackendToolsJwtScope,
} from '@libs/contracts/constants';

const logger = new Logger('ToolsAuth');

export function toolsAuthMiddleware(appSecret: string, rawCacheService: RawCacheService) {
    return async (req: Request, res: Response, next: NextFunction) => {
        let hasOtt = false;
        try {
            const { ott } = getQuery(req.originalUrl);
            hasOtt = ott !== undefined;
            const payload =
                typeof ott === 'string' && ott.length > 0
                    ? verifyJwt(ott, appSecret, BACKEND_TOOLS_JWT_SCOPES.OTT)
                    : null;

            if (payload?.jti) {
                if (
                    (await rawCacheService.getDelString(`backend-tools:ott:${payload.jti}`)) === '1'
                ) {
                    const token = signJwt(appSecret);

                    res.cookie(BACKEND_TOOLS_AUTH_COOKIE_NAME, token, {
                        httpOnly: true,
                        secure: !isDevelopment(),
                        sameSite: 'lax',
                        path: `${ROOT}${BACKEND_TOOLS_ROOT}`,
                        maxAge: BACKEND_TOOLS_JWT_LIFETIME_HOURS * 3_600_000,
                    });

                    logger.warn(`Tools access granted. Path: ${req.baseUrl}${req.path}.`);

                    const redirectUrl = new URL(req.originalUrl, 'http://localhost');
                    redirectUrl.searchParams.delete('ott');
                    res.redirect(redirectUrl.pathname + redirectUrl.search);

                    return;
                }

                return rejectToolsRequest(req, res);
            }

            if (!hasValidCookie(req, appSecret)) {
                return rejectToolsRequest(req, res);
            }

            return next();
        } catch (error) {
            if (hasOtt) return rejectToolsRequest(req, res);
            next(error);
        }
    };
}

function rejectToolsRequest(req: Request, res: Response): void {
    res.status(ERRORS.FORBIDDEN.httpCode).json({
        timestamp: new Date().toISOString(),
        path: `${req.baseUrl}${req.path}`,
        message: 'Forbidden',
        errorCode: ERRORS.FORBIDDEN.code,
    });
}

function hasValidCookie(req: Request, appSecret: string): boolean {
    const token = getCookie(req, BACKEND_TOOLS_AUTH_COOKIE_NAME);

    if (!token) {
        return false;
    }

    return verifyJwt(token, appSecret, BACKEND_TOOLS_JWT_SCOPES.ACCESS) !== null;
}

function getCookie(req: Request, name: string): string | null {
    const header = req.headers.cookie;

    if (!header) {
        return null;
    }

    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');

        if (key === name) {
            return decodeURIComponent(rest.join('='));
        }
    }

    return null;
}

function signJwt(appSecret: string) {
    return jwt.sign({ scope: BACKEND_TOOLS_JWT_SCOPES.ACCESS }, appSecret, {
        expiresIn: `${BACKEND_TOOLS_JWT_LIFETIME_HOURS}h`,
        issuer: BACKEND_TOOLS_JWT_ISSUER,
    });
}

function verifyJwt(
    token: string,
    appSecret: string,
    scope: TBackendToolsJwtScope,
): jwt.JwtPayload | null {
    try {
        const decoded = jwt.verify(token, appSecret, {
            issuer: BACKEND_TOOLS_JWT_ISSUER,
            ignoreExpiration: false,
        });

        return typeof decoded === 'object' && decoded.scope === scope ? decoded : null;
    } catch {
        return null;
    }
}
