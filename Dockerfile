# --Build Stage--

FROM node:20-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# Install dependencies

RUN npm ci

# Copy rest of application code

COPY . .

# Build NextJS application

RUN npm run build 

# --Runtime Stage--

FROM node:20-bookworm AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy built app and dependencies from builder

COPY --from=builder /app ./

# Expose NextJS port

EXPOSE 3000

# Start NextJS sever

CMD ["npm", "start"]