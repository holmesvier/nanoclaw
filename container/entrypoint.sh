#!/bin/bash
set -e

# If current uid has no passwd entry (e.g. macOS host uid), fake one via nss_wrapper
if ! whoami &>/dev/null; then
  cp /etc/passwd /tmp/passwd
  echo "node:x:$(id -u):$(id -g)::/home/node:/bin/bash" >> /tmp/passwd
  export NSS_WRAPPER_PASSWD=/tmp/passwd
  export NSS_WRAPPER_GROUP=/etc/group
  export LD_PRELOAD=/usr/lib/$(uname -m)-linux-gnu/libnss_wrapper.so
fi

# Import custom CA certs into Java truststore if present
CERTS_DIR=/run/nanoclaw-certs
if [ -d "$CERTS_DIR" ] && ls "$CERTS_DIR"/*.crt &>/dev/null; then
  JAVA_CACERTS=$(find /usr/lib/jvm -name cacerts 2>/dev/null | head -1)
  if [ -n "$JAVA_CACERTS" ]; then
    cp "$JAVA_CACERTS" /tmp/cacerts
    for cert in "$CERTS_DIR"/*.crt; do
      alias=$(basename "$cert" .crt)
      keytool -importcert -noprompt -alias "$alias" \
        -file "$cert" -keystore /tmp/cacerts -storepass changeit 2>/dev/null || true
    done
    export JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStore=/tmp/cacerts -Djavax.net.ssl.trustStorePassword=changeit"
  fi
fi

cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist
cat > /tmp/input.json
node /tmp/dist/index.js < /tmp/input.json
