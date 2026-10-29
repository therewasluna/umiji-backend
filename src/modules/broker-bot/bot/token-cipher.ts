import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// AES-256-GCM for bot tokens at rest, keyed off APP_SECRET.
// Format: base64url(salt[16] | iv[12] | tag[16] | ciphertext).

function keyFrom(secret: string, salt: Buffer): Buffer {
    return scryptSync(secret, salt, 32);
}

export function encryptToken(secret: string, plain: string): string {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyFrom(secret, salt), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([salt, iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function decryptToken(secret: string, blob: string): string {
    const buf = Buffer.from(blob, 'base64url');
    const decipher = createDecipheriv(
        'aes-256-gcm',
        keyFrom(secret, buf.subarray(0, 16)),
        buf.subarray(16, 28),
    );
    decipher.setAuthTag(buf.subarray(28, 44));
    return Buffer.concat([decipher.update(buf.subarray(44)), decipher.final()]).toString('utf8');
}
