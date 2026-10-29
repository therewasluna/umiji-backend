import {
    AuthenticationResponseJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import * as arctic from 'arctic';
import { AxiosError } from 'axios';
import { catchError, firstValueFrom } from 'rxjs';

import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';

import { TypedConfigService } from '@common/config/app-config';
import { RawCacheService } from '@common/raw-cache';
import { fail, ok, TResult } from '@common/types';
import { hashPassword, verifyPassword } from '@common/utils';
import { AUTH_ROUTES } from '@libs/contracts/api';
import {
    CACHE_KEYS,
    CACHE_KEYS_TTL,
    EVENTS,
    OAUTH2_PROVIDERS,
    ROLE,
    TOAuth2ProvidersKeys,
} from '@libs/contracts/constants';
import { ERRORS } from '@libs/contracts/constants/errors';

import { ServiceEvent } from '@integration-modules/notifications/interfaces';

import { CreateAdminCommand } from '@modules/admin/commands/create-admin';
import { UpdatePasskeyCommand } from '@modules/admin/commands/update-passkey';
import { AdminEntity } from '@modules/admin/entities/admin.entity';
import { CountAdminsByRoleQuery } from '@modules/admin/queries/count-admins-by-role';
import { FindPasskeyByIdAndAdminUuidQuery } from '@modules/admin/queries/find-passkey-by-id-and-uuid';
import { GetAdminByUsernameQuery } from '@modules/admin/queries/get-admin-by-username';
import { GetFirstAdminQuery } from '@modules/admin/queries/get-first-admin';
import { GetPasskeysByAdminUuidQuery } from '@modules/admin/queries/get-passkeys-by-admin-uuid';
import { BrokerEntity } from '@modules/brokers/entities';
import { GetBrokerByUuidQuery } from '@modules/brokers/queries/get-broker-by-uuid';
import { UmijiSettingsEntity } from '@modules/umiji-settings/entities';
import { GetCachedUmijiSettingsQuery } from '@modules/umiji-settings/queries/get-cached-umiji-settings';

import { VerifyPasskeyAuthenticationBodyDto } from './dtos';
import { ILogin, IRegister } from './interfaces';
import {
    OAuth2AuthorizeResponseModel,
    OAuth2CallbackResponseModel,
    GetStatusResponseModel,
} from './model';

const UMIJI_CUSTOM_CLAIM_KEY = 'umijiAccess';
const OAUTH2_SCOPES = ['email', 'profile', 'openid'];

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly jwtSecret: string;
    private readonly jwtLifetime: number;

    constructor(
        private readonly rawCacheService: RawCacheService,
        private readonly jwtService: JwtService,
        private readonly configService: TypedConfigService,
        private readonly queryBus: QueryBus,
        private readonly commandBus: CommandBus,
        private readonly eventEmitter: EventEmitter2,
        private readonly httpService: HttpService,
    ) {
        this.jwtSecret = this.configService.getOrThrow('APP_SECRET');
        this.jwtLifetime = this.configService.getOrThrow('JWT_AUTH_LIFETIME');
    }

    public async login(
        dto: ILogin,
        ip: string,
        userAgent: string,
    ): Promise<
        TResult<{
            accessToken: string;
        }>
    > {
        try {
            const { username, password } = dto;

            const statusResponse = await this.getStatus();

            if (!statusResponse.isOk) {
                return fail(ERRORS.GET_AUTH_STATUS_ERROR);
            }

            if (!statusResponse.response.isLoginAllowed) {
                await this.emitFailedLoginAttempt(
                    username,
                    password,
                    ip,
                    userAgent,
                    'Login is not allowed.',
                );
                this.logger.error('Login is not allowed.');
                return fail(ERRORS.FORBIDDEN);
            }

            if (!statusResponse.response.authentication) {
                return fail(ERRORS.FORBIDDEN);
            }

            let admin = await this.getAdminByUsername({
                username,
                role: ROLE.ADMIN,
            });

            if (!admin.isOk) {
                admin = await this.getAdminByUsername({
                    username,
                    role: ROLE.BROKER,
                });
            }

            const isBroker = admin.isOk && admin.response.role === ROLE.BROKER;

            // Brokers can only sign in with a password, so this toggle applies to the panel owner.
            if (!isBroker && !statusResponse.response.authentication.password.enabled) {
                await this.emitFailedLoginAttempt(
                    username,
                    password,
                    ip,
                    userAgent,
                    'Someone tried to login with password authentication, but it is disabled.',
                );
                this.logger.error(
                    'Someone tried to login with password authentication, but it is disabled.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            if (!admin.isOk) {
                await this.emitFailedLoginAttempt(
                    username,
                    password,
                    ip,
                    userAgent,
                    'Admin is not found in database.',
                );
                this.logger.error('Admin is not found in database.');
                return fail(ERRORS.FORBIDDEN);
            }

            const isPasswordValid = await this.verifyPassword(
                password,
                admin.response.passwordHash,
            );

            if (!isPasswordValid) {
                await this.emitFailedLoginAttempt(
                    username,
                    password,
                    ip,
                    userAgent,
                    'Invalid password.',
                );
                this.logger.error('Invalid password.');
                return fail(ERRORS.FORBIDDEN);
            }

            if (isBroker) {
                const broker = await this.queryBus.execute<
                    GetBrokerByUuidQuery,
                    TResult<BrokerEntity>
                >(new GetBrokerByUuidQuery(admin.response.uuid));

                // An expired broker can still sign in and look around; the guard blocks its changes.
                if (!broker.isOk || broker.response.isDisabled) {
                    await this.emitFailedLoginAttempt(
                        username,
                        password,
                        ip,
                        userAgent,
                        'Broker is disabled.',
                    );
                    return fail(ERRORS.BROKER_ACCOUNT_INACTIVE);
                }
            }

            const accessToken = this.jwtService.sign(
                {
                    username,
                    uuid: admin.response.uuid,
                    role: isBroker ? ROLE.BROKER : ROLE.ADMIN,
                },
                { expiresIn: `${this.jwtLifetime}h` },
            );

            await this.emitLoginSuccess(username, ip, userAgent);

            return ok({ accessToken });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.LOGIN_ERROR);
        }
    }

    public async register(dto: IRegister): Promise<
        TResult<{
            accessToken: string;
        }>
    > {
        try {
            const { username, password } = dto;

            const statusResponse = await this.getStatus();

            if (!statusResponse.isOk) {
                return fail(ERRORS.GET_AUTH_STATUS_ERROR);
            }

            if (!statusResponse.response.isRegisterAllowed) {
                return fail(ERRORS.FORBIDDEN);
            }

            const admin = await this.getAdminByUsername({
                username,
                role: ROLE.ADMIN,
            });

            if (admin.isOk) {
                return fail(ERRORS.FORBIDDEN);
            }

            const hashedPassword = await this.hashPassword(password);

            const createAdminResponse = await this.createAdmin({
                username,
                password: hashedPassword,
                role: ROLE.ADMIN,
            });

            if (!createAdminResponse.isOk) {
                return fail(ERRORS.CREATE_ADMIN_ERROR);
            }

            const accessToken = this.jwtService.sign(
                {
                    username,
                    uuid: createAdminResponse.response.uuid,
                    role: ROLE.ADMIN,
                },
                { expiresIn: `${this.jwtLifetime}h` },
            );

            return ok({ accessToken });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.LOGIN_ERROR);
        }
    }

    public async getStatus(): Promise<TResult<GetStatusResponseModel>> {
        try {
            const umijiSettings = await this.queryBus.execute(
                new GetCachedUmijiSettingsQuery(),
            );

            const adminCount = await this.getAdminCount();

            if (!adminCount.isOk) {
                this.logger.error('Failed to fetch admin list.');
                return ok(
                    new GetStatusResponseModel({
                        isLoginAllowed: false,
                        isRegisterAllowed: false,
                        authentication: null,
                        branding: umijiSettings.brandingSettings,
                    }),
                );
            }

            if (adminCount.response === undefined) {
                return ok(
                    new GetStatusResponseModel({
                        isLoginAllowed: false,
                        isRegisterAllowed: false,
                        authentication: null,
                        branding: umijiSettings.brandingSettings,
                    }),
                );
            }

            if (adminCount.response === 0) {
                return ok(
                    new GetStatusResponseModel({
                        isLoginAllowed: false,
                        isRegisterAllowed: true,
                        authentication: null,
                        branding: umijiSettings.brandingSettings,
                    }),
                );
            }

            if (adminCount.response > 1) {
                this.logger.warn(
                    'Multiple admins found. This should not be possible. Restart Umiji to clear unknown admins.',
                );
                return ok(
                    new GetStatusResponseModel({
                        isLoginAllowed: false,
                        isRegisterAllowed: false,
                        authentication: null,
                        branding: umijiSettings.brandingSettings,
                    }),
                );
            }

            return ok(
                new GetStatusResponseModel({
                    isLoginAllowed: true,
                    isRegisterAllowed: false,
                    authentication: {
                        passkey: {
                            enabled: umijiSettings.passkeySettings.enabled,
                        },
                        oauth2: {
                            providers: {
                                [OAUTH2_PROVIDERS.GITHUB]:
                                    umijiSettings.oauth2Settings.github.enabled,
                                [OAUTH2_PROVIDERS.POCKETID]:
                                    umijiSettings.oauth2Settings.pocketid.enabled,
                                [OAUTH2_PROVIDERS.YANDEX]:
                                    umijiSettings.oauth2Settings.yandex.enabled,
                                [OAUTH2_PROVIDERS.KEYCLOAK]:
                                    umijiSettings.oauth2Settings.keycloak.enabled,
                                [OAUTH2_PROVIDERS.GENERIC]:
                                    umijiSettings.oauth2Settings.generic.enabled,
                                [OAUTH2_PROVIDERS.TELEGRAM]:
                                    umijiSettings.oauth2Settings.telegram.enabled,
                            },
                        },
                        password: {
                            enabled: umijiSettings.passwordSettings.enabled,
                        },
                    },
                    branding: umijiSettings.brandingSettings,
                }),
            );
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_AUTH_STATUS_ERROR);
        }
    }

    public async oauth2Authorize(
        provider: TOAuth2ProvidersKeys,
    ): Promise<TResult<OAuth2AuthorizeResponseModel>> {
        try {
            const statusResponse = await this.getStatus();

            if (!statusResponse.isOk) {
                return fail(ERRORS.GET_AUTH_STATUS_ERROR);
            }

            if (
                !statusResponse.response.isLoginAllowed ||
                !statusResponse.response.authentication ||
                !statusResponse.response.authentication?.oauth2.providers[provider]
            ) {
                return fail(ERRORS.FORBIDDEN);
            }

            const umijiSettings = await this.queryBus.execute(
                new GetCachedUmijiSettingsQuery(),
            );

            let authorizationURL: URL;
            let pkceVerifier: string | null = null;

            const state = arctic.generateState();

            switch (provider) {
                case OAUTH2_PROVIDERS.GITHUB:
                    const ghClient = new arctic.GitHub(
                        umijiSettings.oauth2Settings.github.clientId!,
                        umijiSettings.oauth2Settings.github.clientSecret!,
                        null,
                    );

                    authorizationURL = ghClient.createAuthorizationURL(state, ['user:email']);
                    break;
                case OAUTH2_PROVIDERS.POCKETID:
                    const pocketIdClient = await this.getGenericOAuth2Client(
                        umijiSettings,
                        true,
                    );

                    authorizationURL = pocketIdClient.createAuthorizationURL(
                        `https://${umijiSettings.oauth2Settings.pocketid.plainDomain}/authorize`,
                        state,
                        OAUTH2_SCOPES,
                    );
                    break;
                case OAUTH2_PROVIDERS.YANDEX:
                    const yandexClient = new arctic.Yandex(
                        umijiSettings.oauth2Settings.yandex.clientId!,
                        umijiSettings.oauth2Settings.yandex.clientSecret!,
                        '',
                    );
                    authorizationURL = yandexClient.createAuthorizationURL(state, ['login:email']);
                    break;
                case OAUTH2_PROVIDERS.KEYCLOAK:
                    pkceVerifier = arctic.generateCodeVerifier();

                    const keycloakClient = await this.getKeyCloakClient(umijiSettings);
                    authorizationURL = keycloakClient.createAuthorizationURL(
                        state,
                        pkceVerifier,
                        OAUTH2_SCOPES,
                    );

                    break;
                case OAUTH2_PROVIDERS.GENERIC:
                    const authorizationEndpoint =
                        umijiSettings.oauth2Settings.generic.authorizationUrl!;
                    const genericOAuth2Client =
                        await this.getGenericOAuth2Client(umijiSettings);

                    switch (umijiSettings.oauth2Settings.generic.withPkce) {
                        case false:
                            authorizationURL = genericOAuth2Client.createAuthorizationURL(
                                authorizationEndpoint,
                                state,
                                OAUTH2_SCOPES,
                            );
                            break;
                        case true:
                            pkceVerifier = arctic.generateCodeVerifier();

                            authorizationURL = genericOAuth2Client.createAuthorizationURLWithPKCE(
                                authorizationEndpoint,
                                state,
                                arctic.CodeChallengeMethod.S256,
                                pkceVerifier,
                                OAUTH2_SCOPES,
                            );
                            break;
                    }
                    break;
                case OAUTH2_PROVIDERS.TELEGRAM: {
                    pkceVerifier = arctic.generateCodeVerifier();
                    const tgClient = this.getTelegramOAuth2Client(umijiSettings);

                    authorizationURL = tgClient.createAuthorizationURLWithPKCE(
                        'https://oauth.telegram.org/auth',
                        state,
                        arctic.CodeChallengeMethod.S256,
                        pkceVerifier,
                        ['openid', 'profile', 'telegram:bot_access'],
                    );

                    break;
                }
                default:
                    return fail(ERRORS.OAUTH2_PROVIDER_NOT_FOUND);
            }

            await this.rawCacheService.set(
                CACHE_KEYS.OAUTH2_STATE(state),
                { codeVerifier: pkceVerifier, provider },
                CACHE_KEYS_TTL.OAUTH2_STATE,
            );

            return ok(
                new OAuth2AuthorizeResponseModel({
                    authorizationUrl: authorizationURL.toString(),
                }),
            );
        } catch (error) {
            this.logger.error('GitHub authorization error:', error);
            return fail(ERRORS.OAUTH2_AUTHORIZE_ERROR);
        }
    }

    public async oauth2Callback(
        code: string,
        state: string,
        provider: TOAuth2ProvidersKeys,
        ip: string,
        userAgent: string,
    ): Promise<TResult<OAuth2CallbackResponseModel>> {
        try {
            const statusResponse = await this.getStatus();
            if (!statusResponse.isOk) {
                return fail(ERRORS.GET_AUTH_STATUS_ERROR);
            }

            if (!statusResponse.response.isLoginAllowed) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    `OAuth2 code: ${code}`,
                    ip,
                    userAgent,
                    'Login is not allowed.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            if (!statusResponse.response.authentication?.oauth2.providers[provider]) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    `OAuth2 provider: ${provider}`,
                    '–',
                    '–',
                    `OAuth2 provider ${provider} is disabled.`,
                );
                return fail(ERRORS.FORBIDDEN);
            }

            const firstAdmin = await this.getFirstAdmin();
            if (!firstAdmin.isOk) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Superadmin not found.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            const callbackResult = await this.processOAuth2Callback(
                provider,
                code,
                state,
                ip,
                userAgent,
            );

            if (!callbackResult.isAllowed || !callbackResult.email) {
                return fail(ERRORS.FORBIDDEN);
            }

            const jwtToken = this.jwtService.sign(
                {
                    username: firstAdmin.response.username,
                    uuid: firstAdmin.response.uuid,
                    role: ROLE.ADMIN,
                },
                { expiresIn: `${this.jwtLifetime}h` },
            );

            await this.emitLoginSuccess(
                callbackResult.email,
                ip,
                userAgent,
                `Logged via ${provider} OAuth2.`,
            );

            return ok(new OAuth2CallbackResponseModel({ accessToken: jwtToken }));
        } catch (error) {
            this.logger.error(`OAuth2 callback error (${provider}):`, error);
            return fail(ERRORS.LOGIN_ERROR);
        }
    }

    private async processOAuth2Callback(
        provider: TOAuth2ProvidersKeys,
        code: string,
        state: string,
        ip: string,
        userAgent: string,
    ): Promise<{ isAllowed: boolean; email: string | null }> {
        const FAIL = { isAllowed: false, email: null };

        const ceremony = await this.rawCacheService.getDel<{
            codeVerifier: string | null;
            provider: TOAuth2ProvidersKeys;
        }>(CACHE_KEYS.OAUTH2_STATE(state));

        const codeVerifier = ceremony?.codeVerifier ?? null;

        if (!ceremony || ceremony.provider !== provider) {
            await this.emitFailedLoginAttempt(
                'Unknown',
                `State: ${state}`,
                ip,
                userAgent,
                `${provider} state mismatch.`,
            );
            return FAIL;
        }

        const settings: UmijiSettingsEntity = await this.queryBus.execute(
            new GetCachedUmijiSettingsQuery(),
        );

        if (
            ((provider === OAUTH2_PROVIDERS.GENERIC &&
                settings.oauth2Settings.generic.withPkce &&
                settings.oauth2Settings.generic.enabled) ||
                provider === OAUTH2_PROVIDERS.KEYCLOAK ||
                provider === OAUTH2_PROVIDERS.TELEGRAM) &&
            !codeVerifier
        ) {
            await this.emitFailedLoginAttempt(
                'Unknown',
                '–',
                ip,
                userAgent,
                `${provider} code verifier not found.`,
            );
            return FAIL;
        }

        const emailResult = await this.exchangeCodeForEmail(provider, code, codeVerifier, settings);

        if (!emailResult.email) {
            await this.emitFailedLoginAttempt(
                'Unknown',
                '–',
                ip,
                userAgent,
                emailResult.error ?? `Failed to get email from ${provider}.`,
            );
            return FAIL;
        }

        const allowedEmails = this.getAllowedEmails(provider, settings);

        const isAllowed = emailResult.hasCustomClaim || allowedEmails.includes(emailResult.email);

        if (!isAllowed) {
            await this.emitFailedLoginAttempt(
                emailResult.email,
                '–',
                ip,
                userAgent,
                `${provider} email not in allowed list and no umijiAccess claim.`,
            );
            return FAIL;
        }

        return { isAllowed: true, email: emailResult.email };
    }

    private async exchangeCodeForEmail(
        provider: TOAuth2ProvidersKeys,
        code: string,
        codeVerifier: string | null,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; hasCustomClaim?: boolean; error?: string }> {
        try {
            switch (provider) {
                case OAUTH2_PROVIDERS.GITHUB:
                    return await this.fetchGithubEmail(code, settings);
                case OAUTH2_PROVIDERS.YANDEX:
                    return await this.fetchYandexEmail(code, settings);
                case OAUTH2_PROVIDERS.POCKETID:
                    return await this.fetchPocketIdEmail(code, settings);
                case OAUTH2_PROVIDERS.KEYCLOAK:
                    return await this.fetchKeycloakEmail(code, codeVerifier!, settings);
                case OAUTH2_PROVIDERS.GENERIC:
                    return await this.fetchGenericEmail(code, codeVerifier, settings);
                case OAUTH2_PROVIDERS.TELEGRAM:
                    return await this.fetchTelegramId(code, codeVerifier!, settings);
                default:
                    return { email: null, error: 'Unknown provider' };
            }
        } catch (error) {
            this.logger.error(`${provider} token exchange error: ${error}`);
            return { email: null, error: `Token exchange failed for ${provider}` };
        }
    }

    private getAllowedEmails(
        provider: TOAuth2ProvidersKeys,
        settings: UmijiSettingsEntity,
    ): string[] {
        const map: Record<TOAuth2ProvidersKeys, string[]> = {
            [OAUTH2_PROVIDERS.GITHUB]: settings.oauth2Settings.github.allowedEmails,
            [OAUTH2_PROVIDERS.YANDEX]: settings.oauth2Settings.yandex.allowedEmails,
            [OAUTH2_PROVIDERS.POCKETID]: settings.oauth2Settings.pocketid.allowedEmails,
            [OAUTH2_PROVIDERS.KEYCLOAK]: settings.oauth2Settings.keycloak.allowedEmails,
            [OAUTH2_PROVIDERS.GENERIC]: settings.oauth2Settings.generic.allowedEmails,
            [OAUTH2_PROVIDERS.TELEGRAM]: settings.oauth2Settings.telegram.allowedIds,
        };
        return map[provider] ?? [];
    }

    private async fetchGithubEmail(
        code: string,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; error?: string }> {
        const client = new arctic.GitHub(
            settings.oauth2Settings.github.clientId!,
            settings.oauth2Settings.github.clientSecret!,
            null,
        );

        const tokens = await client.validateAuthorizationCode(code);

        const { data } = await firstValueFrom(
            this.httpService
                .get<{ email: string; primary: boolean }[]>('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokens.accessToken()}`,
                        'User-Agent': 'Umiji',
                    },
                })
                .pipe(
                    catchError((e: AxiosError) => {
                        throw e.response?.data;
                    }),
                ),
        );

        const email = data?.find((e) => e.primary)?.email ?? null;
        return { email, error: email ? undefined : 'No primary email found' };
    }

    private async fetchYandexEmail(
        code: string,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; error?: string }> {
        const client = new arctic.Yandex(
            settings.oauth2Settings.yandex.clientId!,
            settings.oauth2Settings.yandex.clientSecret!,
            '',
        );

        const tokens = await client.validateAuthorizationCode(code);

        const { data } = await firstValueFrom(
            this.httpService
                .get<{ default_email: string }>('https://login.yandex.ru/info?format=json', {
                    headers: {
                        Authorization: `Bearer ${tokens.accessToken()}`,
                        'User-Agent': 'Umiji',
                    },
                })
                .pipe(
                    catchError((e: AxiosError) => {
                        throw e.response?.data;
                    }),
                ),
        );

        const email = data?.default_email ?? null;
        return { email, error: email ? undefined : 'No email found' };
    }

    private async fetchPocketIdEmail(
        code: string,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; hasCustomClaim?: boolean; error?: string }> {
        const client = await this.getGenericOAuth2Client(settings, true);

        const tokens = await client.validateAuthorizationCode(
            `https://${settings.oauth2Settings.pocketid.plainDomain}/api/oidc/token`,
            code,
            null,
        );

        return this.extractEmailFromIdToken(tokens.idToken());
    }

    private async fetchKeycloakEmail(
        code: string,
        codeVerifier: string,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; hasCustomClaim?: boolean; error?: string }> {
        const client = await this.getKeyCloakClient(settings);

        const tokens = await client.validateAuthorizationCode(code, codeVerifier);

        return this.extractEmailFromIdToken(tokens.idToken());
    }

    private async fetchGenericEmail(
        code: string,
        codeVerifier: string | null,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; hasCustomClaim?: boolean; error?: string }> {
        if (settings.oauth2Settings.generic.withPkce && !codeVerifier) {
            return { email: null, error: 'Code verifier required for PKCE' };
        }

        const client = await this.getGenericOAuth2Client(settings);

        const tokens = await client.validateAuthorizationCode(
            settings.oauth2Settings.generic.tokenUrl!,
            code,
            codeVerifier ?? null,
        );

        return this.extractEmailFromIdToken(tokens.idToken());
    }

    private extractEmailFromIdToken(idToken: string): {
        email: string | null;
        hasCustomClaim?: boolean;
        error?: string;
    } {
        const claims = arctic.decodeIdToken(idToken);
        const email = 'email' in claims && typeof claims.email === 'string' ? claims.email : null;
        const hasCustomClaim =
            UMIJI_CUSTOM_CLAIM_KEY in claims && claims[UMIJI_CUSTOM_CLAIM_KEY] === true;

        return {
            email,
            hasCustomClaim,
            error: email ? undefined : 'Missing email in ID token',
        };
    }

    private async getAdminCount(): Promise<TResult<number>> {
        return this.queryBus.execute<CountAdminsByRoleQuery, TResult<number>>(
            new CountAdminsByRoleQuery(ROLE.ADMIN),
        );
    }

    private async getAdminByUsername(dto: GetAdminByUsernameQuery): Promise<TResult<AdminEntity>> {
        return this.queryBus.execute<GetAdminByUsernameQuery, TResult<AdminEntity>>(
            new GetAdminByUsernameQuery(dto.username, dto.role),
        );
    }

    private async getFirstAdmin(): Promise<TResult<AdminEntity>> {
        return this.queryBus.execute<GetFirstAdminQuery, TResult<AdminEntity>>(
            new GetFirstAdminQuery(ROLE.ADMIN),
        );
    }

    private async hashPassword(plainPassword: string): Promise<string> {
        return hashPassword(plainPassword, this.jwtSecret);
    }

    private async verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
        return verifyPassword(plainPassword, storedHash, this.jwtSecret);
    }

    private async createAdmin(dto: CreateAdminCommand): Promise<TResult<AdminEntity>> {
        return this.commandBus.execute<CreateAdminCommand, TResult<AdminEntity>>(
            new CreateAdminCommand(dto.username, dto.password, dto.role),
        );
    }

    private async emitFailedLoginAttempt(
        username: string,
        password: string,
        ip: string,
        userAgent: string,
        description?: string,
    ): Promise<void> {
        this.eventEmitter.emit(
            EVENTS.SERVICE.LOGIN_ATTEMPT_FAILED,
            new ServiceEvent(EVENTS.SERVICE.LOGIN_ATTEMPT_FAILED, {
                loginAttempt: {
                    username,
                    password,
                    ip,
                    userAgent,
                    description: description ?? '–',
                },
            }),
        );
    }

    private async emitLoginSuccess(
        username: string,
        ip: string,
        userAgent: string,
        description?: string,
    ): Promise<void> {
        this.eventEmitter.emit(
            EVENTS.SERVICE.LOGIN_ATTEMPT_SUCCESS,
            new ServiceEvent(EVENTS.SERVICE.LOGIN_ATTEMPT_SUCCESS, {
                loginAttempt: {
                    username,
                    ip,
                    userAgent,
                    description: description ?? '–',
                },
            }),
        );
    }

    public async generatePasskeyAuthenticationOptions(
        umijiSettings: UmijiSettingsEntity,
    ): Promise<TResult<PublicKeyCredentialRequestOptionsJSON>> {
        try {
            if (!umijiSettings.passkeySettings.enabled) {
                return fail(ERRORS.FORBIDDEN);
            }

            if (
                !umijiSettings.passkeySettings.rpId ||
                !umijiSettings.passkeySettings.origin
            ) {
                return fail(ERRORS.FORBIDDEN);
            }

            const admin = await this.getFirstAdmin();

            if (!admin.isOk) {
                return fail(ERRORS.FORBIDDEN);
            }

            const userPasskeys = await this.queryBus.execute(
                new GetPasskeysByAdminUuidQuery(admin.response.uuid),
            );

            if (!userPasskeys.isOk) {
                return fail(ERRORS.FORBIDDEN);
            }

            if (userPasskeys.response.length === 0) {
                this.logger.warn('No passkeys registered for this user');
                return fail(ERRORS.FORBIDDEN);
            }

            const options = await generateAuthenticationOptions({
                rpID: umijiSettings.passkeySettings.rpId,
                allowCredentials: userPasskeys.response.map((passkey) => ({
                    id: passkey.id,
                    transports: passkey.getTransports(),
                })),
                userVerification: 'required',
            });

            await this.rawCacheService.setString(
                CACHE_KEYS.PASSKEY_AUTHENTICATION_CHALLENGE(options.challenge),
                admin.response.uuid,
                CACHE_KEYS_TTL.PASSKEY_AUTHENTICATION_CHALLENGE,
            );

            return ok(options);
        } catch (error) {
            this.logger.error(`Passkey authentication options error: ${error}`);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    private readClientDataChallenge(response: AuthenticationResponseJSON): string | null {
        try {
            const clientData = JSON.parse(
                Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
            ) as { challenge?: unknown };

            return typeof clientData.challenge === 'string' ? clientData.challenge : null;
        } catch {
            return null;
        }
    }

    public async verifyPasskeyAuthentication(
        dto: VerifyPasskeyAuthenticationBodyDto,
        umijiSettings: UmijiSettingsEntity,
        ip: string,
        userAgent: string,
    ): Promise<TResult<{ accessToken: string }>> {
        try {
            if (!umijiSettings.passkeySettings.enabled) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Passkey authentication is not enabled.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            if (
                !umijiSettings.passkeySettings.rpId ||
                !umijiSettings.passkeySettings.origin
            ) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Passkey authentication is not configured.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            const response = dto.response as unknown as AuthenticationResponseJSON;

            const admin = await this.getFirstAdmin();

            if (!admin.isOk) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Admin is not found.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            const expectedChallenge = this.readClientDataChallenge(response);

            const challengeOwner = expectedChallenge
                ? await this.rawCacheService.getDelString(
                      CACHE_KEYS.PASSKEY_AUTHENTICATION_CHALLENGE(expectedChallenge),
                  )
                : null;

            if (!expectedChallenge || challengeOwner !== admin.response.uuid) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Challenge not found.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            const passkey = await this.queryBus.execute(
                new FindPasskeyByIdAndAdminUuidQuery(response.id, admin.response.uuid),
            );

            if (!passkey.isOk) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Passkey not found.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge,
                expectedOrigin: [
                    umijiSettings.passkeySettings.origin,
                    `https://${umijiSettings.passkeySettings.rpId}`,
                ],
                expectedRPID: umijiSettings.passkeySettings.rpId,
                credential: {
                    id: passkey.response.id,
                    publicKey: new Uint8Array(passkey.response.publicKey),
                    counter: Number(passkey.response.counter),
                    transports: passkey.response.getTransports(),
                },
                requireUserVerification: true,
            });

            if (!verification.verified) {
                await this.emitFailedLoginAttempt(
                    'Unknown',
                    '–',
                    ip,
                    userAgent,
                    'Passkey authentication failed.',
                );
                return fail(ERRORS.FORBIDDEN);
            }

            await this.commandBus.execute(
                new UpdatePasskeyCommand(passkey.response.id, {
                    counter: BigInt(verification.authenticationInfo.newCounter),
                    updatedAt: new Date(),
                }),
            );

            const accessToken = this.jwtService.sign(
                {
                    username: admin.response.username,
                    uuid: admin.response.uuid,
                    role: ROLE.ADMIN,
                },
                { expiresIn: `${this.jwtLifetime}h` },
            );

            await this.emitLoginSuccess(
                admin.response.username,
                ip,
                userAgent,
                'Passkey authentication successful.',
            );

            return ok({ accessToken });
        } catch (error) {
            this.logger.error(`Passkey authentication verification error: ${error}`);
            return fail(ERRORS.FORBIDDEN);
        }
    }

    private async getKeyCloakClient(settings: UmijiSettingsEntity): Promise<arctic.KeyCloak> {
        return new arctic.KeyCloak(
            `https://${settings.oauth2Settings.keycloak.keycloakDomain!}/realms/${settings.oauth2Settings.keycloak.realm!}`,
            settings.oauth2Settings.keycloak.clientId!,
            settings.oauth2Settings.keycloak.clientSecret!,
            `https://${settings.oauth2Settings.keycloak.frontendDomain!}/${AUTH_ROUTES.OAUTH2.CALLBACK}/${OAUTH2_PROVIDERS.KEYCLOAK}`,
        );
    }

    private async getGenericOAuth2Client(
        settings: UmijiSettingsEntity,
        isPocketId: boolean = false,
    ): Promise<arctic.OAuth2Client> {
        if (isPocketId) {
            const { clientId, clientSecret, frontendDomain } = settings.oauth2Settings.pocketid;
            if (!clientId || !clientSecret || !frontendDomain) {
                throw new Error(
                    'PocketID OAuth2 config is incomplete (clientId, clientSecret, plainDomain, frontendDomain).',
                );
            }
            const redirectUrl = `https://${frontendDomain}/${AUTH_ROUTES.OAUTH2.CALLBACK}/${OAUTH2_PROVIDERS.POCKETID}`;
            return new arctic.OAuth2Client(clientId, clientSecret, redirectUrl);
        } else {
            const { clientId, clientSecret, frontendDomain } = settings.oauth2Settings.generic;
            if (!clientId || !clientSecret || !frontendDomain) {
                throw new Error(
                    'Generic OAuth2 config is incomplete (clientId, clientSecret, frontendDomain).',
                );
            }
            const redirectUrl = `https://${frontendDomain}/${AUTH_ROUTES.OAUTH2.CALLBACK}/${OAUTH2_PROVIDERS.GENERIC}`;
            return new arctic.OAuth2Client(clientId, clientSecret, redirectUrl);
        }
    }

    private getTelegramOAuth2Client(settings: UmijiSettingsEntity): arctic.OAuth2Client {
        const { clientId, clientSecret, frontendDomain } = settings.oauth2Settings.telegram;
        if (!clientId || !clientSecret || !frontendDomain) {
            throw new Error(
                'Telegram OAuth2 config is incomplete (clientId, clientSecret, frontendDomain).',
            );
        }
        const redirectUrl = `https://${frontendDomain}/${AUTH_ROUTES.OAUTH2.CALLBACK}/${OAUTH2_PROVIDERS.TELEGRAM}`;
        return new arctic.OAuth2Client(clientId, clientSecret, redirectUrl);
    }

    private async fetchTelegramId(
        code: string,
        codeVerifier: string,
        settings: UmijiSettingsEntity,
    ): Promise<{ email: string | null; hasCustomClaim?: boolean; error?: string }> {
        const client = this.getTelegramOAuth2Client(settings);

        const tokens = await client.validateAuthorizationCode(
            'https://oauth.telegram.org/token',
            code,
            codeVerifier,
        );

        const tokenData = arctic.decodeIdToken(tokens.idToken());

        if (!('id' in tokenData) || typeof tokenData.id !== 'string') {
            return {
                email: null,
                hasCustomClaim: false,
                error: 'Telegram ID is missing in the ID token',
            };
        }

        if (!settings.oauth2Settings.telegram.allowedIds.includes(tokenData.id)) {
            return {
                email: null,
                hasCustomClaim: false,
                error: `Telegram ID ${tokenData.id} is not in the allowed list`,
            };
        }

        return {
            email: tokenData.id,
            hasCustomClaim: false,
            error: undefined,
        };
    }
}
