import { Client } from 'ssh2';

import { Logger } from '@nestjs/common';

import { TResult } from '@common/types';
import { StartNodeInstallCommand, TNodeInstallState } from '@libs/contracts/commands';
import {
    generateNodeDockerCompose,
    NODE_CONTAINER_NAME,
    NODE_DOCKER_IMAGE,
    NODE_INSTALL_DIR,
    NODE_INSTALL_STEPS,
    TNodeInstallErrorCode,
    TNodeInstallStep,
} from '@libs/contracts/constants';

import { sshFingerprint } from '@modules/node-ssh/ssh/ssh-session';

const MAX_LOG_LINES = 400;
const MAX_LINE_LENGTH = 400;
const MAX_OUTPUT_CHARS = 64_000;
const FLUSH_THROTTLE_MS = 500;
const HEARTBEAT_MS = 5_000;
const HANDSHAKE_TIMEOUT_MS = 90_000;
const HANDSHAKE_RETRY_MS = 2_000;

const COMPOSE_FILE = `${NODE_INSTALL_DIR}/docker-compose.yml`;
const SUPPORTED_ARCHS = ['x86_64', 'amd64', 'aarch64', 'arm64'];

const SYSTEM_PROBE = [
    'echo "uid=$(id -u)"',
    'echo "kernel=$(uname -s)"',
    'echo "arch=$(uname -m)"',
    'if [ -r /etc/os-release ]; then . /etc/os-release; echo "os=${PRETTY_NAME:-$NAME}"; fi',
].join('; ');

const INSTALL_DOCKER = `set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq curl
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q curl
  elif command -v yum >/dev/null 2>&1; then yum install -y -q curl
  fi
fi
if command -v curl >/dev/null 2>&1; then curl -fsSL https://get.docker.com -o /tmp/umiji-get-docker.sh
else wget -qO /tmp/umiji-get-docker.sh https://get.docker.com; fi
sh /tmp/umiji-get-docker.sh
rm -f /tmp/umiji-get-docker.sh`;

const START_DOCKER =
    'systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true';

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

class InstallError extends Error {
    constructor(
        public readonly code: TNodeInstallErrorCode,
        message: string,
    ) {
        super(message);
    }
}

interface IExecResult {
    code: null | number;
    output: string;
}

export interface INodeInstallDeps {
    checkHealth: () => Promise<boolean>;
    createNode: () => Promise<TResult<{ uuid: string }>>;
    save: (state: TNodeInstallState) => Promise<void>;
    secretKey: string;
}

/** Installs the node container on a server over SSH, then adds the node to the panel. */
export class NodeInstallRunner {
    private readonly logger = new Logger(NodeInstallRunner.name);

    private client: Client | null = null;
    private password: null | string;
    private readonly state: TNodeInstallState;

    private flushTimer: NodeJS.Timeout | null = null;
    private flushChain: Promise<void> = Promise.resolve();
    private pendingLine = '';

    constructor(
        id: string,
        private readonly request: StartNodeInstallCommand.RequestBody,
        private readonly deps: INodeInstallDeps,
    ) {
        this.password = request.ssh.password;

        const now = Date.now();

        this.state = {
            id,
            address: request.node.address.trim(),
            name: request.node.name.trim(),
            status: 'running',
            steps: NODE_INSTALL_STEPS.map((step) => ({
                id: step,
                status: 'pending',
                detail: null,
                startedAt: null,
                finishedAt: null,
            })),
            log: [],
            error: null,
            hostKey: null,
            nodeUuid: null,
            startedAt: now,
            updatedAt: now,
        };
    }

    public async save(): Promise<void> {
        await this.deps.save({ ...this.state, updatedAt: Date.now() });
    }

    public async run(): Promise<void> {
        const heartbeat = setInterval(() => this.flush(), HEARTBEAT_MS);

        try {
            await this.step('connect', () => this.connect());
            await this.step('system', () => this.checkSystem());
            await this.step('docker', () => this.ensureDocker());
            await this.step('compose', () => this.writeCompose());
            await this.step('start', () => this.startContainer());
            await this.step('handshake', () => this.waitForHandshake());
            await this.step('register', () => this.register());

            this.state.status = 'success';
        } catch (error) {
            const known = error instanceof InstallError;

            if (!known) this.logger.error(error);

            this.state.status = 'failed';
            this.state.error = {
                code: known ? error.code : 'INTERRUPTED',
                message: error instanceof Error ? error.message : 'Unknown error',
            };

            for (const step of this.state.steps) {
                if (step.status === 'running') {
                    step.status = 'failed';
                    step.finishedAt = Date.now();
                }
            }
        } finally {
            clearInterval(heartbeat);
            if (this.flushTimer) clearTimeout(this.flushTimer);
            this.flushTimer = null;
            this.password = null;
            this.client?.end();
            this.client = null;
            this.appendLog('\n');
            this.flush();
            await this.flushChain;
        }
    }

