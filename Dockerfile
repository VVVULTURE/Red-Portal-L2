# ── Red Portal — Koyeb Docker Deployment ──────────────────────────
# Uses Node.js Alpine (small image, fast cold-start).
# Koyeb injects $PORT automatically; server.js already reads it.
# Default exposed port is 8000 (Koyeb's expected default).

FROM node:20-alpine

# Run as a non-root user for security
RUN addgroup -S redportal && adduser -S redportal -G redportal

WORKDIR /app

# Copy all project files
COPY --chown=redportal:redportal . .

USER redportal

# Koyeb sets PORT at runtime; expose its default here for documentation
EXPOSE 8000

# server.js reads process.env.PORT — Koyeb supplies it automatically
CMD ["node", "server.js"]
