export const NODE_DOCKER_IMAGE = 'ghcr.io/therewasluna/umiji-node:latest';
export const NODE_INSTALL_DIR = '/opt/umiji-node';
export const NODE_CONTAINER_NAME = 'umiji-node';

export const NODE_INSTALL_STEPS = [
    'connect',
    'system',
    'docker',
    'compose',
    'start',
    'handshake',
    'register',
] as const;
export type TNodeInstallStep = (typeof NODE_INSTALL_STEPS)[number];

// Share of the progress bar and the typical duration of each step, so the bar moves smoothly.
export const NODE_INSTALL_STEP_WEIGHTS: Record<TNodeInstallStep, { ms: number; weight: number }> = {
    connect: { weight: 5, ms: 3_000 },
    system: { weight: 5, ms: 2_000 },
    docker: { weight: 35, ms: 90_000 },
    compose: { weight: 5, ms: 3_000 },
    start: { weight: 35, ms: 45_000 },
    handshake: { weight: 10, ms: 8_000 },
    register: { weight: 5, ms: 2_000 },
};

export const NODE_INSTALL_ERROR_CODES = [
    'CONNECT_FAILED',
    'AUTH_FAILED',
    'NOT_ROOT',
    'UNSUPPORTED_SYSTEM',
    'DOCKER_FAILED',
    'CONTAINER_EXISTS',
    'PORT_BUSY',
    'START_FAILED',
    'HANDSHAKE_FAILED',
    'REGISTER_FAILED',
    'INTERRUPTED',
] as const;
export type TNodeInstallErrorCode = (typeof NODE_INSTALL_ERROR_CODES)[number];

export const generateNodeDockerCompose = (port: number, secretKey: string): string => `services:
  ${NODE_CONTAINER_NAME}:
    container_name: ${NODE_CONTAINER_NAME}
    hostname: ${NODE_CONTAINER_NAME}
    image: ${NODE_DOCKER_IMAGE}
    network_mode: host
    restart: always
    cap_add:
      - NET_ADMIN
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576
    environment:
      - NODE_PORT=${port}
      - SECRET_KEY="${secretKey.trimEnd()}"`;
