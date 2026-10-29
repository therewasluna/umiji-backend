import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

function applySecretHmac(password: string, secret: string): Buffer {
    const hmac = createHmac('sha256', secret);
    hmac.update(password);
    return hmac.digest();
}

export async function hashPassword(plainPassword: string, secret: string): Promise<string> {
    const hmacResult = applySecretHmac(plainPassword, secret);

    const salt = randomBytes(16).toString('hex');

    const derivedKey = (await scryptAsync(hmacResult.toString('hex'), salt, 64)) as Buffer;
    const hash = derivedKey.toString('hex');

    return `${salt}:${hash}`;
}

export async function verifyPassword(
    plainPassword: string,
    storedHash: string,
    secret: string,
): Promise<boolean> {
    const hmacResult = applySecretHmac(plainPassword, secret);

    const [salt, hash] = storedHash.split(':');

    const derivedKey = (await scryptAsync(hmacResult.toString('hex'), salt, 64)) as Buffer;
    const calculatedHash = derivedKey.toString('hex');

    return timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash));
}
