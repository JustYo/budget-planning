FROM node:22-alpine AS deps

# Install build tools required for native addons (better-sqlite3, bcrypt)
# and openssl for crypto operations
RUN apk add --no-cache python3 make g++ openssl bash git

WORKDIR /app

# Copy only the files needed for installing dependencies
COPY .yarn ./.yarn
COPY yarn.lock package.json .yarnrc.yml tsconfig.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/component-library/package.json packages/component-library/package.json
COPY packages/crdt/package.json packages/crdt/package.json
COPY packages/desktop-client/package.json packages/desktop-client/package.json
COPY packages/eslint-plugin-actual/package.json packages/eslint-plugin-actual/package.json
COPY packages/loot-core/package.json packages/loot-core/package.json
COPY packages/sync-server/package.json packages/sync-server/package.json
COPY packages/plugins-service/package.json packages/plugins-service/package.json

COPY ./bin/package-browser ./bin/package-browser

RUN yarn install

FROM deps AS builder

WORKDIR /app

COPY packages/ ./packages/

# Increase memory limit for the build process to 8GB
ENV NODE_OPTIONS=--max_old_space_size=8192

RUN yarn build:server && yarn workspace @actual-app/api build

# Focus the workspaces in production mode (including @actual-app/web you just built)
RUN yarn workspaces focus @actual-app/sync-server --production

# Remove symbolic links for @actual-app/web and @actual-app/sync-server
RUN rm -rf ./node_modules/@actual-app/web ./node_modules/@actual-app/sync-server

# Copy in the @actual-app/web artifacts manually, so we don't need the entire packages folder
COPY ./packages/desktop-client/package.json ./node_modules/@actual-app/web/package.json
RUN cp -r ./packages/desktop-client/build ./node_modules/@actual-app/web/build

# Build email notifier dependencies in an isolated stage
FROM node:22-alpine AS email-notifier-deps
RUN apk add --no-cache python3 make g++
WORKDIR /notifier
COPY packages/sync-server/email-notifier/package.json .
# Install deps from npm (compiles native addons like better-sqlite3).
# The @actual-app/api JS bundle will be replaced below with the locally-built
# version (which includes Enable Banking bank sync support, absent from npm).
RUN npm install --omit=dev

FROM alpine:3.22 AS prod

# Minimal runtime dependencies — use Alpine's nodejs (receives OS security patches)
# rather than the node:22-alpine image which bundles an unpatched Alpine base.
RUN apk add --no-cache nodejs tini

# Create a non-root user
ARG USERNAME=actual
ARG USER_UID=1001
ARG USER_GID=$USER_UID
RUN addgroup -g $USER_GID $USERNAME \
    && adduser -u $USER_UID -G $USERNAME -D $USERNAME \
    && mkdir /data && chown -R ${USERNAME}:${USERNAME} /data

WORKDIR /app
ENV NODE_ENV=production

# Pull in only the necessary artifacts (built node_modules, server files, etc.)
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/sync-server/package.json ./
COPY --from=builder /app/packages/sync-server/build ./build

# Email notifier
COPY --from=email-notifier-deps /notifier/node_modules ./email-notifier/node_modules
# Replace the npm-published @actual-app/api bundle with the locally-built one.
# The locally-built bundle includes Enable Banking bank sync support.
COPY --from=builder /app/packages/api/dist ./email-notifier/node_modules/@actual-app/api/dist
COPY packages/sync-server/email-notifier/package.json ./email-notifier/
COPY packages/sync-server/email-notifier/src ./email-notifier/src

# Startup script (launches sync server + email notifier)
COPY packages/sync-server/start.sh ./start.sh
RUN chmod +x ./start.sh

ENTRYPOINT ["/sbin/tini", "-g", "--"]
EXPOSE 5006
CMD ["/app/start.sh"]
