# syntax=docker/dockerfile:1.7
#
# comπle Editor — multi-stage Docker build
#
#   deps       → npm ci (node-pty compiled, Electron binary downloaded)
#   build      → electron-vite build  (VITE_* secrets injected via BuildKit secret)
#   package    → electron-builder --linux  (AppImage + deb + unpacked dir)
#   artifacts  → scratch stage, export with:  docker build --target artifacts --output type=local,dest=dist .
#   runtime    → (default) IDE running on Xvfb, streamed to the browser with noVNC
#
# Build the runtime image:
#   DOCKER_BUILDKIT=1 docker build --secret id=env,src=.env -t compile-ide .
#
ARG NODE_VERSION=22
ARG DEBIAN_RELEASE=bookworm

# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE} AS deps
WORKDIR /app

# node:<ver>-bookworm already ships python3, make and g++ (needed by node-gyp
# for node-pty). Electron-builder additionally needs these for deb/AppImage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends rpm fakeroot dpkg libarchive-tools \
 && rm -rf /var/lib/apt/lists/*

ENV ELECTRON_CACHE=/root/.cache/electron \
    ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
    npm_config_fund=false \
    npm_config_audit=false

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/electron \
    npm ci

# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# The .env file is only visible during this RUN step; it never lands in a layer.
# electron-vite reads it from the project root and inlines VITE_* values.
# (Secret is optional so the image still builds without one.)
RUN --mount=type=secret,id=env,required=false \
    if [ -f /run/secrets/env ]; then cp /run/secrets/env .env; fi \
 && NODE_OPTIONS=--max-old-space-size=8192 npm run build \
 && rm -f .env

# ─────────────────────────────────────────────────────────────────────────────
FROM build AS package
# Override the yml's linux targets (snap needs snapcraft, which we don't ship).
# electron-builder rebuilds node-pty against Electron's ABI here.
RUN --mount=type=cache,target=/root/.cache/electron \
    --mount=type=cache,target=/root/.cache/electron-builder \
    npx electron-builder --linux AppImage deb --x64 --publish never \
 && ls -la dist

# ─────────────────────────────────────────────────────────────────────────────
FROM scratch AS artifacts
COPY --from=package /app/dist/*.AppImage /app/dist/*.deb /

# ─────────────────────────────────────────────────────────────────────────────
FROM debian:${DEBIAN_RELEASE}-slim AS runtime

ARG DEBIAN_FRONTEND=noninteractive
ARG USER_UID=1000
ARG USER_GID=1000

# 1) Electron/Chromium shared libs   2) virtual display + VNC + noVNC
# 3) language toolchains the IDE shells out to (compilers, debuggers, LSPs)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libxshmfence1 libdrm2 \
      libatk-bridge2.0-0 libcups2 libxkbcommon0 libsecret-1-0 libnotify4 \
      libxtst6 libuuid1 xdg-utils dbus-x11 \
      fonts-dejavu fonts-liberation fonts-noto-color-emoji \
      xvfb x11vnc openbox novnc websockify procps tini curl ca-certificates \
      git openssh-client \
      build-essential gdb clangd \
      python3 python3-pip python3-venv python-is-python3 python3-debugpy \
      openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

# Node is used for the JS debugger (node --inspect-brk) and LSP fallbacks.
COPY --from=deps /usr/local/bin/node /usr/local/bin/node

RUN groupadd --gid ${USER_GID} ide \
 && useradd --uid ${USER_UID} --gid ${USER_GID} -m -s /bin/bash ide \
 && mkdir -p /home/ide/workspace /home/ide/.config \
 && chown -R ide:ide /home/ide \
 && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

COPY --from=package /app/dist/linux-unpacked /opt/compile-editor
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/openbox-rc.xml /etc/xdg/openbox/rc.xml
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

ENV DISPLAY=:99 \
    SCREEN_GEOMETRY=1920x1080x24 \
    NOVNC_PORT=6080 \
    VNC_PORT=5900 \
    SHELL=/bin/bash \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    WORKSPACE=/home/ide/workspace \
    COMPILE_DISABLE_AUTO_UPDATE=1

USER ide
WORKDIR /home/ide/workspace
# ~/.config holds the IDE's userData (settings, encrypted API keys, usage).
VOLUME ["/home/ide/workspace", "/home/ide/.config"]
EXPOSE 6080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${NOVNC_PORT}/vnc.html" >/dev/null && pgrep -x compile-editor >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
