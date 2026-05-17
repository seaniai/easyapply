use aes_gcm::{
  aead::{Aead, KeyInit},
  Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use getrandom::getrandom;

const DEV_FALLBACK_KEY: &[u8; 32] = b"easyapply-dev-key-do-not-use!!!!";

fn master_key_bytes() -> Result<[u8; 32], String> {
  let raw = std::env::var("EASYAPPLY_SECRET_ENCRYPTION_KEY").unwrap_or_default();
  if raw.is_empty() {
    if cfg!(debug_assertions) {
      return Ok(*DEV_FALLBACK_KEY);
    }
    return Err("EASYAPPLY_SECRET_ENCRYPTION_KEY is not configured".to_string());
  }
  let bytes = raw.as_bytes();
  if bytes.len() == 32 {
    let mut out = [0u8; 32];
    out.copy_from_slice(bytes);
    return Ok(out);
  }
  // Allow arbitrary-length secrets: derive 32 bytes via simple hash stretch (not production-grade KDF).
  let mut out = [0u8; 32];
  for (i, b) in bytes.iter().cycle().take(32).enumerate() {
    out[i] = *b;
  }
  Ok(out)
}

pub fn encrypt_secret(plaintext: &str) -> Result<String, String> {
  let key = Aes256Gcm::new_from_slice(&master_key_bytes()?).map_err(|e| e.to_string())?;
  let mut nonce_bytes = [0u8; 12];
  getrandom(&mut nonce_bytes).map_err(|e| e.to_string())?;
  let nonce = Nonce::from_slice(&nonce_bytes);
  let ciphertext = key
    .encrypt(nonce, plaintext.as_bytes())
    .map_err(|e| e.to_string())?;
  let mut packed = Vec::with_capacity(12 + ciphertext.len());
  packed.extend_from_slice(&nonce_bytes);
  packed.extend_from_slice(&ciphertext);
  Ok(B64.encode(packed))
}

pub fn decrypt_secret(encoded: &str) -> Result<String, String> {
  let packed = B64.decode(encoded.trim()).map_err(|e| e.to_string())?;
  if packed.len() < 13 {
    return Err("Invalid encrypted secret payload".to_string());
  }
  let (nonce_bytes, ciphertext) = packed.split_at(12);
  let key = Aes256Gcm::new_from_slice(&master_key_bytes()?).map_err(|e| e.to_string())?;
  let nonce = Nonce::from_slice(nonce_bytes);
  let plain = key
    .decrypt(nonce, ciphertext)
    .map_err(|_| "Failed to decrypt secret".to_string())?;
  String::from_utf8(plain).map_err(|e| e.to_string())
}
