# HireOS code-runner sandbox image (Python 3 + Node.js 22).
# Holds no application code, no credentials and no package managers.
# Always run through sandbox-runner/code_exec.py, which adds:
#   --network none --read-only --tmpfs /tmp (noexec, 16m) --pids-limit --memory
#   --cpus --cap-drop ALL --security-opt no-new-privileges --user 10001:10001
FROM node:22-alpine

RUN apk add --no-cache python3

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /var/cache/apk/* \
 && addgroup -S -g 10001 sandbox \
 && adduser -S -D -H -u 10001 -G sandbox -h /tmp/work sandbox \
 && mkdir -p /opt/harness

# Package manager removed last (nothing can be installed at runtime; there is no network either).
# busybox re-creates applet symlinks on apk operations, so network applets are removed afterwards.
RUN apk --purge del apk-tools && rm -f /sbin/apk /usr/bin/wget /usr/bin/nc /bin/nc /usr/bin/telnet /usr/bin/ftpget /usr/bin/ftpput

COPY harness.py /opt/harness/harness.py
RUN chmod 0555 /opt/harness && chmod 0444 /opt/harness/harness.py

USER 10001:10001
WORKDIR /tmp
ENTRYPOINT ["python3", "-I", "-S", "-B", "/opt/harness/harness.py"]
