import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptPayload, generateVapidKeys, vapidAuthorization, sendWebPush } from "../src/operations/notifications/web-push.js";

const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

// Lado del navegador (RFC 8291) para comprobar que lo que cifra el servidor se puede leer.
function browserSubscription() {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, subscription: { endpoint: "https://push.example.com/abc", keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } } };
}
function decrypt({ ecdh, auth }, body) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPublic = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const shared = ecdh.computeSecret(asPublic);
  const prkKey = hmac(auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "delimitador del último registro");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

test("Web Push: el aviso cifrado solo lo lee el navegador suscrito", () => {
  const b = browserSubscription();
  const body = encryptPayload(b.subscription, JSON.stringify({ title: "Nuevo expediente en Captura", body: "María López · Plan 1" }));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.deepEqual(JSON.parse(decrypt(b, body)), { title: "Nuevo expediente en Captura", body: "María López · Plan 1" });
  const other = browserSubscription();
  assert.throws(() => decrypt({ ecdh: other.ecdh, auth: b.auth }, body));
});

test("Web Push: firma VAPID ES256 verificable con la llave pública", () => {
  const keys = generateVapidKeys();
  const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/xyz", keys, "https://martcom-econtact.mx", 1_800_000_000_000);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "https://martcom-econtact.mx");
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("Web Push: 410 marca la suscripción como vencida", async () => {
  const b = browserSubscription();
  let request;
  const res = await sendWebPush(b.subscription, { title: "x" }, { vapidKeys: generateVapidKeys(), subject: "mailto:a@b.mx", fetchImpl: async (url, init) => { request = { url, init }; return { status: 410 }; } });
  assert.deepEqual(res, { ok: false, status: 410, gone: true });
  assert.equal(request.init.headers["Content-Encoding"], "aes128gcm");
  assert.match(request.init.headers.Authorization, /^vapid t=/);
});
