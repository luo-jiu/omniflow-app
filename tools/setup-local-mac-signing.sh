#!/usr/bin/env bash

set -euo pipefail

identity_name='OmniFlow Local Update'
credential_service='com.loyce.omniflow.local-signing'
account_name=$(id -un)
user_home=$(dscl . -read "/Users/$account_name" NFSHomeDirectory | awk '{ print $2 }')

if [[ -z "$user_home" || "$user_home" != /Users/* ]]; then
  echo "Unable to resolve a safe macOS user directory." >&2
  exit 1
fi

keychain_path="$user_home/Library/Keychains/omniflow-local-signing.keychain-db"
login_keychain="$user_home/Library/Keychains/login.keychain-db"
backup_dir="$user_home/Library/Application Support/Omniflow/signing"
backup_p12="$backup_dir/omniflow-local-update.p12"
backup_cert="$backup_dir/omniflow-local-update.crt"

if [[ -f "$keychain_path" ]]; then
  if security find-identity -v -p codesigning "$keychain_path" | grep -Fq "\"$identity_name\""; then
    echo "Signing identity already exists: $identity_name"
    echo "Keychain: $keychain_path"
    echo "Backup: $backup_p12"
    exit 0
  fi
  echo "Signing keychain exists but does not contain a valid '$identity_name' identity:" >&2
  echo "$keychain_path" >&2
  exit 1
fi

temp_dir=$(mktemp -d /tmp/omniflow-signing-setup.XXXXXX)
temp_key="$temp_dir/omniflow-local-update.key"
temp_cert="$temp_dir/omniflow-local-update.crt"
temp_p12="$temp_dir/omniflow-local-update.p12"
setup_complete='false'

cleanup() {
  if [[ "$setup_complete" != 'true' ]]; then
    security remove-trusted-cert "$temp_cert" >/dev/null 2>&1 || true
    security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
    security delete-generic-password -a "$account_name" -s "$credential_service" >/dev/null 2>&1 || true
  fi
  if [[ -d "$temp_dir" ]]; then
    find "$temp_dir" -depth -delete >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

keychain_password=$(openssl rand -base64 36 | tr -d '\n')

openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
  -subj '/CN=OmniFlow Local Update/O=OmniFlow Local Distribution/C=CN' \
  -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=codeSigning' \
  -keyout "$temp_key" \
  -out "$temp_cert" >/dev/null 2>&1

openssl pkcs12 -export -legacy \
  -name "$identity_name" \
  -inkey "$temp_key" \
  -in "$temp_cert" \
  -out "$temp_p12" \
  -passout "pass:$keychain_password" >/dev/null 2>&1

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$temp_p12" \
  -k "$keychain_path" \
  -P "$keychain_password" \
  -T /usr/bin/codesign \
  -T /usr/bin/security >/dev/null
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain_path" >/dev/null

current_keychains=()
while IFS= read -r line; do
  entry=${line#*\"}
  entry=${entry%\"}
  if [[ -n "$entry" && "$entry" != "$keychain_path" ]]; then
    current_keychains+=("$entry")
  fi
done < <(security list-keychains -d user)
security list-keychains -d user -s "$keychain_path" "${current_keychains[@]}"

security add-trusted-cert \
  -r trustRoot \
  -p codeSign \
  -k "$login_keychain" \
  "$temp_cert"
security add-generic-password \
  -a "$account_name" \
  -s "$credential_service" \
  -w "$keychain_password" \
  -U \
  -T /usr/bin/security >/dev/null

install -d -m 700 "$backup_dir"
install -m 600 "$temp_p12" "$backup_p12"
install -m 644 "$temp_cert" "$backup_cert"

if ! security find-identity -v -p codesigning "$keychain_path" | grep -Fq "\"$identity_name\""; then
  echo "The installed signing identity is not valid." >&2
  exit 1
fi

setup_complete='true'
echo "Created signing identity: $identity_name"
echo "Keychain: $keychain_path"
echo "Encrypted backup: $backup_p12"
echo "The backup password is stored in the macOS login keychain as $credential_service."
