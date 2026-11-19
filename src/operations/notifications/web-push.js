// Web Push (notificaciones al celular o la computadora aunque la página esté cerrada), sin
// dependencias externas:
// - VAPID (RFC 8292): el servidor firma con su llave para que el servicio de push lo acepte.
// - Cifrado aes128gcm (RFC 8291 + RFC 8188): solo el navegador del usuario puede leer el aviso.
import crypto from "node:crypto";

const b64u = buf => Buffer.from(buf).toString("base64url");
const fromB64u = str => Buffer.from(String(str || ""), "base64url");

export function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidPrivateKey({ publicKey, privateKey }) {
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privateKey }, format: "jwk" });
}

export function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
  const audience = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key: vapidPrivateKey(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// Cifra `payload` para la suscripción { keys: { p256dh, auth } }.
export function encryptPayload(subscription, payload, { salt = crypto.randomBytes(16), serverKeys = null } = {}) {
  const uaPublic = fromB64u(subscription?.keys?.p256dh);
  const authSecret = fromB64u(subscription?.keys?.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Suscripción de push inválida");
  const ecdh = crypto.createECDH("prime256v1");
  if (serverKeys) ecdh.setPrivateKey(serverKeys); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(String(payload), "utf8"), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Envía un aviso. Devuelve { ok, status, gone } — gone=true si la suscripción ya no existe (404/410).
export async function sendWebPush(subscription, payload, { vapidKeys, subject, ttl = 24 * 60 * 60, fetchImpl = fetch } = {}) {
  const body = encryptPayload(subscription, typeof payload === "string" ? payload : JSON.stringify(payload));
  const response = await fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, vapidKeys, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
    },
    body,
  });
  return { ok: response.status >= 200 && response.status < 300, status: response.status, gone: response.status === 404 || response.status === 410 };
}