    private async step(id: TNodeInstallStep, fn: () => Promise<string>): Promise<void> {
        const step = this.state.steps.find((item) => item.id === id)!;

        step.status = 'running';
        step.startedAt = Date.now();
        this.flush();

        step.detail = await fn();
        step.status = 'done';
        step.finishedAt = Date.now();
        this.flush();
    }

    private connect(): Promise<string> {
        const { address } = this.state;
        const { port } = this.request.ssh;

        this.appendLog(`$ ssh root@${address} -p ${port}\n`);

        return new Promise((resolve, reject) => {
            const client = new Client();
            this.client = client;

            let isReady = false;

            client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) =>
                finish(prompts.map(() => this.password ?? '')),
            );

            client.on('ready', () => {
                isReady = true;
                this.password = null;
                this.appendLog(`Connected. Host key ${this.state.hostKey}\n`);
                resolve(this.state.hostKey ?? '');
            });

            client.on('error', (error: Error & { level?: string }) => {
                if (isReady) {
                    this.appendLog(`SSH error: ${error.message}\n`);
                    return;
                }

                reject(
                    error.level === 'client-authentication'
                        ? new InstallError('AUTH_FAILED', error.message)
                        : new InstallError('CONNECT_FAILED', error.message),
                );
            });

            client.connect({
                host: address,
                port,
                username: 'root',
                password: this.password ?? '',
                tryKeyboard: true,
                readyTimeout: 20_000,
                keepaliveInterval: 15_000,
                // shortcut: trust on first use, the fingerprint is shown in the progress; add confirmation if admins ask for it.
                hostVerifier: (key: Buffer) => {
                    this.state.hostKey = sshFingerprint(key);
                    return true;
                },
            });
        });
    }

    private async checkSystem(): Promise<string> {
        const { output } = await this.exec(SYSTEM_PROBE, { timeoutMs: 30_000 });
        const facts = Object.fromEntries(
            output
                .split('\n')
                .map((line) => line.split('='))
                .filter((parts) => parts.length >= 2)
                .map(([key, ...value]) => [key.trim(), value.join('=').trim()]),
        );

        if (facts.uid !== '0') {
            throw new InstallError('NOT_ROOT', 'The SSH login is not root (uid 0)');
        }

        if (facts.kernel !== 'Linux' || !SUPPORTED_ARCHS.includes(facts.arch)) {
            throw new InstallError(
                'UNSUPPORTED_SYSTEM',
                `Unsupported system: ${facts.kernel ?? '?'} ${facts.arch ?? '?'} (needs Linux on x86_64 or arm64)`,
            );
        }

        const detail = `${facts.os || 'Linux'} · ${facts.arch}`;
        this.appendLog(`${detail}\n`);

        return detail;
    }

    private async ensureDocker(): Promise<string> {
        const probe = await this.exec('docker compose version --short 2>/dev/null', {
            timeoutMs: 30_000,
        });

        if (probe.code !== 0) {
            this.appendLog('Docker is not installed. Installing it from get.docker.com\n');

            const install = await this.exec(INSTALL_DOCKER, {
                stream: true,
                timeoutMs: 15 * 60_000,
            });

            if (install.code !== 0) {
                throw new InstallError('DOCKER_FAILED', this.tail(install.output));
            }
        }

        await this.exec(START_DOCKER, { timeoutMs: 60_000 });

        const version = await this.exec("docker info --format '{{.ServerVersion}}'", {
            timeoutMs: 30_000,
        });

        if (version.code !== 0) {
            throw new InstallError(
                'DOCKER_FAILED',
                `Docker is installed but not running: ${this.tail(version.output)}`,
            );
        }

        const detail = `Docker ${version.output.trim()}`;
        this.appendLog(`${detail}\n`);

        return detail;
    }

    private async writeCompose(): Promise<string> {
        const nodePort = this.request.node.port;

        // A previous automatic install in the same folder is replaced; any other umiji-node container is left alone.
        await this.exec(
            `if [ -f ${COMPOSE_FILE} ]; then cd ${NODE_INSTALL_DIR} && docker compose down --remove-orphans; fi`,
            { stream: true, timeoutMs: 120_000 },
        );

        const containers = await this.exec("docker ps -a --format '{{.Names}}'", {
            timeoutMs: 30_000,
        });

        if (containers.output.split('\n').some((name) => name.trim() === NODE_CONTAINER_NAME)) {
            throw new InstallError(
                'CONTAINER_EXISTS',
                `A container named ${NODE_CONTAINER_NAME} already exists on this server`,
            );
        }

        const listener = await this.exec(`ss -Hltn 'sport = :${nodePort}' 2>/dev/null`, {
            timeoutMs: 30_000,
        });

        if (listener.output.trim()) {
            throw new InstallError(
                'PORT_BUSY',
                `Port ${nodePort} is already in use on this server`,
            );
        }

        const write = await this.exec(
            `mkdir -p ${NODE_INSTALL_DIR} && umask 077 && cat > ${COMPOSE_FILE}`,
            {
                stdin: `${generateNodeDockerCompose(nodePort, this.deps.secretKey)}\n`,
                timeoutMs: 30_000,
            },
        );

        if (write.code !== 0) {
            throw new InstallError('START_FAILED', this.tail(write.output));
        }

        this.appendLog(`Wrote ${COMPOSE_FILE}\n`);

        return COMPOSE_FILE;
    }

    private async startContainer(): Promise<string> {
        this.appendLog(`$ docker compose pull && docker compose up -d\n`);

        // A failed pull is not fatal: `up` still works when the server already has the image.
        const start = await this.exec(
            `cd ${NODE_INSTALL_DIR} && { docker compose pull || echo "Pull failed, trying the image already on the server"; } && docker compose up -d`,
            { stream: true, timeoutMs: 10 * 60_000 },
        );

        if (start.code !== 0) {
            throw new InstallError('START_FAILED', this.tail(start.output));
        }

        return NODE_DOCKER_IMAGE;
    }

    private async waitForHandshake(): Promise<string> {
        const target = `${this.state.address}:${this.request.node.port}`;
        const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;

        this.appendLog(`Waiting for the node to answer on ${target}\n`);

        while (Date.now() < deadline) {
            if (await this.deps.checkHealth()) {
                this.appendLog('The node answered over mTLS\n');
                return target;
            }

            const state = await this.exec(
                `docker inspect -f '{{.State.Status}}' ${NODE_CONTAINER_NAME} 2>/dev/null`,
                { timeoutMs: 15_000 },
            );

            if (['dead', 'exited'].includes(state.output.trim())) break;

            await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_RETRY_MS));
        }

        this.appendLog(`\n$ docker logs --tail 30 ${NODE_CONTAINER_NAME}\n`);
        await this.exec(`docker logs --tail 30 ${NODE_CONTAINER_NAME} 2>&1`, {
            stream: true,
            timeoutMs: 30_000,
        });

        throw new InstallError(
            'HANDSHAKE_FAILED',
            `The panel could not reach the node on ${target}`,
        );
    }

    private async register(): Promise<string> {
        const result = await this.deps.createNode();

        if (!result.isOk) {
            throw new InstallError(
                'REGISTER_FAILED',
                result.message ?? 'The node could not be added to the panel',
            );
        }

        this.state.nodeUuid = result.response.uuid;
        this.appendLog(`Added ${this.state.name} to the panel\n`);

        return this.state.name;
    }

    private exec(
        command: string,
        options: { stdin?: string; stream?: boolean; timeoutMs: number },
    ): Promise<IExecResult> {
        const client = this.client;

        if (!client) {
            return Promise.reject(new InstallError('CONNECT_FAILED', 'SSH connection is closed'));
        }

        return new Promise((resolve, reject) => {
            client.exec(command, (error, channel) => {
                if (error) {
                    reject(new InstallError('CONNECT_FAILED', error.message));
                    return;
                }

                let output = '';
                let exitCode: null | number = null;

                const timer = setTimeout(() => {
                    channel.close();
                    reject(
                        new InstallError(
                            'INTERRUPTED',
                            `Timed out after ${Math.round(options.timeoutMs / 1000)}s: ${this.tail(output)}`,
                        ),
                    );
                }, options.timeoutMs);

                const onData = (chunk: Buffer) => {
                    const text = chunk.toString('utf8');

                    output = (output + text).slice(-MAX_OUTPUT_CHARS);
                    if (options.stream) this.appendLog(text);
                };

                channel.on('data', onData);
                channel.stderr.on('data', onData);
                channel.on('exit', (code: null | number) => {
                    exitCode = code;
                });
                channel.on('close', () => {
                    clearTimeout(timer);
                    resolve({ code: exitCode, output });
                });

                channel.end(options.stdin);
            });
        });
    }

    private appendLog(text: string): void {
        const lines = (this.pendingLine + text).replace(ANSI_PATTERN, '').split(/\r\n|\n|\r/);

        this.pendingLine = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;

            this.state.log.push(line.slice(0, MAX_LINE_LENGTH));
        }

        if (this.state.log.length > MAX_LOG_LINES) {
            this.state.log.splice(0, this.state.log.length - MAX_LOG_LINES);
        }

        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null;
                this.flush();
            }, FLUSH_THROTTLE_MS);
        }
    }

    private flush(): void {
        this.flushChain = this.flushChain
            .then(() => this.save())
            .catch((error) => this.logger.error(`Failed to save install progress: ${error}`));
    }

    private tail(output: string): string {
        const lines = output.replace(ANSI_PATTERN, '').trim().split('\n');

        return lines.slice(-6).join('\n') || 'No output';
    }
}
