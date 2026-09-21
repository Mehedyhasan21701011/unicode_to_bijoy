# =============================================================================
# PDF to Bijoy Converter — Backend
# Docker image for Render (Language: Docker)
#
# Why Docker instead of Render's native Node runtime:
#   Render's native Node runtime does NOT include system binaries like
#   pdftotext, pdfinfo, pdftoppm (poppler-utils), tesseract, or soffice
#   (LibreOffice). This backend shells out to ALL of them, so every PDF
#   upload and every .doc upload silently fails with ENOENT on the native
#   runtime. Using Docker lets us install exactly what we need.
#
# Image size note:
#   libreoffice is large (~500MB). This is expected. Render's Docker service
#   caches layers, so subsequent deploys only push the layers that change
#   (usually just the npm install + app copy layers). Build time for the first
#   deploy is longer; subsequent deploys are faster.
#
# To switch to Docker on Render: set Language = "Docker" in the service
# settings, not "Node". The root command and start command are both driven
# by this file's CMD.
# =============================================================================

FROM node:20-bookworm-slim

# Install ALL required system binaries in a single RUN to keep layers minimal.
# - poppler-utils: pdftotext, pdfinfo, pdftoppm (PDF text extraction + OCR rasterization)
# - tesseract-ocr: OCR engine binary
# - tesseract-ocr-ben: Bengali language data pack for Tesseract
# - tesseract-ocr-eng: English language data (used alongside Bengali in ben+eng mode)
# - libreoffice-writer: headless LibreOffice Writer for .doc → .docx conversion
#   (writer only, not full libreoffice suite, to reduce image size)
# - unzip: needed to read/write .docx files (they are zip archives)
# - ca-certificates: TLS roots, needed for any outbound HTTPS at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-ben \
    tesseract-ocr-eng \
    libreoffice-writer \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first so npm ci is cached unless dependencies change.
COPY package*.json ./

# Install production dependencies only (devDependencies are not needed at runtime).
RUN npm ci --omit=dev

# Copy the full backend source. .dockerignore (if present) excludes dist/,
# node_modules/, tmp/ and .env so they don't shadow what we just built.
COPY . .

# Compile TypeScript to JavaScript.
RUN npm run build

# Render injects PORT automatically; default to 4000 for local docker run.
ENV PORT=4000
EXPOSE 4000

# Run the compiled entry point.
CMD ["node", "dist/index.js"]
