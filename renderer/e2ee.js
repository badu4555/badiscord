(function () {
  const DB_NAME = 'badiscord-e2ee';
  const STORE_NAME = 'identity';
  let identity = null;
  const groupKeys = new Map();

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readIdentity() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('identity');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeIdentity(value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, 'identity');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function ensureIdentity() {
    if (identity) return identity;
    const stored = await readIdentity();
    if (stored?.privateKey && stored?.publicKey) {
      identity = { privateKey: stored.privateKey, publicKey: stored.publicKey };
      return identity;
    }
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    );
    const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    await writeIdentity({ privateKey: keyPair.privateKey, publicKey });
    identity = { privateKey: keyPair.privateKey, publicKey };
    await publishIdentity(publicKey);
    return identity;
  }

  async function publishIdentity(publicKey) {
    await fetch('/api/e2ee/identity', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ publicKey })
    });
  }

  async function initialize() {
    const { publicKey } = await ensureIdentity();
    await publishIdentity(publicKey);
  }

  async function importPublicKey(publicKey) {
    return crypto.subtle.importKey(
      'jwk',
      publicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
  }

  async function getPublicKey(userId) {
    const response = await fetch(`/api/e2ee/identities/${encodeURIComponent(userId)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Não foi possível obter a chave segura do participante.');
    const payload = await response.json();
    return payload.publicKey;
  }

  async function deriveKey(privateKey, publicKey, salt, info) {
    const shared = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: publicKey },
      privateKey,
      256
    );
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: salt, info: info },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
  }

  async function decryptBytes(key, ivBase64, ciphertextBase64) {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
      key,
      base64ToBytes(ciphertextBase64)
    );
    return new Uint8Array(plaintext);
  }

  function encodeUtf8(value) {
    return new TextEncoder().encode(JSON.stringify(value));
  }

  function decodeUtf8(bytes) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function encryptDirect(conversationId, recipientId, content) {
    const own = await ensureIdentity();
    const recipientPublicJwk = await getPublicKey(recipientId);
    const recipientPublic = await importPublicKey(recipientPublicJwk);
    const salt = encodeUtf8(conversationId);
    const key = await deriveKey(own.privateKey, recipientPublic, salt, encodeUtf8('badiscord-direct-v1'));
    const encrypted = await encryptBytes(key, encodeUtf8(content));
    return {
      type: 'e2ee-v1-direct',
      conversation: conversationId,
      senderPublicKey: own.publicKey,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext
    };
  }

  async function decryptDirect(envelope) {
    const own = await ensureIdentity();
    const senderPublic = await importPublicKey(envelope.senderPublicKey);
    const salt = encodeUtf8(envelope.conversation);
    const key = await deriveKey(own.privateKey, senderPublic, salt, encodeUtf8('badiscord-direct-v1'));
    const bytes = await decryptBytes(key, envelope.iv, envelope.ciphertext);
    return decodeUtf8(bytes);
  }

  async function unwrapKey(wrappedKey) {
    const own = await ensureIdentity();
    const ephemeralPublic = await importPublicKey(wrappedKey.ephemeralPublicKey);
    const salt = encodeUtf8(wrappedKey.conversation);
    const wrappingKey = await deriveKey(own.privateKey, ephemeralPublic, salt, encodeUtf8('badiscord-group-key-v1'));
    const rawKey = await decryptBytes(wrappingKey, wrappedKey.iv, wrappedKey.ciphertext);
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function wrapKey(groupKey, conversationId, recipientId) {
    const recipientPublicJwk = await getPublicKey(recipientId);
    const recipientPublic = await importPublicKey(recipientPublicJwk);
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const salt = encodeUtf8(conversationId);
    const wrappingKey = await deriveKey(keyPair.privateKey, recipientPublic, salt, encodeUtf8('badiscord-group-key-v1'));
    const rawKey = await crypto.subtle.exportKey('raw', groupKey);
    const encrypted = await encryptBytes(wrappingKey, new Uint8Array(rawKey));
    const ephemeralPublicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    return {
      userId: recipientId,
      wrappedKey: {
        conversation: conversationId,
        ephemeralPublicKey,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext
      }
    };
  }

  async function ensureGroupKey(conversationId, recipientIds) {
    if (groupKeys.has(conversationId)) return groupKeys.get(conversationId);
    try {
      const response = await fetch(`/api/e2ee/conversations/${encodeURIComponent(conversationId)}/key`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (response.ok) {
        const payload = await response.json();
        const key = await unwrapKey(payload.wrappedKey);
        groupKeys.set(conversationId, key);
        return key;
      }
    } catch (_) {}

    const groupKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const uniqueIds = Array.from(new Set(recipientIds.filter(Boolean)));
    const wraps = [];
    for (const userId of uniqueIds) wraps.push(await wrapKey(groupKey, conversationId, userId));
    await fetch(`/api/e2ee/conversations/${encodeURIComponent(conversationId)}/key`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ wraps })
    });
    groupKeys.set(conversationId, groupKey);
    return groupKey;
  }

  async function encryptGroup(conversationId, recipientIds, content) {
    const key = await ensureGroupKey(conversationId, recipientIds);
    const encrypted = await encryptBytes(key, encodeUtf8(content));
    return {
      type: 'e2ee-v1-group',
      conversation: conversationId,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext
    };
  }

  async function decryptGroup(envelope) {
    let key = groupKeys.get(envelope.conversation);
    if (!key) {
      const response = await fetch(`/api/e2ee/conversations/${encodeURIComponent(envelope.conversation)}/key`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Não foi possível desbloquear a chave desta conversa.');
      const payload = await response.json();
      key = await unwrapKey(payload.wrappedKey);
      groupKeys.set(envelope.conversation, key);
    }
    const bytes = await decryptBytes(key, envelope.iv, envelope.ciphertext);
    return decodeUtf8(bytes);
  }

  async function decryptEnvelope(envelope) {
    if (!envelope?.type) throw new Error('Envelope criptografado não suportado.');
    if (envelope.type === 'e2ee-v1-direct') return decryptDirect(envelope);
    if (envelope.type === 'e2ee-v1-group') return decryptGroup(envelope);
    throw new Error('Versão de criptografia não suportada.');
  }

  async function exportGroupKeyMaterial(conversationId, recipientIds) {
    const key = await ensureGroupKey(conversationId, recipientIds);
    return crypto.subtle.exportKey('raw', key);
  }

  async function exportDirectKeyMaterial(conversationId, recipientId) {
    const own = await ensureIdentity();
    const recipientPublicJwk = await getPublicKey(recipientId);
    const recipientPublic = await importPublicKey(recipientPublicJwk);
    const salt = encodeUtf8(conversationId);
    const key = await deriveKey(own.privateKey, recipientPublic, salt, encodeUtf8('badiscord-direct-media-v1'));
    return crypto.subtle.exportKey('raw', key);
  }

  window.BadiscordE2EE = {
    initialize,
    encryptDirect,
    decryptDirect,
    encryptGroup,
    decryptGroup,
    decryptEnvelope,
    ensureGroupKey,
    exportGroupKeyMaterial,
    exportDirectKeyMaterial
  };
})();
